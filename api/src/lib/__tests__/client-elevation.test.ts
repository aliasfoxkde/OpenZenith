import { describe, it, expect, vi, afterEach } from "vitest";
import { zlibSync } from "fflate";
import { getClientElevation, getClientElevationBatch, getClientTileData } from "../client-elevation";

/* ─── fixture builders: OZCHNK01 merged files and GEBCO strips ─── */

const MERGED_MAGIC = [0x4F, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31]; // "OZCHNK01"
const HEADER_SIZE = 12;
const INDEX_ENTRY_SIZE = 8;

/**
 * Predictor-encode and zlib-compress one 256x256 (or 17px remainder) chunk.
 * The reader undoes horizontal differencing, so `valueAt` is the real elevation grid.
 */
function chunkPayload(valueAt: (row: number, col: number) => number, width: number, height: number): Uint8Array {
  const raw = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    let prev = 0;
    for (let c = 0; c < width; c++) {
      const decoded = valueAt(r, c) | 0;
      raw[r * width + c] = (decoded - prev) | 0;
      prev = decoded;
    }
  }
  return zlibSync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

/**
 * Build a merged file: 8 byte magic, uint16 version, rows, cols, then an
 * offset/size index for rows*cols chunks, then the concatenated payloads.
 * Slots without a payload get offset 0 / size 0, which decodes to "no chunk".
 */
function mergedFile(
  payloads: Array<{ slot: number; data: Uint8Array }>,
  rows: number,
  cols: number,
): Uint8Array {
  const entryCount = rows * cols;
  const dataStart = HEADER_SIZE + entryCount * INDEX_ENTRY_SIZE;
  const placed = new Map<number, { offset: number; size: number }>();
  let cursor = dataStart;
  for (const payload of payloads) {
    placed.set(payload.slot, { offset: cursor, size: payload.data.length });
    cursor += payload.data.length;
  }

  const out = new Uint8Array(cursor);
  out.set(MERGED_MAGIC);
  const view = new DataView(out.buffer);
  view.setUint16(8, 1, true); // version 1 = SRTM Int16
  out[10] = rows;
  out[11] = cols;
  for (let i = 0; i < entryCount; i++) {
    const entry = placed.get(i);
    view.setUint32(HEADER_SIZE + i * INDEX_ENTRY_SIZE, entry ? entry.offset : 0, true);
    view.setUint32(HEADER_SIZE + i * INDEX_ENTRY_SIZE + 4, entry ? entry.size : 0, true);
  }
  for (const payload of payloads) {
    out.set(payload.data, (placed.get(payload.slot) as { offset: number }).offset);
  }
  return out;
}

/** Chunk slot (row-major) inside a 15x15 SRTM chunk grid. */
function slot(row: number, col: number, cols = 15): number {
  return row * cols + col;
}

function writeInt16(strip: Uint8Array, col: number, value: number): void {
  const unsigned = value < 0 ? 65536 + value : value;
  strip[col * 2] = unsigned & 0xff;
  strip[col * 2 + 1] = Math.floor(unsigned / 256) & 0xff;
}

function stripFor(col: number, value: number): Uint8Array {
  const strip = new Uint8Array(21600 * 2);
  writeInt16(strip, col, value);
  return strip;
}

/* ─── fetch router ─── */

// HuggingFace layout: .../resolve/main/<latDir>/<tileBase>.merged
const HF_MERGED = /resolve\/main\/[NS]\d\d\/([NS]\d\d[EW]\d\d\d)\.merged$/;
const CEDA_STRIP = /geotiff\/(gebco_2025_\S+\.tif)$/;

interface RecordedCall {
  url: string;
  range: string | null;
}

interface Fixtures {
  /** tile base (e.g. "N41W073") -> merged bytes, or an HTTP status to fail with */
  merged?: Record<string, Uint8Array | number>;
  /** fallback for tile bases not listed in `merged` */
  mergedFor?: (tileBase: string) => Uint8Array | number | undefined;
  /** tile bases whose fetch should reject outright (network failure) */
  mergedThrows?: string[];
  /** quadrant file name -> strip bytes, or an HTTP status to fail with */
  strips?: Record<string, Uint8Array | number>;
  /** quadrant file names served with status 200 (range ignored) instead of 206 */
  stripsAt200?: Record<string, Uint8Array>;
  /** quadrant file names whose fetch should reject outright */
  stripsThrows?: string[];
  pointEndpoint?: (url: string) => Response;
  batchEndpoint?: (url: string) => Response;
}

