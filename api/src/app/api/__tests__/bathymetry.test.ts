import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

const mockGetElevationFromR2 = vi.fn();
const mockGetGebcoElevation = vi.fn();

vi.mock("@/lib/elevation/terrarium-reader", () => ({
  getElevationFromR2: (...args: unknown[]) => mockGetElevationFromR2(...args),
}));

vi.mock("@/lib/gebco/cog-reader", () => ({
  getGebcoElevation: (...args: unknown[]) => mockGetGebcoElevation(...args),
}));

describe("Bathymetry endpoint", () => {
  it("returns surface_type land for land coordinates", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({
      elevation: 10,
      surface_type: "land",
      source: "huggingface",
      tile: "N40W074",
      resolution: 30,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=40.7128&lon=-74.006");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.surface_type).toBe("land");
    expect(data.depth).toBe(0);
    expect(data.elevation).toBe(10);
    expect(data.location).toEqual({ lat: 40.7128, lon: -74.006 });
    expect(data.unit).toBe("meters");
  });

  it("includes CORS headers", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({
      elevation: 10,
      surface_type: "land",
      source: "huggingface",
      tile: "N00W000",
      resolution: 30,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns ocean surface_type via GEBCO fallback", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({ elevation: null });
    mockGetGebcoElevation.mockResolvedValueOnce({
      elevation: -3380,
      surface_type: "ocean",
      source: "gebco2025",
      tile: "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif",
      resolution: 450,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.surface_type).toBe("ocean");
    expect(data.source).toBe("gebco2025");
    expect(data.depth).toBeGreaterThan(0);
  });

  it("returns depth > 0 for deep ocean", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({ elevation: null });
    mockGetGebcoElevation.mockResolvedValueOnce({
      elevation: -10920,
      surface_type: "ocean",
      source: "gebco2025",
      tile: "gebco_2025_n30.0_s-60.0_w180.0_e-90.0.tif",
      resolution: 450,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=11.3&lon=142.2");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.surface_type).toBe("ocean");
    expect(data.depth).toBeGreaterThan(8000);
  });

  it("returns 400 for missing parameters", async () => {
    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=40.7");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for invalid coordinates", async () => {
    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=999&lon=0");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/bathymetry/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("reports source none when GEBCO throws after an SRTM miss", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({ elevation: null });
    mockGetGebcoElevation.mockRejectedValueOnce(new Error("workers memory limit on deep range"));

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=0&lon=0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.depth).toBeNull();
    expect(data.elevation).toBeNull();
    expect(data.surface_type).toBe("unknown");
    expect(data.source).toBe("none");
    expect(data.tile).toBe("");
    expect(data.location).toEqual({ lat: 0, lon: 0 });
  });

  it("returns the thrown message when the SRTM read itself fails", async () => {
    mockGetElevationFromR2.mockRejectedValueOnce(new Error("r2 binding unavailable"));

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=40.7&lon=-74.0");
    const resp = await GET(req);
    // Silent-200 contract: reader failure never becomes a 5xx.
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("r2 binding unavailable");
  });

  it("reports source none when GEBCO resolves without elevation", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({ elevation: null });
    mockGetGebcoElevation.mockResolvedValueOnce({ elevation: null });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=-30&lon=20");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.source).toBe("none");
    expect(data.elevation).toBeNull();
  });

  it("converts below-sea-level SRTM elevations into depth", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({
      elevation: -12,
      surface_type: "ocean",
      source: "huggingface",
      tile: "N40W074",
      resolution: 30,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=40.7&lon=-74.0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.depth).toBe(12);
    expect(data.elevation).toBe(0);
    expect(data.surface_type).toBe("ocean");
  });

  it("reports GEBCO land elevation as depth 0", async () => {
    mockGetElevationFromR2.mockResolvedValueOnce({ elevation: null });
    mockGetGebcoElevation.mockResolvedValueOnce({
      elevation: 15,
      surface_type: "land",
      source: "gebco2025",
      tile: "gebco_2025_tile.tif",
      resolution: 450,
    });

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=45.0&lon=6.0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.depth).toBe(0);
    expect(data.elevation).toBe(15);
    expect(data.source).toBe("gebco2025");
  });

  it("falls back to the default message for non-Error rejections", async () => {
    mockGetElevationFromR2.mockRejectedValueOnce("total nonsense");

    const { GET } = await import("@/app/api/bathymetry/route");
    const req = mockRequest("/api/bathymetry?lat=40.7&lon=-74.0");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Bathymetry query failed");
  });
});
