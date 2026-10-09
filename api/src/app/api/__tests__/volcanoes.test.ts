import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The volcanoes endpoint proxies the USGS HANS API as GeoJSON. The
 * Smithsonian GVP RSS it replaced is browser-CORS-blocked AND bot-gated
 * against server fetches (JS challenge), so HANS is the only viable live
 * upstream. These pin the join contract: CAP entries (coordinates included)
 * merge with the broader elevated list, missing coordinates are backfilled
 * per-vnum, and an unavailable upstream becomes the codebase's silent-200
 * convention (empty FeatureCollection + `x-volcano-status` header).
 */

const CAP = [
  {
    volcano_name: "Great Sitkin",
    vnum: "311120",
    latitude: 52.0765,
    longitude: -176.1109,
    alert_level: "WATCH",
    synopsis: "Slow eruption of lava continues.",
    obs_fullname: "Alaska Volcano Observatory",
  },
];
const ELEVATED = [
  ...CAP,
  { volcano_name: "Gareloi", vnum: "311070", alert_level: "ADVISORY" }, // needs coord backfill
  { volcano_name: "Kilauea", vnum: "332010", alert_level: "WARNING" }, // needs coord backfill
];
const META_311070 = { latitude: 51.7892, longitude: -178.796 };
const META_332010 = { latitude: 19.421, longitude: -155.287 };

let upstream: (url: string) => Response;
let fetchCalls: Array<[RequestInfo | URL, RequestInit?]>;

/** Install a URL-routing fetch mock (the route makes several fetches) and invoke the handler. */
async function GETViaUpstream(): Promise<Response> {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(upstream(url));
  });
  fetchCalls = spy.mock.calls;
  const { GET } = await import("@/app/api/volcanoes/route");
  return GET();
}

describe("Volcanoes proxy endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    upstream = () => new Response("{}", { status: 503 });
    fetchCalls = [];
  });

  it("joins CAP + elevated lists into GeoJSON, backfilling coordinates per vnum", async () => {
    upstream = (url) => {
      if (url.endsWith("getCapElevated")) return new Response(JSON.stringify(CAP), { status: 200 });
      if (url.endsWith("getElevatedVolcanoes")) return new Response(JSON.stringify(ELEVATED), { status: 200 });
      if (url.endsWith("getVolcano/311070")) return new Response(JSON.stringify(META_311070), { status: 200 });
      if (url.endsWith("getVolcano/332010")) return new Response(JSON.stringify(META_332010), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const resp = await GETViaUpstream();
    const fc = (await resp.json()) as { features: Array<{ properties: Record<string, string> }> };
    expect(resp.headers.get("Content-Type")).toContain("geo+json");
    expect(resp.headers.get("x-volcano-status")).toBe("ok");
    // Deduped by vnum: CAP entry kept once, both advisory entries coord-backed.
    expect(fc.features).toHaveLength(3);
    // bounds: the toEqual below pins exactly these three named features
    const alerts = Object.fromEntries(
      fc.features.map((f): [string, string] => [f.properties.name!, f.properties.alertLevel!]),
    );
    expect(alerts).toEqual({ "Great Sitkin": "WATCH", Gareloi: "ADVISORY", Kilauea: "WARNING" });
  });

  it("emits GVP-consistent colours and keeps both property-naming conventions", async () => {
    upstream = (url) => {
      if (url.endsWith("getCapElevated")) return new Response(JSON.stringify(CAP), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const resp = await GETViaUpstream();
    const fc = (await resp.json()) as { features: Array<{ properties: Record<string, string> }> };
    const p = fc.features[0]!.properties; // bounds: the stubbed upstream emits one feature
    expect(p.color).toBe("#f97316"); // WATCH → orange
    expect(p.title).toBe(p.name);
    expect(p.alert).toBe(p.alertLevel);
  });

  it("drops lookups that fail but keeps the rest of the feed", async () => {
    upstream = (url) => {
      if (url.endsWith("getCapElevated")) return new Response(JSON.stringify(CAP), { status: 200 });
      if (url.endsWith("getElevatedVolcanoes")) return new Response(JSON.stringify(ELEVATED), { status: 200 });
      if (url.endsWith("getVolcano/311070")) return new Response(JSON.stringify(META_311070), { status: 200 });
      return new Response("{}", { status: 500 }); // 332010 lookup fails
    };
    const resp = await GETViaUpstream();
    const fc = (await resp.json()) as { features: Array<{ properties: Record<string, unknown> }> };
    expect(fc.features.map((f) => f.properties.name).sort()).toEqual(["Gareloi", "Great Sitkin"]);
  });

  it("bounds the per-request coordinate backfill", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      volcano_name: `Volcano ${i}`,
      vnum: `1000${i}`,
      alert_level: "ADVISORY",
    }));
    upstream = (url) => {
      if (url.endsWith("getCapElevated")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith("getElevatedVolcanoes")) return new Response(JSON.stringify(many), { status: 200 });
      return new Response(JSON.stringify({ latitude: 1, longitude: 2 }), { status: 200 });
    };
    await GETViaUpstream();
    const lookups = fetchCalls.filter(([u]) => typeof u === "string" && u.includes("getVolcano/")).length;
    expect(lookups).toBeLessThanOrEqual(8);
  });

  it("returns a silent 200 empty FeatureCollection when an upstream is unavailable", async () => {
    upstream = () => new Response("", { status: 503 });
    const resp = await GETViaUpstream();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-volcano-status")).toBe("upstream-unavailable");
    const fc = (await resp.json()) as { features: unknown[] };
    expect(fc.features).toEqual([]);
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/volcanoes/route");
    expect(OPTIONS().headers.get("Access-Control-Allow-Origin")).not.toBeNull();
  });

  it("reports upstream-malformed when a feed answers 200 with a non-array body", async () => {
    // A 200 proxy page or error envelope is not a volcano list — the join must
    // bail to the silent-200 empty body rather than emit a broken FeatureCollection.
    upstream = (url) => {
      if (url.endsWith("getCapElevated")) return new Response(JSON.stringify({ error: "not a list" }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const resp = await GETViaUpstream();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-volcano-status")).toBe("upstream-malformed");
    const fc = (await resp.json()) as { features: unknown[] };
    expect(fc.features).toEqual([]);
  });

  it("reports upstream-unavailable when the feed connection itself fails", async () => {
    // A rejected fetch escapes the per-feed status checks and lands in the
    // handler's catch, which uses the same silent-200 empty body.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("dns resolution failed"));
    const { GET } = await import("@/app/api/volcanoes/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-volcano-status")).toBe("upstream-unavailable");
    const fc = (await resp.json()) as { features: unknown[] };
    expect(fc.features).toEqual([]);
  });
});
