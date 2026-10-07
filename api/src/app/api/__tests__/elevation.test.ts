import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { mockRequest, bodyAs } from "./helpers";

interface ElevationBody {
  ok?: boolean;
  elevation: number | null;
  unit?: string;
  source?: string;
  tile?: string;
  resolution?: number;
  location?: { lat: number; lon: number };
  surface_type?: string;
  requestId?: string;
}

interface ElevationErrorBody extends ElevationBody {
  ok: false;
  error: { code: string; message: string; retryable?: boolean };
}

const mockOZT2GetElevation = vi.fn();
const mockGetPointElevation = vi.fn();
const mockGetGebcoElevation = vi.fn();

// Must be at top level so vi.mock can reference them.
// vitest 5 forwards `new` to the mock implementation, so each factory must be
// a constructible regular function — an arrow implementation would throw
// "is not a constructor" the moment the route module does `new Backend()`.
vi.mock("@/lib/storage/backend", () => ({
  HuggingFaceChunkBackend: vi.fn(function HuggingFaceChunkBackend() {
    return {};
  }),
  OZT2HuggingFaceBackend: vi.fn(function OZT2HuggingFaceBackend() {
    return {
      getElevation: (...args: unknown[]): unknown => mockOZT2GetElevation(...args),
    };
  }),
}));

vi.mock("@/lib/point-elevation", () => ({
  getPointElevation: (...args: unknown[]): unknown => mockGetPointElevation(...args),
}));

vi.mock("@/lib/gebco/cog-reader", () => ({
  getGebcoElevation: (...args: unknown[]): unknown => mockGetGebcoElevation(...args),
}));

