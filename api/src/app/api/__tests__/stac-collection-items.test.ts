import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/stac/collections/[id]/items — GeoJSON items for a STAC
 * collection.
 *
 * `cachedFetch` is the shared global test double that forwards to `fetch`, so
 * stubbing `fetch` is enough to control upstream. The suite covers the
 * collection registry, both upstream payload shapes, bbox/limit handling, and
 * the 200-with-error-payload failure contract.
 */

const USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: Record<string, unknown>;
  id?: string | number;
};

interface ItemsResponse {
  type: string;
  features: PointFeature[];
  numberMatched: number;
  numberReturned: number;
  error?: string;
}

function pointFeature(lon: number, lat: number, id: number): PointFeature {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { id }, id };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const mockFetch = vi.fn();

function request(id: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/stac/collections/${id}/items${query}`);
}

function items(id: string, query = ""): Promise<Response> {
  return import("@/app/api/stac/collections/[id]/items/route").then((mod) =>
    mod.GET(request(id, query), { params: Promise.resolve({ id }) }),
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("STAC collection items — collection resolution", () => {
  it("returns 404 for an unregistered collection id", async () => {
    const resp = await items("volcanoes");
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Collection 'volcanoes' not found");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves every registered collection to an upstream source", async () => {
    for (const id of ["earthquakes", "flights", "vessels", "weather"]) {
      mockFetch.mockResolvedValueOnce(jsonResponse({ type: "FeatureCollection", features: [] }));
      const resp = await items(id);
      expect(resp.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toMatch(/^https:\/\//);
      mockFetch.mockClear();
    }
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/stac/collections/[id]/items/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});

describe("STAC collection items — upstream payloads", () => {
  it("passes a FeatureCollection through with counts and the collection TTL", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "FeatureCollection", features: [pointFeature(-74, 40.7, 1), pointFeature(10, 48, 2)] }),
    );

    const resp = await items("earthquakes");
    expect(resp.status).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(USGS_URL);
    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string>; signal: AbortSignal };
    expect(init.headers["User-Agent"]).toBe("OpenZenith/1.0");
    expect(init.signal.aborted).toBe(false);

    const body = (await resp.json()) as ItemsResponse;
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(2);
    expect(body.numberMatched).toBe(2);
    expect(body.numberReturned).toBe(2);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("wraps a bare geometry array into features", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        geometries: [
          { type: "Point", coordinates: [0, 0] },
          { type: "LineString", coordinates: [
            [0, 0],
            [1, 1],
          ] },
        ],
      }),
    );

    const resp = await items("flights");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(2);
    expect(body.features[0]).toMatchObject({ type: "Feature", id: 0, geometry: { type: "Point" } });
    expect(body.features[1]).toMatchObject({ type: "Feature", id: 1, geometry: { type: "LineString" } });
    expect(body.numberReturned).toBe(2);
  });

  it("returns an empty FeatureCollection for an unrecognized payload shape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ something: "else" }));

    const resp = await items("earthquakes");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toEqual([]);
    expect(body.numberMatched).toBe(0);
  });

  it("returns a 200 error payload when upstream reports a non-OK status", async () => {
    mockFetch.mockResolvedValueOnce(new Response("upstream down", { status: 502 }));

    const resp = await items("earthquakes");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Upstream returned 502");
  });

  it("returns a 200 error payload when the cached fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection reset"));

    const resp = await items("earthquakes");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("connection reset");
  });
});

describe("STAC collection items — bbox filtering", () => {
  it("keeps only features inside the requested bbox", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        type: "FeatureCollection",
        features: [pointFeature(-74, 40.7, 1), pointFeature(10, 48, 2), pointFeature(139, 35, 3)],
      }),
    );

    const resp = await items("earthquakes", "?bbox=5,40,20,55");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(1);
    expect((body.features[0].geometry as { coordinates: [number, number] }).coordinates).toEqual([10, 48]);
    expect(body.numberMatched).toBe(1);
    expect(body.numberReturned).toBe(1);
  });

  it("drops features without geometry when a bbox is applied", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: null, properties: {} }, pointFeature(0, 0, 2)],
      }),
    );

    const resp = await items("earthquakes", "?bbox=-1,-1,1,1");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(1);
    expect(body.features[0].id).toBe(2);
  });

  it("ignores a malformed bbox instead of filtering everything out", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "FeatureCollection", features: [pointFeature(-74, 40.7, 1), pointFeature(10, 48, 2)] }),
    );

    const resp = await items("earthquakes", "?bbox=west,south,east,north");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(2);
  });

  it("does not filter when no bbox is supplied", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "FeatureCollection", features: [pointFeature(-74, 40.7, 1), pointFeature(10, 48, 2)] }),
    );

    const resp = await items("earthquakes");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(2);
  });
});

describe("STAC collection items — limit handling", () => {
  it("slices features to the requested limit", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "FeatureCollection", features: [1, 2, 3, 4, 5].map((n) => pointFeature(n, n, n)) }),
    );

    const resp = await items("earthquakes", "?limit=2");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(2);
    expect(body.numberMatched).toBe(2);
  });

  it("clamps a zero limit up to 1", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ type: "FeatureCollection", features: [1, 2].map((n) => pointFeature(n, n, n)) }),
    );

    const resp = await items("earthquakes", "?limit=0");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(1);
  });

  it("caps a huge limit at 1000", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        type: "FeatureCollection",
        features: Array.from({ length: 1005 }, (_, i) => pointFeature(0, 0, i)),
      }),
    );

    const resp = await items("earthquakes", "?limit=99999");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(1000);
    expect(body.numberReturned).toBe(1000);
  });

  it("defaults to 100 items when limit is absent", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        type: "FeatureCollection",
        features: Array.from({ length: 150 }, (_, i) => pointFeature(0, 0, i)),
      }),
    );

    const resp = await items("earthquakes");
    const body = (await resp.json()) as ItemsResponse;
    expect(body.features).toHaveLength(100);
  });
});