function installFixtures(fixtures: Fixtures = {}): { calls: RecordedCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: RecordedCall[] = [];
  // Callers under test `await fetch(...)`, so a synchronous Response resolves
  // exactly like the real fetch's Promise<Response>.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const range = init?.headers ? new Headers(init.headers).get("Range") : null;
    calls.push({ url, range });

    const merged = url.match(HF_MERGED);
    if (merged) {
      if (fixtures.mergedThrows?.includes(merged[1])) throw new Error("hf offline");
      const entry = fixtures.merged?.[merged[1]] ?? fixtures.mergedFor?.(merged[1]);
      if (entry instanceof Uint8Array) return new Response(entry as unknown as BodyInit, { status: 200 });
      return new Response(null, { status: typeof entry === "number" ? entry : 404 });
    }

    const strip = url.match(CEDA_STRIP);
    if (strip) {
      if (fixtures.stripsThrows?.includes(strip[1])) throw new Error("ceda offline");
      const at200 = fixtures.stripsAt200?.[strip[1]];
      if (at200) return new Response(at200 as unknown as BodyInit, { status: 200 });
      const entry = fixtures.strips?.[strip[1]];
      if (entry instanceof Uint8Array) return new Response(entry as unknown as BodyInit, { status: 206 });
      return new Response(null, { status: typeof entry === "number" ? entry : 404 });
    }

    if (url.includes("/api/elevation/batch")) {
      return fixtures.batchEndpoint ? fixtures.batchEndpoint(url) : new Response(null, { status: 500 });
    }
    if (url.includes("/api/elevation")) {
      return fixtures.pointEndpoint ? fixtures.pointEndpoint(url) : new Response(null, { status: 500 });
    }
    return new Response(null, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A single 256x256 chunk in slot (0,0) holding 100 + row + col. */
function mergedWithLinearChunk0(): Uint8Array {
  return mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 100 + r + c, 256, 256) }], 15, 15);
}

/**
 * Chunks of one SRTM tile whose decoded value is 100 + tileRow + tileCol,
 * where tileRow/tileCol are pixel coordinates inside the whole 3601x3601 tile.
 * Edge chunks are stored 256x256 with zero-delta padding, like the real files.
 */
function linearTileChunks(coords: Array<[number, number]>): Array<{ slot: number; data: Uint8Array }> {
  return coords.map(([cr, cc]) => ({
    slot: slot(cr, cc),
    data: chunkPayload((r, c) => 100 + cr * 256 + r + cc * 256 + c, 256, 256),
  }));
}

function mergedWithFlatChunk0(value: number): Uint8Array {
  return mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => value, 256, 256) }], 15, 15);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ─── getClientElevation ─── */

