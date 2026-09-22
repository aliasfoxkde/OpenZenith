import { describe, it, expect, vi, afterEach } from "vitest";
import { mockRequest } from "./helpers";

type JsonBody = Record<string, unknown>;

const pointFeature = (id: string, lon: number, lat: number, props: JsonBody = {}): JsonBody => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, ...props },
});

const itemsRoute = () => import("@/app/api/collections/[id]/items/route");

const itemsCtx = (id: string) => ({ params: Promise.resolve({ id }) });

type FetchRoute = { match: string; respond: () => Response };

/** Route stubbed fetch calls by URL substring; anything else fails the test. */
function stubFetch(routes: FetchRoute[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return hit.respond();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Collection by ID — extended", () => {
  it("returns metadata for each known collection", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const ids = ["earthquakes", "natural_events", "wildfires", "nlnog_nodes", "warnings", "waterways"];
    for (const id of ids) {
      const resp = await GET(mockRequest(`/api/collections/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.id).toBe(id);
      expect(data.title).toBeTruthy();
      expect(data.links).toBeTruthy();
      expect(data.extent.spatial.bbox).toBeTruthy();
    }
  });

  it("includes self, items, and root links", async () => {
    const { GET } = await import("@/app/api/collections/[id]/route");
    const resp = await GET(mockRequest("/api/collections/wildfires"), {
      params: Promise.resolve({ id: "wildfires" }),
    });
    const data = await resp.json();
    const rels = data.links.map((l: { rel: string }) => l.rel);
    expect(rels).toContain("self");
    expect(rels).toContain("items");
    expect(rels).toContain("root");
  });
});

describe("Collection Items — extended", () => {
  it("OPTIONS returns CORS headers", async () => {
    const { OPTIONS } = await import("@/app/api/collections/[id]/items/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("Collection Items — upstream fetching and normalisation", () => {
  const getGET = async () => (await itemsRoute()).GET;

  it("passes an external collection straight through as GeoJSON", async () => {
    const fetchMock = stubFetch([
      {
        match: "earthquake.usgs.gov",
        respond: () =>
          new Response(JSON.stringify({ features: [pointFeature("a", -74, 40.7), pointFeature("b", 10, 20)] }), {
            status: 200,
          }),
      },
    ]);

    const GET = await getGET();
    const resp = await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/geo+json");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.numberMatched).toBe(2);
    expect(data.numberReturned).toBe(2);
    expect(data.features).toHaveLength(2);
    expect(data.timeStamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("OpenZenith/1.0");

    const rels = (data.links as Array<{ rel: string; href: string }>).map((l) => l.rel);
    expect(rels).toEqual(["self", "collection", "root"]);
    const self = (data.links as Array<{ rel: string; href: string }>).find((l) => l.rel === "self");
    expect(self?.href).toBe("http://localhost:8788/api/collections/earthquakes/items?limit=100&offset=0");
  });

  it("resolves internal collection sources against the request origin", async () => {
    const fetchMock = stubFetch([
      { match: "http://localhost:8788/api/wildfires", respond: () => new Response(JSON.stringify({ features: [] }), { status: 200 }) },
    ]);

    const GET = await getGET();
    const resp = await GET(mockRequest("/api/collections/wildfires/items"), itemsCtx("wildfires"));
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8788/api/wildfires");
    expect(await resp.json()).toMatchObject({ numberMatched: 0, numberReturned: 0 });
  });

  it("returns a 200 error payload when the upstream source is unavailable", async () => {
    stubFetch([{ match: "earthquake.usgs.gov", respond: () => new Response("too many requests", { status: 429 }) }]);

    const GET = await getGET();
    const resp = await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("Upstream data source returned 429");
  });

  it("returns a 200 error payload when the upstream fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset");
      }),
    );

    const GET = await getGET();
    const resp = await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).error).toBe("connection reset");
  });

  it("returns a 200 error payload when the upstream body is not JSON", async () => {
    stubFetch([{ match: "earthquake.usgs.gov", respond: () => new Response("<html>boom</html>", { status: 200 }) }]);

    const GET = await getGET();
    const resp = await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).error).toBeTruthy();
  });

  it("treats an upstream payload without a features array as empty", async () => {
    stubFetch([{ match: "earthquake.usgs.gov", respond: () => new Response(JSON.stringify({ metadata: {} }), { status: 200 }) }]);

    const GET = await getGET();
    const data = await (
      await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"))
    ).json();
    expect(data.features).toEqual([]);
    expect(data.numberMatched).toBe(0);
  });

  it("converts NLNOG nodes into GeoJSON points and drops entries without coordinates", async () => {
    stubFetch([
      {
        match: "http://localhost:8788/api/nlnog",
        respond: () =>
          new Response(
            JSON.stringify({
              nodes: [
                { id: 1, hostname: "ams1.example", asn: 1103, city: "Amsterdam", country: "NL", lat: 52.37, lon: 4.9 },
                { id: 2, hostname: "no-geo.example", asn: 1103, city: "Nowhere", country: "NL", lat: null, lon: null },
                { id: 3, hostname: "partial.example", asn: 1103, city: "Partial", country: "NL", lat: 51.5 },
              ],
            }),
            { status: 200 },
          ),
      },
    ]);

    const GET = await getGET();
    const data = await (
      await GET(mockRequest("/api/collections/nlnog_nodes/items"), itemsCtx("nlnog_nodes"))
    ).json();
    expect(data.numberMatched).toBe(1);
    expect(data.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [4.9, 52.37] },
        properties: { id: 1, hostname: "ams1.example", asn: 1103, city: "Amsterdam", country: "NL" },
      },
    ]);
  });

  it("lets NLNOG node data override an upstream features array", async () => {
    stubFetch([
      {
        match: "http://localhost:8788/api/nlnog",
        respond: () =>
          new Response(
            JSON.stringify({
              features: [pointFeature("raw", 1, 2)],
              nodes: [{ id: 9, hostname: "node9", asn: 1, city: "X", country: "Y", lat: 3, lon: 4 }],
            }),
            { status: 200 },
          ),
      },
    ]);

    const GET = await getGET();
    const data = await (
      await GET(mockRequest("/api/collections/nlnog_nodes/items"), itemsCtx("nlnog_nodes"))
    ).json();
    expect(data.numberMatched).toBe(1);
    expect(data.features[0].properties.hostname).toBe("node9");
  });

  it("keeps a features array for non-NLNOG collections even when nodes are present", async () => {
    stubFetch([
      {
        match: "earthquake.usgs.gov",
        respond: () =>
          new Response(JSON.stringify({ features: [pointFeature("a", 1, 2)], nodes: [{ id: 9, lat: 3, lon: 4 }] }), {
            status: 200,
          }),
      },
    ]);

    const GET = await getGET();
    const data = await (
      await GET(mockRequest("/api/collections/earthquakes/items"), itemsCtx("earthquakes"))
    ).json();
    expect(data.features[0].properties.id).toBe("a");
  });
});

describe("Collection Items — bbox filtering", () => {
  const getGET = async () => (await itemsRoute()).GET;
  const quakes = [
    pointFeature("inside", -74, 40.7),
    pointFeature("outside", 10, 20),
    { type: "Feature", properties: { id: "no-geometry" } },
  ];

  const query = async (search: string) => {
    stubFetch([
      {
        match: "earthquake.usgs.gov",
        respond: () => new Response(JSON.stringify({ features: quakes }), { status: 200 }),
      },
    ]);
    const GET = await getGET();
    return GET(mockRequest(`/api/collections/earthquakes/items${search}`), itemsCtx("earthquakes"));
  };

  it("keeps only features inside the bbox", async () => {
    const data = await (await query("?bbox=-75,39,-73,42")).json();
    expect(data.numberMatched).toBe(1);
    expect(data.features[0].properties.id).toBe("inside");
  });

  it("drops features without geometry coordinates", async () => {
    const data = await (await query("?bbox=-180,-90,180,90")).json();
    expect(data.numberMatched).toBe(2);
    expect(data.features.map((f: { properties: { id: string } }) => f.properties.id).sort()).toEqual(["inside", "outside"]);
  });

  it("matches nothing when the bbox is not numeric", async () => {
    const data = await (await query("?bbox=a,b,c,d")).json();
    expect(data.numberMatched).toBe(0);
    expect(data.numberReturned).toBe(0);
  });
});

describe("Collection Items — property filtering", () => {
  const getGET = async () => (await itemsRoute()).GET;

  const query = async (search: string) => {
    stubFetch([
      {
        match: "earthquake.usgs.gov",
        respond: () =>
          new Response(
            JSON.stringify({
              features: [
                pointFeature("q1", 1, 1, { mag: 1.5, place: "California" }),
                pointFeature("q2", 2, 2, { mag: 2.5, place: "NEVADA" }),
                pointFeature("q3", 3, 3, { mag: 3.5, place: "California" }),
                pointFeature("q4", 4, 4),
              ],
            }),
            { status: 200 },
          ),
      },
    ]);
    const GET = await getGET();
    return GET(mockRequest(`/api/collections/earthquakes/items${search}`), itemsCtx("earthquakes"));
  };

  it.each([
    ["mag:2.5", ["q2"]],
    ["place:california", ["q1", "q3"]],
    ["place:CALIFORNIA", ["q1", "q3"]],
    ["place:nevada", ["q2"]],
    ["mag:abc", []],
    ["nosuchprop:1", []],
    ["mag:>=2.5,place:california", ["q3"]],
  ])("applies %s and returns %s", async (filter, expected) => {
    const data = await (await query(`?properties=${encodeURIComponent(filter)}`)).json();
    const ids = data.features.map((f: { properties: { id: string } }) => f.properties.id);
    expect(ids).toEqual(expected);
    expect(data.numberMatched).toBe(expected.length);
  });

  it("applies inclusive and exclusive range operators", async () => {
    const expected: Record<string, string[]> = {
      "mag:>=2.5": ["q2", "q3"],
      "mag:<=2.5": ["q1", "q2"],
      "mag:>2.5": ["q3"],
      "mag:<2.5": ["q1"],
    };
    for (const [filter, ids] of Object.entries(expected)) {
      const data = await (await query(`?properties=${encodeURIComponent(filter)}`)).json();
      const got = data.features.map((f: { properties: { id: string } }) => f.properties.id);
      expect(got, filter).toEqual(ids);
      expect(data.numberMatched, filter).toBe(ids.length);
    }
  });

  it("matches nothing for a filter that has no :value separator", async () => {
    // `properties=mag` has no value — it must degrade to a non-matching
    // string filter, not crash the route (it used to throw on undefined).
    const data = await (await query("?properties=mag")).json();
    expect(data.error).toBeUndefined();
    expect(data.features).toEqual([]);
  });
});

describe("Collection Items — pagination and links", () => {
  const getGET = async () => (await itemsRoute()).GET;

  const query = async (search: string, total = 4) => {
    stubFetch([
      {
        match: "earthquake.usgs.gov",
        respond: () =>
          new Response(
            JSON.stringify({
              features: Array.from({ length: total }, (_v, i) => pointFeature(`f${i}`, i, i)),
            }),
            { status: 200 },
          ),
      },
    ]);
    const GET = await getGET();
    return GET(mockRequest(`/api/collections/earthquakes/items${search}`), itemsCtx("earthquakes"));
  };

  it("returns the requested page with next and prev links", async () => {
    const resp = await query("?limit=2&offset=1");
    const data = await resp.json();
    expect(data.numberReturned).toBe(2);
    expect(data.numberMatched).toBe(4);
    expect(data.features.map((f: { properties: { id: string } }) => f.properties.id)).toEqual(["f1", "f2"]);

    const links = data.links as Array<{ rel: string; href: string }>;
    const next = links.find((l) => l.rel === "next");
    const prev = links.find((l) => l.rel === "prev");
    expect(next?.href).toBe("http://localhost:8788/api/collections/earthquakes/items?limit=2&offset=3");
    expect(prev?.href).toBe("http://localhost:8788/api/collections/earthquakes/items?limit=2&offset=0");
  });

  it("omits the next link on the final page and clamps the prev link at zero", async () => {
    const data = await (await query("?limit=10&offset=2")).json();
    expect(data.numberReturned).toBe(2);
    const links = data.links as Array<{ rel: string; href: string }>;
    expect(links.find((l) => l.rel === "next")).toBeUndefined();
    expect(links.find((l) => l.rel === "prev")?.href).toBe(
      "http://localhost:8788/api/collections/earthquakes/items?limit=10&offset=0",
    );
  });

  it("returns an empty page when offset is past the end", async () => {
    const data = await (await query("?limit=2&offset=100")).json();
    expect(data.numberReturned).toBe(0);
    expect(data.numberMatched).toBe(4);
    expect(data.features).toEqual([]);
    expect((data.links as Array<{ rel: string }>).find((l) => l.rel === "next")).toBeUndefined();
  });

  it("caps the limit at 10000", async () => {
    const data = await (await query("?limit=999999")).json();
    expect(data.numberReturned).toBe(4);
  });

  it("treats a non-numeric offset as zero and a non-numeric limit as the default", async () => {
    const badOffset = await (await query("?offset=abc")).json();
    expect(badOffset.numberReturned).toBe(4);
    expect(badOffset.numberMatched).toBe(4);

    // parseInt("abc") is NaN — the route falls back to the default limit of 100
    const badLimit = await (await query("?limit=abc")).json();
    expect(badLimit.numberMatched).toBe(4);
    expect(badLimit.numberReturned).toBe(4);

    // Non-positive limits fall back too, rather than clamping the page to empty
    const zeroLimit = await (await query("?limit=0")).json();
    expect(zeroLimit.numberReturned).toBe(4);
  });
});