describe("Elevation endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockOZT2GetElevation.mockResolvedValue(null);
  });

  it("returns 400 when lat is missing", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lon=86.9");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.message).toContain("lat");
    expect(data.requestId).toBeDefined();
  });

  it("returns 400 when lon is missing", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=28.0");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.message).toContain("lon");
    expect(data.requestId).toBeDefined();
  });

  it("returns 400 when lat is not a number", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=abc&lon=86.9");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 when lon is not a number", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28.0&lon=west"));
    expect(resp.status).toBe(400);
    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.error.code).toBe("INVALID_COORDS");
  });

  it.each([
    ["lat above +90", "lat=95&lon=86.9"],
    ["lat below -90", "lat=-95&lon=86.9"],
    ["lon above +180", "lat=28&lon=200"],
    ["lon below -180", "lat=28&lon=-200"],
  ])("returns 400 for %s", async (_label, search) => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest(`/api/elevation?${search}`));
    expect(resp.status).toBe(400);
    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_COORDS");
    expect(data.requestId).toBeDefined();
  });

  it("honours a caller-supplied x-request-id", async () => {
    mockGetPointElevation.mockResolvedValueOnce({ elevation: 100, surfaceType: "land", tile: "N28E086" });

    const { GET } = await import("@/app/api/elevation/route");
    const req = new NextRequest("http://localhost:8788/api/elevation?lat=28&lon=86.9", {
      headers: { "x-request-id": "trace-abc-123" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.requestId).toBe("trace-abc-123");
  });

  it("serves a HIT from the edge cache for a repeated coordinate", async () => {
    const { edgeGetJson, edgePutJson } = await import("@/lib/storage/edge-cache");
    vi.mocked(edgeGetJson).mockResolvedValueOnce({ elevation: 8849, surfaceType: "land", tile: "N28E086" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9"));
    const data = await bodyAs<ElevationBody>(resp);

    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(data.elevation).toBe(8849);
    expect(data.ok).toBe(true);
    expect(data.requestId).toBeDefined();
    expect(mockGetPointElevation).not.toHaveBeenCalled();
    expect(edgePutJson).not.toHaveBeenCalled();
  });

  it("stores a successful sample in the edge cache on MISS", async () => {
    const { edgePutJson } = await import("@/lib/storage/edge-cache");
    mockGetPointElevation.mockResolvedValueOnce({ elevation: 8849, surfaceType: "land", tile: "N28E086" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9"));

    expect(resp.headers.get("X-Cache")).toBe("MISS");
    // Coordinate-addressed data is static — a day-long edge TTL.
    expect(edgePutJson).toHaveBeenCalledWith(
      "api/elevation?lat=28.0000000&lon=86.9000000",
      expect.objectContaining({ elevation: 8849, tile: "N28E086" }),
      86400,
    );
  });

  it("does not cache a no-data sample", async () => {
    const { edgePutJson } = await import("@/lib/storage/edge-cache");
    mockGetPointElevation.mockResolvedValueOnce({ elevation: null, surfaceType: "unknown" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0&lon=0"));

    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(edgePutJson).not.toHaveBeenCalled();
  });

  it("returns elevation data from SRTM", async () => {
    mockGetPointElevation.mockResolvedValueOnce({
      elevation: 8849,
      surfaceType: "land",
      tile: "N28E086",
    });

    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=28.0&lon=86.9");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.requestId).toBeDefined();
    expect(data.elevation).toBe(8849);
    expect(data.unit).toBe("meters");
    expect(data.source).toBe("huggingface");
    expect(data.tile).toContain("N28E086");
    expect(data.resolution).toBe(30);
    expect(data.location).toEqual({ lat: 28.0, lon: 86.9 });
  });

  it("serves OZT2 as the primary source without touching merged chunks", async () => {
    mockOZT2GetElevation.mockResolvedValueOnce(8790);

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28.0&lon=86.9"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.ok).toBe(true);
    expect(data.elevation).toBe(8790);
    expect(data.source).toBe("ozt2");
    expect(data.surface_type).toBe("land");
    expect(data.unit).toBe("meters");
    expect(data.tile).toBe("");
    expect(data.resolution).toBe(30);
    expect(mockGetPointElevation).not.toHaveBeenCalled();
    expect(mockGetGebcoElevation).not.toHaveBeenCalled();
  });

  it("falls through to merged chunks when the OZT2 backend throws", async () => {
    mockOZT2GetElevation.mockRejectedValueOnce(new Error("hf tile 404"));
    mockGetPointElevation.mockResolvedValueOnce({ elevation: 8790, surfaceType: "land", tile: "N27E086" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=27.5&lon=86.9"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.source).toBe("huggingface");
    expect(data.elevation).toBe(8790);
    expect(mockGetPointElevation).toHaveBeenCalledWith(27.5, 86.9, expect.anything());
  });

  it("falls through to GEBCO when the merged chunk backend throws", async () => {
    mockGetPointElevation.mockRejectedValueOnce(new Error("chunk decode failed"));
    mockGetGebcoElevation.mockResolvedValueOnce({ elevation: -4100, surface_type: "ocean", tile: "gebco.tif" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0.5&lon=0.5"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.source).toBe("gebco2025");
    expect(data.elevation).toBe(-4100);
    expect(data.resolution).toBe(450);
  });

  it("returns the unknown-source payload when every backend throws", async () => {
    mockOZT2GetElevation.mockRejectedValueOnce(new Error("ozt2 down"));
    mockGetPointElevation.mockRejectedValueOnce(new Error("merged down"));
    mockGetGebcoElevation.mockRejectedValueOnce(new Error("gebco down"));

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0.5&lon=0.5"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ELEVATION_NO_DATA");
    expect(data.elevation).toBeNull();
    expect(data.source).toBe("none");
    expect(data.tile).toBe("");
    expect(data.resolution).toBe(0);
  });

  it("falls back to GEBCO when SRTM returns null (ocean)", async () => {
    mockGetPointElevation.mockResolvedValueOnce(null);
    mockGetGebcoElevation.mockResolvedValueOnce({
      elevation: -3380,
      surface_type: "ocean",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
    });

    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationBody>(resp);
    expect(data.requestId).toBeDefined();
    expect(data.elevation).toBe(-3380);
    expect(data.surface_type).toBe("ocean");
    expect(data.source).toBe("gebco2025");
  });

  it("includes CORS and cache headers", async () => {
    mockGetPointElevation.mockResolvedValueOnce({
      elevation: 100,
      surfaceType: "land",
      tile: "N40W105",
    });

    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=40&lon=-105");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });

  it("marks an all-source miss as no data instead of pretending it succeeded", async () => {
    mockGetPointElevation.mockResolvedValueOnce(null);
    mockGetGebcoElevation.mockResolvedValueOnce({ elevation: null, surface_type: "unknown", tile: "" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=10&lon=10"));
    expect(resp.status).toBe(200);

    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.requestId).toBeDefined();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ELEVATION_NO_DATA");
    expect(data.elevation).toBeNull();
  });

  // getElevation() swallows every backend failure internally, so the only
  // statement inside the route's own try-block that can still throw is the
  // JSON serialization of the payload. A BigInt survives every guard above
  // and makes NextResponse.json raise — exercising the ELEVATION_UNAVAILABLE
  // path and the `err instanceof Error` branch.
  it("reports ELEVATION_UNAVAILABLE with the thrown message when serialization fails", async () => {
    mockGetGebcoElevation.mockResolvedValueOnce({ elevation: 9007199254740993n, surface_type: "ocean", tile: "g" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0.5&lon=0.5"));
    expect(resp.status).toBe(502);

    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ELEVATION_UNAVAILABLE");
    expect(data.error.retryable).toBe(true);
    expect(typeof data.error.message).toBe("string");
    expect(data.error.message.length).toBeGreaterThan(0);
  });

  it("reports ELEVATION_UNAVAILABLE with a generic message for non-Error throws", async () => {
    mockGetGebcoElevation.mockResolvedValueOnce({
      // A throwing getter surfaces a plain string out of JSON.stringify, so
      // the route's `err instanceof Error` fallback branch is taken.
      elevation: {
        get boom(): never {
          // Intentionally a non-Error throw so the route's generic-message
          // fallback branch is exercised.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "kaboom";
        },
      },
      surface_type: "ocean",
      tile: "g",
    });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0.5&lon=0.5"));
    expect(resp.status).toBe(502);

    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ELEVATION_UNAVAILABLE");
    expect(data.error.message).toBe("Unknown error");
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/elevation/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("Elevation endpoint — interpolation, units and datum", () => {
  /** Body the parameter tests assert on; `metadata` is additive and optional. */
  interface ParamsBody extends ElevationBody {
    metadata?: {
      resolution_m: number;
      vertical_datum: string;
      interpolation: string;
      units: string;
      source: string;
      elevation_m: number | null;
      geoid_undulation_m: number;
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOZT2GetElevation.mockResolvedValue(8790);
  });

  it("returns the existing keys unchanged plus an additive metadata block", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9"));
    const data = await bodyAs<ParamsBody>(resp);

    // Pre-existing contract: the raw orthometric sample in metres.
    expect(data.elevation).toBe(8790);
    expect(data.unit).toBe("meters");
    expect(data.source).toBe("ozt2");
    expect(data.resolution).toBe(30);
    expect(data.ok).toBe(true);

    expect(data.metadata).toEqual({
      resolution_m: 30,
      vertical_datum: "egm96",
      interpolation: "bilinear",
      units: "meters",
      source: "ozt2",
      elevation_m: 8790,
      geoid_undulation_m: 0,
    });
  });

  it("reports nearest when the OZT2 source was asked to point-sample", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9&interpolation=nearest"));
    const data = await bodyAs<ParamsBody>(resp);
    expect(mockOZT2GetElevation).toHaveBeenCalledWith(28, 86.9, "nearest");
    expect(data.metadata?.interpolation).toBe("nearest");
  });

  it("reports nearest for the merged-chunk source, which samples one pixel", async () => {
    mockOZT2GetElevation.mockRejectedValueOnce(new Error("no ozt2 tile"));
    mockGetPointElevation.mockResolvedValueOnce({ elevation: 8790, surfaceType: "land", tile: "N28E086" });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9"));
    const data = await bodyAs<ParamsBody>(resp);
    expect(data.source).toBe("huggingface");
    expect(data.metadata?.interpolation).toBe("nearest");
  });

  it("converts to feet and keeps the raw metres in metadata", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9&units=feet"));
    const data = await bodyAs<ParamsBody>(resp);
    expect(data.elevation).toBe(28838.6); // 8790 m -> 28,838.6 ft
    expect(data.unit).toBe("feet");
    expect(data.metadata?.units).toBe("feet");
    expect(data.metadata?.elevation_m).toBe(8790);
  });

  it("adds the geoid undulation for ellipsoidal heights", async () => {
    const { egm96UndulationAt } = await import("@/lib/egm96");
    const undulation = await egm96UndulationAt(28, 86.9);

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9&datum=ellipsoid"));
    const data = await bodyAs<ParamsBody>(resp);

    expect(data.metadata?.vertical_datum).toBe("ellipsoid");
    expect(data.metadata?.geoid_undulation_m).toBeCloseTo(undulation, 2);
    expect(data.elevation).toBeCloseTo(8790 + undulation, 1);
    // SRTM is EGM96 already, so the raw sample is the orthometric height.
    expect(data.metadata?.elevation_m).toBe(8790);
  });

  it("converts a cached raw sample with the parameters of the current request", async () => {
    const { edgeGetJson } = await import("@/lib/storage/edge-cache");
    // A pre-parameters deployment cached the raw sample with no metadata.
    vi.mocked(edgeGetJson).mockResolvedValueOnce({ elevation: 8790, unit: "meters", source: "ozt2", resolution: 30 });

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=28&lon=86.9&units=feet"));
    const data = await bodyAs<ParamsBody>(resp);

    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(data.elevation).toBe(28838.6);
    expect(data.unit).toBe("feet");
    expect(data.metadata?.elevation_m).toBe(8790);
  });

  it("still reports metadata when no source answered", async () => {
    mockOZT2GetElevation.mockRejectedValue(new Error("ozt2 down"));
    mockGetPointElevation.mockRejectedValue(new Error("merged down"));
    mockGetGebcoElevation.mockRejectedValue(new Error("gebco down"));

    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest("/api/elevation?lat=0.5&lon=0.5&datum=ellipsoid"));
    const data = await bodyAs<ParamsBody>(resp);

    expect(data.ok).toBe(false);
    expect(data.elevation).toBeNull();
    expect(data.metadata?.source).toBe("none");
    expect(data.metadata?.resolution_m).toBe(0);
    expect(data.metadata?.elevation_m).toBeNull();
  });

  it.each([
    ["interpolation=cubic", "interpolation must be 'nearest' or 'bilinear'"],
    ["units=metres", "units must be 'meters' or 'feet'"],
    ["datum=wgs84", "datum must be 'egm96' or 'ellipsoid'"],
  ])("rejects %s with INVALID_PARAM", async (search, message) => {
    const { GET } = await import("@/app/api/elevation/route");
    const resp = await GET(mockRequest(`/api/elevation?lat=28&lon=86.9&${search}`));
    expect(resp.status).toBe(400);

    const data = await bodyAs<ElevationErrorBody>(resp);
    expect(data.error.code).toBe("INVALID_PARAM");
    expect(data.error.message).toBe(message);
  });

  it("keeps the raw sample in the edge cache regardless of the requested presentation", async () => {
    const { edgePutJson } = await import("@/lib/storage/edge-cache");
    const { GET } = await import("@/app/api/elevation/route");
    await GET(mockRequest("/api/elevation?lat=28&lon=86.9&units=feet&datum=ellipsoid"));

    // One cached sample serves every parameter combination, so the cache
    // stores what the source returned rather than the converted answer.
    expect(edgePutJson).toHaveBeenCalledWith(
      "api/elevation?lat=28.0000000&lon=86.9000000",
      expect.objectContaining({ elevation: 8790 }),
      86400,
    );
  });
});
