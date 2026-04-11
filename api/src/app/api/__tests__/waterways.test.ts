import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

// Mock the cache module — cachedFetch falls through to real fetch
vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string, _ttl: number, opts?: RequestInit) => fetch(url, opts)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600, WATERWAYS: 3600 },
}));

const mockOverpassResponse = {
  elements: [
    {
      type: "way",
      id: 123,
      tags: { name: "Hudson River", waterway: "river" },
      geometry: [
        [40.7, -74.0],
        [40.8, -73.9],
        [40.9, -73.8],
      ],
    },
  ],
};

describe("Waterways endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns GeoJSON for valid bbox", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockOverpassResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(Array.isArray(data.features)).toBe(true);
    expect(data.features.length).toBe(1);
  });

  it("includes CORS headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockOverpassResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 400 for missing bbox", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for invalid bbox format", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=invalid");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for oversized bbox", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=-180,-90,180,90");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  it("filters by type=rivers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockOverpassResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8&type=rivers");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
  });

  it("respects limit parameter", async () => {
    const manyElements = {
      elements: Array.from({ length: 10 }, (_, i) => ({
        type: "way",
        id: 100 + i,
        tags: { name: `River ${i}`, waterway: "river" },
        geometry: [
          [40.6, -74.0 + i * 0.01],
          [40.7, -74.0 + i * 0.01],
        ],
      })),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(manyElements), { status: 200 }));

    const { GET } = await import("@/app/api/waterways/route");
    const req = mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8&limit=2");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.count).toBeLessThanOrEqual(2);
  });
});
