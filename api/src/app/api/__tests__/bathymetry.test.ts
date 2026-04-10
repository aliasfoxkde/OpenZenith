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
});
