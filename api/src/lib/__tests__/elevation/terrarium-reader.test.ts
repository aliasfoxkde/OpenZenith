import { describe, it, expect, vi, beforeEach } from "vitest";

const getPointElevationMock = vi.fn<(lat: number, lon: number) => Promise<unknown>>();

vi.mock("@/lib/point-elevation", () => ({
  getPointElevation: (...args: unknown[]) => getPointElevationMock(...(args as [number, number])),
}));

import { getElevationFromR2 } from "../../elevation/terrarium-reader";

describe("getElevationFromR2", () => {
  beforeEach(() => {
    getPointElevationMock.mockReset();
  });

  it("maps a successful SRTM chunk lookup to the API result shape", async () => {
    getPointElevationMock.mockResolvedValue({
      elevation: 412,
      surfaceType: "land",
      source: "srtm",
      tile: "N41W074",
    });

    const result = await getElevationFromR2(41.95, -73.95);

    expect(getPointElevationMock).toHaveBeenCalledTimes(1);
    expect(getPointElevationMock.mock.calls[0][0]).toBe(41.95);
    expect(getPointElevationMock.mock.calls[0][1]).toBe(-73.95);
    expect(result).toEqual({
      elevation: 412,
      surface_type: "land",
      unit: "meters",
      location: { lat: 41.95, lon: -73.95 },
      source: "huggingface",
      tile: "N41W074",
      resolution: 30,
    });
  });

  it("preserves inland water surface type", async () => {
    getPointElevationMock.mockResolvedValue({
      elevation: 178,
      surfaceType: "inland_water",
      source: "srtm",
      tile: "N47W085",
    });

    const result = await getElevationFromR2(47.5, -85.5);
    expect(result.surface_type).toBe("inland_water");
    expect(result.elevation).toBe(178);
    expect(result.tile).toBe("N47W085");
  });

  it("returns a null-elevation result when the chunk backend has no data", async () => {
    getPointElevationMock.mockResolvedValue(null);

    const result = await getElevationFromR2(0, 0);

    expect(result).toEqual({
      elevation: null,
      surface_type: "unknown",
      unit: "meters",
      location: { lat: 0, lon: 0 },
      source: "huggingface",
      tile: "",
      resolution: 30,
    });
  });

  it("returns a null-elevation result when the lookup throws", async () => {
    getPointElevationMock.mockRejectedValue(new Error("chunk decode failed"));

    const result = await getElevationFromR2(-33.9, 18.4);

    expect(result.elevation).toBeNull();
    expect(result.surface_type).toBe("unknown");
    expect(result.tile).toBe("");
    expect(result.source).toBe("huggingface");
    expect(result.location).toEqual({ lat: -33.9, lon: 18.4 });
  });

  it("always reports the huggingface source and 30 m resolution", async () => {
    getPointElevationMock.mockResolvedValue(null);
    const miss = await getElevationFromR2(10, 10);
    getPointElevationMock.mockResolvedValue({ elevation: 1, surfaceType: "land", source: "srtm", tile: "N10E010" });
    const hit = await getElevationFromR2(10, 10);

    expect(miss.source).toBe("huggingface");
    expect(miss.resolution).toBe(30);
    expect(hit.source).toBe("huggingface");
    expect(hit.resolution).toBe(30);
  });
});
