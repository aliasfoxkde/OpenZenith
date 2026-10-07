import { describe, it, expect, vi, afterEach } from "vitest";
import { bodyAs } from "./helpers";

// Route tests run without an R2 binding, where the real edgeGetJson resolves
// null. The mock mirrors that default but lets individual tests plant a
// cache entry to drive the HIT path.
const r2State = vi.hoisted<{ cached?: unknown }>(() => ({ cached: undefined }));

vi.mock("@/lib/storage/edge-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/edge-cache")>();
  return { ...actual, edgeGetJson: () => Promise.resolve(r2State.cached) };
});

const mockNlnogNodes = [
  { id: 1, hostname: "ams01", asn: 123, ipv4: "1.2.3.4", city: "Amsterdam", countrycode: "NL", geo: "52.37,4.9" },
  { id: 2, hostname: "lon01", asn: 456, ipv4: "5.6.7.8", city: "London", countrycode: "GB", geo: "51.51,-0.13" },
];

/** Parsed node as the route emits it (fields blanked upstream stay absent). */
interface NlnogNode {
  id?: number;
  hostname?: string;
  asn?: number;
  ipv4?: string;
  city?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

interface NlnogBody {
  nodes: NlnogNode[];
  count?: number;
  error?: string;
}

/** Stub fetch with a fixed response for the duration of one test. */
const stubUpstream = (body: string, status = 200): void => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { status }))));
};

// Wholesale fetch stub per test (see airquality.test.ts for why the
// mockResolvedValueOnce queue pattern is avoided here).
describe("NLNOG endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    r2State.cached = undefined;
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/nlnog/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves an R2 cache hit with X-Cache HIT and skips upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    r2State.cached = { nodes: [{ id: 7, hostname: "cached" }], count: 1 };

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("cache-control")).toContain("max-age=3600");

    const data = await bodyAs<NlnogBody>(resp);
    expect(data.nodes).toEqual([{ id: 7, hostname: "cached" }]);
    expect(data.count).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 502 naming the upstream status when the NLNOG API fails", async () => {
    stubUpstream("service unavailable", 503);

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(502);
    expect(resp.headers.get("x-cache")).toBeNull();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");

    const data = await bodyAs<NlnogBody>(resp);
    expect(data.error).toBe("NLNOG API returned 503");
  });

  it("reads nodes from the {results:{nodes:[...]}} envelope", async () => {
    stubUpstream(JSON.stringify({ info: { nodes_found: 2 }, results: { nodes: mockNlnogNodes } }));

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.headers.get("X-Cache")).toBe("MISS");

    const data = await bodyAs<NlnogBody>(resp);
    expect(data.count).toBe(2);
    expect(data.nodes.map((n) => n.hostname)).toEqual(["ams01", "lon01"]);
  });

  it("returns an empty node list when the envelope carries no results", async () => {
    stubUpstream(JSON.stringify({ info: { nodes_found: 0 } }));

    const { GET } = await import("@/app/api/nlnog/route");
    const data = await bodyAs<NlnogBody>(await GET());
    expect(data.nodes).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns an empty node list when the upstream body is not an object", async () => {
    stubUpstream("null");

    const { GET } = await import("@/app/api/nlnog/route");
    const data = await bodyAs<NlnogBody>(await GET());
    expect(data.nodes).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("drops nodes without geo and geo strings that do not parse to coordinates", async () => {
    const messy = [
      { id: 1, hostname: "ok", geo: "52.37,4.9" },
      { id: 2, hostname: "no-geo" }, // filtered out before parsing
      { id: 3, hostname: "non-numeric", geo: "abc,def" }, // both coords NaN
      { id: 4, hostname: "lon-only", geo: "52.0,nan" }, // lon NaN
      { id: 5, hostname: "lat-only", geo: "nan,4.0" }, // lat NaN
    ];
    stubUpstream(JSON.stringify(messy));

    const { GET } = await import("@/app/api/nlnog/route");
    const data = await bodyAs<NlnogBody>(await GET());
    expect(data.count).toBe(1);
    expect(data.nodes).toEqual([
      { id: 1, hostname: "ok", asn: undefined, ipv4: undefined, city: undefined, country: undefined, lat: 52.37, lon: 4.9 },
    ]);
  });

  it("returns 502 with the thrown message when the upstream request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("nlnog unreachable"))));

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(502);

    const data = await bodyAs<NlnogBody>(resp);
    expect(data.error).toBe("nlnog unreachable");
  });

  it("returns 502 with a generic message when the rejection is not an Error", async () => {
    // The route's catch maps any non-Error rejection reason to a generic string.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("aborted")));

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(502);

    const data = await bodyAs<NlnogBody>(resp);
    expect(data.error).toBe("Failed to fetch NLNOG nodes");
  });

  it("returns nodes array with count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(mockNlnogNodes), { status: 200 }))),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.status).toBe(200);

    const data = await bodyAs<NlnogBody>(resp);
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(typeof data.count).toBe("number");
    expect(data.count).toBe(data.nodes.length);
    expect(data.count).toBe(2);
  });

  it("nodes have required fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(mockNlnogNodes), { status: 200 }))),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    const data = await bodyAs<NlnogBody>(resp);

    if (data.nodes.length === 0) return;

    const node = data.nodes[0];
    expect(typeof node.id).toBe("number");
    expect(typeof node.hostname).toBe("string");
    expect(typeof node.lat).toBe("number");
    expect(typeof node.lon).toBe("number");
  });

  it("includes CORS and cache headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(mockNlnogNodes), { status: 200 }))),
    );

    const { GET } = await import("@/app/api/nlnog/route");
    const resp = await GET();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });
});
