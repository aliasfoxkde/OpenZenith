import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

// Overpass `out body geom` attaches per-way geometry as {lat, lon} objects —
// without the geom modifier ways carry only a node-id list and the route
// could never emit a feature (that bug shipped once; see the query test).
const mockOverpassResponse = {
  elements: [
    {
      type: "way",
      id: 123,
      tags: { name: "Hudson River", waterway: "river" },
      geometry: [
        { lat: 40.7, lon: -74.0 },
        { lat: 40.8, lon: -73.9 },
        { lat: 40.9, lon: -73.8 },
      ],
    },
  ],
};

/** Capture the URL the route handed to fetch (the Overpass interpreter call). */
async function captureOverpassUrl(search = ""): Promise<{ url: string; query: string }> {
  let captured = "";
  vi.spyOn(globalThis, "fetch").mockImplementationOnce((input: RequestInfo | URL) => {
    captured = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(new Response(JSON.stringify(mockOverpassResponse), { status: 200 }));
  });

  const { GET } = await import("@/app/api/waterways/route");
  const resp = await GET(mockRequest(`/api/waterways?bbox=-74.1,40.6,-73.9,40.8${search}`));
  expect(resp.status).toBe(200);
  const query = decodeURIComponent(new URL(captured).searchParams.get("data") ?? "");
  return { url: captured, query };
}

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

  it("returns 400 when only the longitude span is oversized", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    // 0.2 deg of latitude (fine) with 20 deg of longitude (too wide).
    const resp = await GET(mockRequest("/api/waterways?bbox=-84.1,40.6,-64.1,40.8"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("too large");
  });

  it("returns 400 when only the latitude span is oversized", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    // 0.2 deg of longitude (fine) with 120 deg of latitude (too tall).
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,-60,-73.9,60"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("too large");
  });

  it("returns 400 when a bbox component is non-numeric", async () => {
    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,north"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid bbox format");
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

  it("sends the waterway-only filter for type=rivers", async () => {
    const { query } = await captureOverpassUrl("&type=rivers");
    expect(query).toContain('way["waterway"~"river|stream|canal"]');
    expect(query).not.toContain('"natural"');
  });

  it("sends the water-polygon filter for type=lakes", async () => {
    const { query } = await captureOverpassUrl("&type=lakes");
    expect(query).toContain('["natural"="water"]["water"!="river"]');
    expect(query).not.toContain("waterway");
  });

  it("combines both filters for the default type=all", async () => {
    const { query } = await captureOverpassUrl("&type=all");
    expect(query).toContain('["waterway"~"river|stream|canal"]["natural"="water"]');
    expect(query).toContain("(40.6,-74.1,40.8,-73.9)");
  });

  it("requests geometry from Overpass — plain out body emits none", async () => {
    // Regression: with `out body;` alone, ways carry only a node-id list and
    // every response degraded to an empty FeatureCollection.
    const { query } = await captureOverpassUrl();
    expect(query).toContain("out body geom;");
  });

  it("respects limit parameter", async () => {
    const manyElements = {
      elements: Array.from({ length: 10 }, (_, i) => ({
        type: "way",
        id: 100 + i,
        tags: { name: `River ${i}`, waterway: "river" },
        geometry: [
          { lat: 40.6, lon: -74.0 + i * 0.01 },
          { lat: 40.7, lon: -74.0 + i * 0.01 },
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

  it("returns an empty FeatureCollection when the payload has no elements array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ remark: "empty" }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.features).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("skips non-way elements and ways without usable geometry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          elements: [
            { type: "node", id: 1, lat: 40.7, lon: -74.0 },
            { type: "way", id: 2 }, // no geometry at all
            { type: "way", id: 3, geometry: [{ lat: 40.7, lon: -74.0 }] }, // single point
            { type: "way", id: 4, geometry: [] }, // empty geometry
          ],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.features).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("emits a Polygon for a closed way", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          elements: [
            {
              type: "way",
              id: 7,
              tags: { name: "Lake A", natural: "water", water: "pond" },
              geometry: [
                { lat: 40.6, lon: -74.1 },
                { lat: 40.8, lon: -74.1 },
                { lat: 40.8, lon: -73.9 },
                { lat: 40.6, lon: -74.1 },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.count).toBe(1);
    expect(data.features[0].geometry.type).toBe("Polygon");
    // Overpass geometry is {lat, lon} objects; GeoJSON wants [lon, lat].
    expect(data.features[0].geometry.coordinates[0][0]).toEqual([-74.1, 40.6]);
    expect(data.features[0].properties).toEqual({
      id: 7,
      name: "Lake A",
      waterway: null,
      natural: "water",
      water: "pond",
    });
  });

  it("treats an open natural=water way as a Polygon", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          elements: [
            {
              type: "way",
              id: 8,
              tags: { natural: "water" },
              geometry: [
                { lat: 40.6, lon: -74.1 },
                { lat: 40.7, lon: -74.0 },
                { lat: 40.8, lon: -73.9 },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.features[0].geometry.type).toBe("Polygon");
    expect(data.features[0].geometry.coordinates).toHaveLength(1);
  });

  it("emits a LineString for an unclosed waterway and nulls absent tags", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          elements: [
            {
              type: "way",
              id: 9,
              geometry: [
                { lat: 40.6, lon: -74.1 },
                { lat: 40.8, lon: -73.9 },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.count).toBe(1);
    expect(data.features[0].geometry.type).toBe("LineString");
    expect(data.features[0].geometry.coordinates).toEqual([
      [-74.1, 40.6],
      [-73.9, 40.8],
    ]);
    expect(data.features[0].properties).toEqual({
      id: 9,
      name: null,
      waterway: null,
      natural: null,
      water: null,
    });
  });

  it("returns a silent 200 when Overpass is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }));

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Overpass API unavailable");
  });

  it("returns a silent 200 when the Overpass request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unreachable"));

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Waterways query failed");
  });

  it("returns a silent 200 when Overpass replies with non-JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>rate limited</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    const { GET } = await import("@/app/api/waterways/route");
    const resp = await GET(mockRequest("/api/waterways?bbox=-74.1,40.6,-73.9,40.8"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Waterways query failed");
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/waterways/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
