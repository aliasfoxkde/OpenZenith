import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { mockRequest } from "./helpers";

const mockOZT2GetElevation = vi.fn();
const mockGetPointElevation = vi.fn();
const mockGetGebcoElevation = vi.fn();

// Must be at top level so vi.mock can reference them
vi.mock("@/lib/storage/backend", () => ({
  HuggingFaceChunkBackend: vi.fn().mockImplementation(() => ({})),
  OZT2HuggingFaceBackend: vi.fn().mockImplementation(() => ({
    getElevation: (...args: unknown[]) => mockOZT2GetElevation(...args),
  })),
}));

vi.mock("@/lib/point-elevation", () => ({
  getPointElevation: (...args: unknown[]) => mockGetPointElevation(...args),
}));

vi.mock("@/lib/gebco/cog-reader", () => ({
  getGebcoElevation: (...args: unknown[]) => mockGetGebcoElevation(...args),
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
    const data = await resp.json();
    expect(data.ok).toBe(false);
    expect(data.error.message).toContain("lat");
    expect(data.requestId).toBeDefined();
  });

  it("returns 400 when lon is missing", async () => {
    const { GET } = await import("@/app/api/elevation/route");
    const req = mockRequest("/api/elevation?lat=28.0");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
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
    const data = await resp.json();
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
    const data = await resp.json();
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

    const data = await resp.json();
    expect(data.requestId).toBe("trace-abc-123");
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

    const data = await resp.json();
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

    const data = await resp.json();
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

    const data = await resp.json();
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

    const data = await resp.json();
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

    const data = await resp.json();
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

    const data = await resp.json();
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

    const data = await resp.json();
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
    expect(resp.status).toBe(200);

    const data = await resp.json();
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
    expect(resp.status).toBe(200);

    const data = await resp.json();
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