describe("getClientElevation — SRTM path", () => {
  it("decodes a HuggingFace merged chunk and reports the SRTM tile", async () => {
    const { calls } = installFixtures({ merged: { N41W073: mergedWithLinearChunk0() } });

    const result = await getClientElevation(41.95, -73.95);

    // pixel (180,180) of chunk (0,0) -> 100 + 180 + 180
    expect(result).toEqual({
      elevation: 460,
      surfaceType: "land",
      tile: "N41W073",
      status: "ok",
      source: "srtm",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://huggingface.co/datasets/aliasfox/srtm30m-merged/resolve/main/N41/N41W073.merged",
    );
    expect(calls[0].range).toBeNull();
  });

  it("normalises wrap-around longitudes before choosing a tile", async () => {
    installFixtures({ merged: { N41W073: mergedWithLinearChunk0() } });

    // 286.05 - 360 = -73.95 -> the same tile and pixel as the canonical longitude
    const result = await getClientElevation(41.95, 286.05);
    expect(result).toEqual({
      elevation: 460,
      surfaceType: "land",
      tile: "N41W073",
      status: "ok",
      source: "srtm",
    });
  });

  it("reports negative SRTM values as ocean but still credits SRTM for them", async () => {
    installFixtures({ merged: { N47W073: mergedWithFlatChunk0(-25) } });

    const result = await getClientElevation(47.95, -73.95);
    expect(result).toEqual({
      elevation: -25,
      surfaceType: "ocean",
      tile: "N47W073",
      status: "ok",
      // the value genuinely came from SRTM (below-sea-level land such as
      // Death Valley) — the ocean surface type must not re-label the source
      source: "srtm",
    });
  });
});

describe("getClientElevation — GEBCO fallback", () => {
  it("falls back to a GEBCO strip when the SRTM pixel is nodata", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    const { calls } = installFixtures({
      merged: { N39W073: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -3000) },
    });

    const result = await getClientElevation(39.99, -73.99);

    expect(result).toEqual({
      elevation: -3000,
      surfaceType: "ocean",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
      status: "ok",
      source: "gebco2025",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(
      "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff/gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
    );
    // row (90 - 39.99) * 240 = 12002 -> 135948 + 12002 * 43200
    expect(calls[1].range).toBe("bytes=518622348-518665547");
  });

  it("keeps searching for a server value when the GEBCO strip is unusable", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    installFixtures({
      merged: { N38W073: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, 20000) }, // physically impossible
      pointEndpoint: () => jsonResponse({ elevation: 4.5, surface_type: "land", tile: "N38W073" }),
    });

    const result = await getClientElevation(38.99, -73.99);
    expect(result).toEqual({
      elevation: 4.5,
      surfaceType: "land",
      tile: "N38W073",
      status: "ok",
      source: undefined,
    });
  });

  it("credits GEBCO with a land surface type for positive elevations", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    installFixtures({
      merged: { N39W073: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, 150) },
    });

    const result = await getClientElevation(39.98, -73.99);
    expect(result).toMatchObject({ elevation: 150, surfaceType: "land", source: "gebco2025" });
  });

  it("reuses a cached GEBCO strip for repeat lookups without refetching", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    const { calls } = installFixtures({
      merged: { N39W073: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -3000) },
    });

    await getClientElevation(39.95, -73.99);
    await getClientElevation(39.95, -73.99);
    expect(calls.filter((c) => CEDA_STRIP.test(c.url))).toHaveLength(1);
  });

  it("accepts a GEBCO strip served with status 200 when the range is ignored", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    installFixtures({
      merged: { N39W073: nodataMerged },
      stripsAt200: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3842, -1200) },
    });

    const result = await getClientElevation(39.97, -73.99);
    expect(result).toMatchObject({ elevation: -1200, surfaceType: "ocean", source: "gebco2025" });
  });

  it("treats a rejecting GEBCO strip fetch as unusable and asks the server", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    installFixtures({
      merged: { N39W073: nodataMerged },
      stripsThrows: ["gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif"],
      pointEndpoint: () => jsonResponse({ elevation: 9, surface_type: "land", tile: "N39W073" }),
    });

    const result = await getClientElevation(39.96, -73.99);
    expect(result).toMatchObject({ elevation: 9, status: "ok", source: undefined });
  });

  it("rejects a truncated GEBCO strip that cannot hold the sampled column", async () => {
    const nodataMerged = mergedFile(
      [{ slot: slot(0, 0), data: chunkPayload(() => -32768, 256, 256) }],
      15,
      15,
    );
    installFixtures({
      merged: { N39W073: nodataMerged },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": new Uint8Array(10) },
      pointEndpoint: () => jsonResponse({ elevation: 3, surface_type: "land", tile: "N39W073" }),
    });

    const result = await getClientElevation(39.94, -73.99);
    expect(result).toMatchObject({ elevation: 3, status: "ok", source: undefined });
  });
});

