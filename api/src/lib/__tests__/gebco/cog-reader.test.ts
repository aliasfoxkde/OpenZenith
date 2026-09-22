import { describe, it, expect, vi, afterEach } from "vitest";
import { getGebcoElevation } from "../../gebco/cog-reader";

const STRIP_BYTES = 21600 * 2;

/** Little-endian Int16 write helper mirroring the reader's decode path. */
function writeInt16(strip: Uint8Array, col: number, value: number): void {
  const unsigned = value < 0 ? 65536 + value : value;
  strip[col * 2] = unsigned & 0xff;
  strip[col * 2 + 1] = Math.floor(unsigned / 256) & 0xff;
}

function stripFor(col: number, value: number, length = STRIP_BYTES): Uint8Array {
  const strip = new Uint8Array(length);
  if (col * 2 + 1 < length) writeInt16(strip, col, value);
  return strip;
}

interface Call {
  url: string;
  range: string;
  status: number;
}

/** Stub fetch, serving a strip per quadrant and recording every range request. */
function stubFetch(buildStrip: (url: string) => { body: Uint8Array; status: number }): { calls: Call[] } {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const range = new Headers(init?.headers).get("Range") ?? "";
    calls.push({ url, range, status: 0 });
    const { body, status } = buildStrip(url);
    calls[calls.length - 1].status = status;
    return Promise.resolve(new Response(body as unknown as BodyInit, { status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getGebcoElevation", () => {
  it("reads a land elevation from the northern/western quadrant", async () => {
    // (90 - 40) * 240 = 12000 row, (-74 + 90) * 240 = 3840 col -> byte 7680
    const { calls } = stubFetch(() => ({ body: stripFor(3840, 1234), status: 206 }));

    const result = await getGebcoElevation(40, -74);

    expect(result).toEqual({
      elevation: 1234,
      surface_type: "land",
      unit: "meters",
      location: { lat: 40, lon: -74 },
      source: "gebco2025",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
      resolution: 450,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff/gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
    );
    // 135948 + 12000 * 43200 = 518535948, one full strip of 43200 bytes
    expect(calls[0].range).toBe("bytes=518535948-518579147");
  });

  it("reads negative values as seafloor bathymetry", async () => {
    const { calls } = stubFetch(() => ({ body: stripFor(3840, -3380), status: 206 }));

    const result = await getGebcoElevation(40, -74);

    expect(result.elevation).toBe(-3380);
    expect(result.surface_type).toBe("seafloor");
    expect(calls[0].range).toBe("bytes=518535948-518579147");
  });

  it("reads sea level as land (0 is not negative)", async () => {
    stubFetch(() => ({ body: stripFor(3840, 0), status: 206 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBe(0);
    expect(result.surface_type).toBe("land");
  });

  it("accepts a 200 response as well as a 206 partial response", async () => {
    const { calls } = stubFetch(() => ({ body: stripFor(3840, 500), status: 200 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBe(500);
    expect(calls[0].status).toBe(200);
  });

  it("selects the southern/eastern quadrant for southern hemisphere points", async () => {
    const { calls } = stubFetch(() => ({ body: stripFor(4800, -1200), status: 206 }));

    const result = await getGebcoElevation(-40, 20);

    expect(result.tile).toBe("gebco_2025_n0.0_s-90.0_w0.0_e90.0.tif");
    // row (0 - -40) * 240 = 9600 -> 135948 + 9600*43200 = 414855948
    expect(calls[0].range).toBe("bytes=414855948-414899147");
    expect(result.elevation).toBe(-1200);
    expect(result.surface_type).toBe("seafloor");
  });

  it("clamps the row for a point on the equator of the northern quadrant", async () => {
    const { calls } = stubFetch(() => ({ body: stripFor(0, 250), status: 206 }));

    const result = await getGebcoElevation(0, 0);

    // row (90-0)*240 = 21600 clamps to 21599 -> 135948 + 21599*43200 = 933212748
    expect(calls[0].range).toBe("bytes=933212748-933255947");
    expect(result.elevation).toBe(250);
  });

  it("honours the GEBCO_TILE_URL override", async () => {
    vi.stubEnv("GEBCO_TILE_URL", "https://tiles.example.com/gebco");
    const { calls } = stubFetch(() => ({ body: stripFor(3840, 42), status: 206 }));

    const result = await getGebcoElevation(40, -74);

    expect(calls[0].url).toBe("https://tiles.example.com/gebco/gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
    expect(result.elevation).toBe(42);
  });

  it("returns a null result for a non-partial, non-full response", async () => {
    stubFetch(() => ({ body: new Uint8Array(0), status: 404 }));

    const result = await getGebcoElevation(40, -74);

    expect(result).toEqual({
      elevation: null,
      surface_type: "unknown",
      unit: "meters",
      location: { lat: 40, lon: -74 },
      source: "gebco2025",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
      resolution: 450,
    });
  });

  it("returns a null result when the strip is shorter than the requested column", async () => {
    // col 3840 needs bytes 7680-7681; a 100 byte strip cannot satisfy that
    stubFetch(() => ({ body: stripFor(0, 999, 100), status: 206 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBeNull();
    expect(result.surface_type).toBe("unknown");
    expect(result.tile).toBe("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
  });

  it("rejects physically impossible positive values as nodata", async () => {
    // 8850 m is the tallest point on Earth; 8851 m is treated as nodata
    stubFetch(() => ({ body: stripFor(3840, 8851), status: 206 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBeNull();
    expect(result.surface_type).toBe("unknown");
  });

  it("rejects physically impossible negative values as nodata", async () => {
    // Challenger Deep is ~-10994 m; -11001 m is treated as nodata
    stubFetch(() => ({ body: stripFor(3840, -11001), status: 206 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBeNull();
    expect(result.surface_type).toBe("unknown");
  });

  it("keeps the deepest legitimate ocean depth as seafloor", async () => {
    stubFetch(() => ({ body: stripFor(3840, -10994), status: 206 }));

    const result = await getGebcoElevation(40, -74);
    expect(result.elevation).toBe(-10994);
    expect(result.surface_type).toBe("seafloor");
  });

  it("propagates a network failure to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((): Promise<Response> => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(getGebcoElevation(40, -74)).rejects.toThrow("fetch failed");
  });
});
