import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