describe("getClientElevation — corrupt and failing merged files", () => {
  it("treats a merged file with a bad magic number as absent and asks the server", async () => {
    const garbage = new Uint8Array(64); // right size, wrong magic
    installFixtures({
      merged: { N40W073: garbage },
      pointEndpoint: () => jsonResponse({ elevation: 7, surface_type: "land", tile: "N40W073" }),
    });

    const result = await getClientElevation(40.5, -73.5);
    expect(result).toMatchObject({ elevation: 7, status: "ok", source: undefined });
  });

  it("falls through to the server when the merged fetch rejects outright", async () => {
    installFixtures({
      mergedThrows: ["N40W073"],
      pointEndpoint: () => jsonResponse({ elevation: 8, surface_type: "land", tile: "N40W073" }),
    });

    const result = await getClientElevation(40.5, -73.5);
    expect(result).toMatchObject({ elevation: 8, status: "ok", source: undefined });
  });

  it("defaults the surface type to unknown when the server omits it", async () => {
    installFixtures({
      merged: { N42W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 6 }),
    });

    const result = await getClientElevation(41.5, -73.5);
    expect(result).toMatchObject({ elevation: 6, surfaceType: "unknown", status: "ok" });
  });
});

describe("getClientElevation — server fallback", () => {
  it("uses /api/elevation when HuggingFace has no merged file", async () => {
    const { calls } = installFixtures({
      merged: { N42W073: 404 },
      pointEndpoint: () =>
        jsonResponse({ elevation: 12.5, surface_type: "land", tile: "N42W073", source: "huggingface" }),
    });

    const result = await getClientElevation(42.95, -73.95);

    expect(result).toEqual({
      elevation: 12.5,
      surfaceType: "land",
      tile: "N42W073",
      status: "ok",
      source: "huggingface",
    });
    expect(calls.at(-1)?.url).toBe("/api/elevation?lat=42.950000&lon=-73.950000");
  });

  it("sends the normalised longitude to the server endpoint", async () => {
    const { calls } = installFixtures({
      merged: { N42W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 1, surface_type: "land", tile: "N42W073" }),
    });

    await getClientElevation(42.95, 286.05);
    expect(calls.at(-1)?.url).toBe("/api/elevation?lat=42.950000&lon=-73.950000");
  });

  it("reports no_data when the server has no elevation and flags it", async () => {
    installFixtures({
      merged: { N43W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, ok: false, surface_type: "unknown", source: "none" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "no_data",
      source: "none",
    });
  });

  it("reports no_data when the server only signals source none", async () => {
    installFixtures({
      merged: { N43W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, source: "none", tile: "N43W073" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result.status).toBe("no_data");
    expect(result.tile).toBe("N43W073");
    expect(result.surfaceType).toBe("unknown");
  });

  it("reports unavailable when the server elevation is null without a signal", async () => {
    installFixtures({
      merged: { N43W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: null, surface_type: "ocean", tile: "N43W073" }),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "unavailable",
      source: "none",
    });
  });

  it("reports unavailable when the server responds with an error status", async () => {
    installFixtures({
      merged: { N43W073: 404 },
      pointEndpoint: () => jsonResponse({ elevation: 1 }, 503),
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result.status).toBe("unavailable");
    expect(result.elevation).toBeNull();
  });

  it("reports unavailable when every network hop rejects", async () => {
    installFixtures({
      merged: { N43W073: 404 },
      pointEndpoint: () => {
        throw new TypeError("fetch failed");
      },
    });

    const result = await getClientElevation(43.95, -73.95);
    expect(result).toEqual({
      elevation: null,
      surfaceType: "unknown",
      tile: "",
      status: "unavailable",
      source: "none",
    });
  });

  it("skips the client path for points outside SRTM coverage", async () => {
    const { calls } = installFixtures({
      pointEndpoint: () => jsonResponse({ elevation: 99, surface_type: "land", tile: "" }),
    });

    const result = await getClientElevation(75, 0);

    expect(result).toEqual({
      elevation: 99,
      surfaceType: "land",
      tile: "",
      status: "ok",
      source: undefined,
    });
    expect(calls.every((call) => !call.url.includes("huggingface.co"))).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

/* ─── getClientElevationBatch ─── */

describe("getClientElevationBatch", () => {
  it("resolves SRTM points, GEBCO points and nulls in input order", async () => {
    // chunk (0,0) holds 700 + row + col; chunk (7,7) is absent -> nodata -> GEBCO
    installFixtures({
      merged: {
        N44W073: mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 700 + r + c, 256, 256) }], 15, 15),
      },
      strips: {
        // point (70, 10): row (90-70)*240 = 4800, col (10-0)*240 = 2400
        "gebco_2025_n90.0_s0.0_w0.0_e90.0.tif": stripFor(2400, -1500),
        // point (-45, 100): row (0+45)*240 = 10800, col (100-90)*240 = 2400 -> impossible value
        "gebco_2025_n0.0_s-90.0_w90.0_e180.0.tif": stripFor(2400, 20000),
        // point (44.5, -73.5): row (90-44.5)*240 = 10920, col (-73.5+90)*240 = 3960
        "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3960, -2500),
      },
    });

    const results = await getClientElevationBatch([
      { lat: 44.99, lon: -73.99, id: "a" }, // SRTM chunk (0,0) local (36,36)
      { lat: 44.95, lon: -73.95, id: "b" }, // SRTM chunk (0,0) local (180,180)
      { lat: 70, lon: 10, id: "ocean" }, // outside SRTM -> GEBCO
      { lat: -45, lon: 100, id: "no-data" }, // outside SRTM -> GEBCO nodata -> null
      { lat: 44.5, lon: -73.5, id: "missing-chunk" }, // SRTM chunk missing -> GEBCO
    ]);

    expect(results).toHaveLength(5);
    // Results are rebuilt from the caller's request fields: no internal `idx`
    // bookkeeping key, and the requested (non-normalised) longitude.
    expect(results[0]).toEqual({ lat: 44.99, lon: -73.99, id: "a", elevation: 772 });
    expect(results[1]).toEqual({ lat: 44.95, lon: -73.95, id: "b", elevation: 1060 });
    expect(results[2]).toEqual({ lat: 70, lon: 10, id: "ocean", elevation: -1500 });
    expect(results[3]).toEqual({ lat: -45, lon: 100, id: "no-data", elevation: null });
    expect(results[4]).toEqual({ lat: 44.5, lon: -73.5, id: "missing-chunk", elevation: -2500 });
  });

  it("normalises longitudes for every point before grouping tiles", async () => {
    installFixtures({
      merged: { N41W073: mergedWithLinearChunk0() },
    });

    // 286.05 - 360 = -73.95 -> same tile and pixel as the canonical longitude.
    const results = await getClientElevationBatch([{ lat: 41.95, lon: 286.05, id: "wrapped" }]);
    expect(results[0]?.elevation).toBe(460);
    // The elevation is resolved via the normalised longitude, but the caller
    // gets their requested longitude back untouched.
    expect(results[0]?.lon).toBe(286.05);
  });

  it("falls back to POST /api/elevation/batch when the merged index is unusable", async () => {
    const { calls } = installFixtures({
      // rows=1/cols=1 index cannot satisfy chunk (7,7) -> the client batch throws
      merged: { N45W073: mergedFile([], 1, 1) },
      batchEndpoint: () =>
        jsonResponse({
          results: [
            { lat: 45.5, lon: -73.5, elevation: 11 },
            { lat: 45.6, lon: -73.6, elevation: 22 },
          ],
        }),
    });

    const results = await getClientElevationBatch([
      { lat: 45.5, lon: -73.5, id: "x" },
      { lat: 45.6, lon: -73.6 },
    ]);

    // The caller's `id` fields are re-attached even though the server payload
    // omits them.
    expect(results).toEqual([
      { lat: 45.5, lon: -73.5, id: "x", elevation: 11 },
      { lat: 45.6, lon: -73.6, elevation: 22 },
    ]);
    expect(calls.at(-1)?.url).toBe("/api/elevation/batch");
    expect(calls.at(-1)?.range).toBeNull();
  });

  it("returns null elevations when the server batch endpoint errors", async () => {
    installFixtures({
      merged: { N45W073: mergedFile([], 1, 1) },
      batchEndpoint: () => jsonResponse({ error: "boom" }, 500),
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("returns null elevations when the server batch response has no results", async () => {
    installFixtures({
      merged: { N45W073: mergedFile([], 1, 1) },
      batchEndpoint: () => jsonResponse({ ok: true }),
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("returns null elevations when the server batch endpoint rejects", async () => {
    installFixtures({
      merged: { N45W073: mergedFile([], 1, 1) },
      batchEndpoint: () => {
        throw new TypeError("fetch failed");
      },
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("never leaks caller ids when the server returns more results than points", async () => {
    installFixtures({
      merged: { N45W073: mergedFile([], 1, 1) },
      batchEndpoint: () =>
        jsonResponse({ results: [{ elevation: 11 }, { elevation: 22 }] }), // one extra result
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ lat: 45.5, lon: -73.5, id: "x", elevation: 11 });
    // The surplus result has no caller point; its lat/lon must be NaN, not a
    // stale id or a fabricated coordinate.
    expect(Number.isNaN(results[1].lat)).toBe(true);
    expect(Number.isNaN(results[1].lon)).toBe(true);
    expect(results[1].id).toBeUndefined();
  });

  it("falls back to GEBCO from inside a tile group when the SRTM pixel is nodata", async () => {
    installFixtures({
      // the point lands in chunk (0,0), which decodes to pure nodata
      merged: { N43W073: mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => NODATA, 256, 256) }], 15, 15) },
      // point (43.95, -73.95): row (90 - 43.95) * 240 = 11052, col (90 - 73.95) * 240 = 3852
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3852, -1800) },
    });

    const results = await getClientElevationBatch([{ lat: 43.95, lon: -73.95, id: "sea" }]);

    expect(results[0]).toEqual({ lat: 43.95, lon: -73.95, id: "sea", elevation: -1800 });
  });

  it("evicts the oldest chunk and merged entries once the caches overflow", async () => {
    // Any requested tile is served a merged file whose entire chunk row 7 —
    // the chunk row holding latitude 41.5 — is flat 500.
    const flatRow7 = mergedFile(
      Array.from({ length: 15 }, (_, cc) => ({
        slot: slot(7, cc),
        data: chunkPayload(() => 500, 256, 256),
      })),
      15,
      15,
    );
    const { calls } = installFixtures({ mergedFor: () => flatRow7 });

    // 70 points, each in its own SRTM degree -> 70 merged files / 70 chunks,
    // which overflows both 64 entry caches
    const points = Array.from({ length: 70 }, (_, i) => ({ lat: 41.5, lon: -72 + i, id: `p${i}` }));
    const results = await getClientElevationBatch(points);

    expect(results).toHaveLength(70);
    expect(results.every((r) => r.elevation === 500)).toBe(true);

    const fetchesFor = (tile: string) => calls.filter((c) => c.url.includes(`/${tile}.merged`)).length;
    expect(fetchesFor("N41W072")).toBe(1);
    // the first tile has fallen out of both caches, so it is fetched again
    await getClientElevation(points[0].lat, points[0].lon);
    expect(fetchesFor("N41W072")).toBe(2);
    // the most recent tile is still cached
    await getClientElevation(points[69].lat, points[69].lon);
    expect(fetchesFor("N41W003")).toBe(1);
  });
});

/* ─── getClientTileData ─── */

const NODATA = -32768;

describe("getClientTileData", () => {
  it("returns a zero-filled tile for out-of-coverage requests without fetching", async () => {
    const { calls } = installFixtures();

    // z2/1/0 covers 66.5N..85.1N — north of the SRTM mask
    const tile = await getClientTileData(2, 1, 0);

    expect(tile).not.toBeNull();
    expect(tile?.width).toBe(256);
    expect(tile?.height).toBe(256);
    expect(tile?.heights).toHaveLength(65536);
    expect([...(tile?.heights as Float32Array)].every((h) => h === 0)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("fills every pixel from a single SRTM chunk when the tile sits inside it", async () => {
    installFixtures({ merged: { N46W073: mergedWithFlatChunk0(500) } });

    // z15 9652/11532 lies entirely inside chunk (0,0) of N46W073
    const tile = await getClientTileData(15, 9652, 11532);

    expect(tile?.width).toBe(256);
    expect(tile?.height).toBe(256);
    expect(tile?.heights).toHaveLength(65536);
    expect([...(tile?.heights as Float32Array)].every((h) => h === 500)).toBe(true);
  });

  it("stitches two SRTM tiles across a one-degree boundary", async () => {
    installFixtures({
      merged: {
        // west of -74: chunk (0,14) holds the remainder column (500 + row +
        // 14*17 + col for its 17 real pixels; stored 256 wide, zero padded)
        N40W074: mergedFile(
          [{ slot: slot(0, 14), data: chunkPayload((r, c) => 500 + r + 14 * 17 + c, 256, 256) }],
          15,
          15,
        ),
        // east of -74: chunk (0,0) holds 100 + row + col
        N40W073: mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 100 + r + c, 256, 256) }], 15, 15),
      },
    });

    // z13 2412/3072 straddles lon -74 near lat 40.98
    const tile = await getClientTileData(13, 2412, 3072);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // hand-computed pixel centres
    expect(at(0, 0)).toBe(813); // west of -74 -> N40W074 remainder chunk
    expect(at(0, 23)).toBe(173); // east of -74 -> N40W073 chunk (0,0)
    expect(at(128, 200)).toBe(342);
    expect(at(255, 255)).toBe(436);
    expect(at(200, 5)).toBe(909);
    expect([...heights].every((h) => h !== NODATA)).toBe(true);
  });

  it("leaves NODATA heights where the slippy tile falls outside the fetched SRTM tiles", async () => {
    // z13 2412/2816: lat 48.9225..48.8936 (SRTM rows 279..383 -> chunk row 1),
    // lon -74.00390625..-73.9599609375 (SRTM cols 0..144 -> chunk col 0).
    // Only N48W073 is served; N48W074 (lon < -74) has no merged file -> 404.
    installFixtures({
      merged: { N48W073: mergedFile(linearTileChunks([[1, 0]]), 15, 15) },
    });

    const tile = await getClientTileData(13, 2412, 2816);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // Columns 0..22 are west of -74 (N48W074) and stay NODATA.
    const nodata = [...heights].filter((h) => h === NODATA);
    expect(nodata).toHaveLength(23 * 256);
    expect(at(0, 0)).toBe(NODATA);
    expect(at(0, 22)).toBe(NODATA);

    // Column 23 onwards lands in N48W073; value = 100 + tileRow + tileCol.
    expect(at(0, 23)).toBe(379); // tile pixel (279, 0)
    expect(at(0, 255)).toBe(523); // tile pixel (279, 144)
    expect(at(128, 23)).toBe(431); // tile pixel (331, 0)
    expect(at(255, 23)).toBe(483); // tile pixel (383, 0)
    expect(at(255, 255)).toBe(627); // tile pixel (383, 144)
  });

  it("leaves NODATA where the neighbouring chunk is missing instead of wrapping values", async () => {
    // z13 2413/3072 spans chunk columns 144..302 of N40W073, i.e. chunks
    // (0,0) and (0,1); only (0,0) is present in the merged file.
    installFixtures({ merged: { N40W073: mergedWithLinearChunk0() } });

    const tile = await getClientTileData(13, 2413, 3072);
    const heights = tile?.heights as Float32Array;
    const at = (py: number, px: number) => heights[py * 256 + px];

    // Inside chunk (0,0): correct values (100 + tileRow + tileCol).
    expect(at(0, 0)).toBe(317); // tile pixel (73, 144)
    expect(at(0, 179)).toBe(428); // tile pixel (73, 255)
    // From column 256 the pixels belong to the missing chunk (0,1) — they
    // stay NODATA rather than inheriting chunk (0,0) wrapped to local col 0.
    expect(at(0, 180)).toBe(NODATA);
    expect(at(0, 255)).toBe(NODATA);
  });

  it("returns null when a needed chunk index is outside the merged index", async () => {
    // z13 2412/2852: lat 47.872..47.843 -> SRTM rows 460..566 (chunk rows 1..2),
    // so chunk (1,0) is requested. The served merged file declares a 1x1 index,
    // whose only entry cannot address chunk (1,0) -> the lookup throws and the
    // public wrapper turns that into a null tile.
    installFixtures({ merged: { N47W073: mergedFile([], 1, 1) } });

    const tile = await getClientTileData(13, 2412, 2852);

    expect(tile).toBeNull();
  });
});
