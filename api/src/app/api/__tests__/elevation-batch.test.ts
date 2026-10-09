import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest, bodyAs } from "./helpers";
import { getTileData } from "@/lib/tile";

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array([100, 200, 150, 250, 300, 350, 400, 450, 500]),
    width: 3,
    height: 3,
  }),
}));

// Let the route's tile math run normally unless a test pins a failure to a
// marker latitude (the 400-validation above never reaches zoom-math).
const notAnError: unknown = { fatal: "not an Error instance" };
vi.mock("@/lib/srtm/zoom-math", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/srtm/zoom-math")>();
  return {
    ...actual,
    latLonToTile: vi.fn((lat: number, lon: number, zoom: number) => {
      if (lat === 77.77) throw new Error("tile math exploded");
      if (lat === 77.78) throw notAnError;
      return actual.latLonToTile(lat, lon, zoom);
    }),
  };
});

/** Success/error union the batch route can return. */
interface ElevationBatchBody {
  results?: Array<{
    id?: string;
    lat: number;
    lon: number;
    elevation: number | null;
    /** Raw EGM96 orthometric sample in metres. */
    elevation_m?: number | null;
  }>;
  error?: string;
}

describe("Elevation Batch API", () => {
  it("answers CORS preflight requests", async () => {
    const { OPTIONS } = await import("@/app/api/elevation/batch/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns elevations for valid points", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7, lon: -74.0 },
          { lat: 51.5, lon: -0.1 },
        ],
      }),
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const data = await bodyAs<ElevationBatchBody>(resp);
    expect(data.results).toHaveLength(2);
    const first = data.results![0]!; // bounds: length 2 asserted above
    expect(first.lat).toBe(40.7);
    expect(first.lon).toBe(-74.0);
    expect(typeof first.elevation).toBe("number");
  });

  it("rejects empty points array", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [] }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects more than 2000 points", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const points = Array.from({ length: 2001 }, (_, i) => ({ lat: 0, lon: i * 0.01 }));
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid coordinates", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 999, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", "not json");
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("preserves optional id field", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({ points: [{ lat: 40.7, lon: -74.0, id: "nyc" }] }),
    );
    const resp = await POST(req);
    const data = await bodyAs<ElevationBatchBody>(resp);
    expect(data.results![0]!.id).toBe("nyc"); // bounds: one point posted
  });

  it("groups points that share a tile into one fetch", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const fetchesBefore = vi.mocked(getTileData).mock.calls.length;
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7001, lon: -74.0001 },
          { lat: 40.7002, lon: -74.0002 },
        ],
      }),
    );
    const resp = await POST(req);
    const data = await bodyAs<ElevationBatchBody>(resp);
    expect(data.results).toHaveLength(2);
    expect(vi.mocked(getTileData).mock.calls.length).toBe(fetchesBefore + 1);
  });

  it("returns null elevation when the whole sampled neighbourhood is nodata", async () => {
    vi.mocked(getTileData).mockResolvedValueOnce({
      data: new Int16Array(9).fill(-32768),
      width: 3,
      height: 3,
      zoom: 12,
    });
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 40.7, lon: -74.0 }] }));
    const resp = await POST(req);
    const data = await bodyAs<ElevationBatchBody>(resp);
    expect(data.results![0]!.elevation).toBeNull(); // bounds: one point posted
  });

  it("reports null for points whose tile fails to load, without failing the batch", async () => {
    vi.mocked(getTileData).mockRejectedValueOnce(new Error("upstream 500"));
    const { POST } = await import("@/app/api/elevation/batch/route");
    // Two different z12 tiles: the first fails, the second uses the default mock.
    const req = mockRequest(
      "/api/elevation/batch",
      "POST",
      JSON.stringify({
        points: [
          { lat: 40.7, lon: -74.0 },
          { lat: 51.5, lon: -0.1 },
        ],
      }),
    );
    const resp = await POST(req);
    const data = await bodyAs<ElevationBatchBody>(resp);
    expect(data.results![0]!.elevation).toBeNull(); // bounds: two points posted
    expect(typeof data.results?.[1]!.elevation).toBe("number");
  });

  it("returns 500 with an Error's message when tile math throws", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 77.77, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(500);
    expect(await bodyAs<ElevationBatchBody>(resp)).toEqual({ error: "tile math exploded" });
  });

  it("reports 500 with Unknown error for non-Error throws", async () => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest("/api/elevation/batch", "POST", JSON.stringify({ points: [{ lat: 77.78, lon: 0 }] }));
    const resp = await POST(req);
    expect(resp.status).toBe(500);
    expect(await bodyAs<ElevationBatchBody>(resp)).toEqual({ error: "Unknown error" });
  });
});

describe("Elevation Batch API — interpolation, units and datum", () => {
  /** Success body including the additive `elevation_m` and `metadata` keys. */
  interface ParamBody extends ElevationBatchBody {
    metadata?: {
      resolution_m: number;
      vertical_datum: string;
      interpolation: string;
      units: string;
      source: string;
    };
  }

  /** Round to the 0.1 step the endpoints present values at. */
  const round1 = (n: number) => Math.round(n * 10) / 10;

  beforeEach(() => {
    vi.mocked(getTileData).mockResolvedValue({
      data: new Int16Array([100, 200, 150, 250, 300, 350, 400, 450, 500]),
      width: 3,
      height: 3,
      zoom: 12,
    });
  });

  const post = async (query: string, points: Array<{ lat: number; lon: number; id?: string }>) => {
    const { POST } = await import("@/app/api/elevation/batch/route");
    const req = mockRequest(`/api/elevation/batch${query}`, "POST", JSON.stringify({ points }));
    return bodyAs<ParamBody>(await POST(req));
  };

  it("adds elevation_m and a metadata block without changing elevation", async () => {
    const data = await post("", [{ lat: 40.7, lon: -74.0 }]);

    expect(typeof data.results![0]!.elevation_m).toBe("number"); // bounds: one point posted
    // meters + egm96 is the identity, so both spellings agree.
    expect(data.results![0]!.elevation).toBe(data.results![0]!.elevation_m);
    expect(data.metadata).toEqual({
      resolution_m: 30,
      vertical_datum: "egm96",
      interpolation: "bilinear",
      units: "meters",
      source: "huggingface",
    });
  });

  it("threads interpolation=nearest to the sampler", async () => {
    const data = await post("?interpolation=nearest", [{ lat: 40.7, lon: -74.0 }]);

    expect(data.metadata?.interpolation).toBe("nearest");
    // Nearest can only ever return a pixel value from the mocked 3x3 grid.
    expect([100, 200, 150, 250, 300, 350, 400, 450, 500]).toContain(data.results![0]!.elevation);
  });

  it("reports a mixed batch in feet against the raw metres", async () => {
    const data = await post("?units=feet", [
      { lat: 40.7, lon: -74.0 },
      { lat: 51.5, lon: -0.1 },
    ]);

    expect(data.metadata?.units).toBe("feet");
    for (const r of data.results ?? []) {
      expect(typeof r.elevation_m).toBe("number");
      expect(r.elevation).toBe(round1((r.elevation_m as number) / 0.3048));
    }
  });

  it("adds the undulation per point for ellipsoidal heights", async () => {
    const { egm96UndulationAt } = await import("@/lib/egm96");
    const spots = [
      { lat: 40.7, lon: -74.0 },
      { lat: 51.5, lon: -0.1 },
    ];
    const data = await post("?datum=ellipsoid", spots);

    expect(data.metadata?.vertical_datum).toBe("ellipsoid");
    for (const [i, r] of (data.results ?? []).entries()) {
      // bounds: results mirror the two spots posted above
      const undulation = await egm96UndulationAt(spots[i]!.lat, spots[i]!.lon);
      expect(r.elevation).toBe(round1((r.elevation_m as number) + undulation));
    }
  });

  it("leaves a nodata result null in every presentation", async () => {
    vi.mocked(getTileData).mockResolvedValueOnce({
      data: new Int16Array(9).fill(-32768),
      width: 3,
      height: 3,
      zoom: 12,
    });
    const data = await post("?units=feet&datum=ellipsoid", [{ lat: 40.7, lon: -74.0 }]);

    expect(data.results![0]!.elevation).toBeNull(); // bounds: one point posted
    expect(data.results![0]!.elevation_m).toBeNull();
  });

  it.each([
    ["interpolation=cubic", "interpolation must be 'nearest' or 'bilinear'"],
    ["units=metres", "units must be 'meters' or 'feet'"],
    ["datum=wgs84", "datum must be 'egm96' or 'ellipsoid'"],
  ])("rejects %s before reading the body", async (query, message) => {
    const data = await post(`?${query}`, [{ lat: 40.7, lon: -74.0 }]);
    expect(data).toEqual({ error: message });
  });
});
