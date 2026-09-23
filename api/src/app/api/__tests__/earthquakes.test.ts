import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mockRequest } from "./helpers";

describe("Earthquakes API", () => {
  it("returns GeoJSON from USGS", async () => {
    const mockGeoJSON = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-122, 37] }, properties: { mag: 3.5 } }],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockGeoJSON), { status: 200 }));

    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(mockRequest("/api/earthquakes"));
    const data = await resp.json();

    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(1);
  });

  it("rejects invalid period", async () => {
    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(mockRequest("/api/earthquakes?period=invalid_period"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid period");
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
  });
});

/**
 * Branch coverage: R2 cache hit/miss, TTL forwarding, upstream failure
 * shapes and the fire-and-forget R2 write contract. r2GetJson/r2PutJson are
 * the file-level mocks installed by test-setup.ts, so reset them after each
 * test — a queued `Once` reply from a failing test would otherwise leak into
 * the next one.
 */
describe("Earthquakes API — cache, error and validation branches", () => {
  const r2Json = async () => await import("@/lib/storage/r2-json-cache");

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { r2GetJson, r2PutJson } = await r2Json();
    (r2GetJson as Mock).mockReset().mockResolvedValue(null);
    (r2PutJson as Mock).mockReset().mockResolvedValue(undefined);
  });

  const getRoute = async () => (await import("@/app/api/earthquakes/route")).GET;

  /** Fetch stub typed with its (url, init) arguments so `mock.calls` stays
   * indexable — `vi.fn(() => ...)` alone collapses calls to a 0-tuple. */
  const usgsFetch = (): Mock<(url: string, init?: RequestInit) => Response> => vi.fn(() => new Response("{}", { status: 200 }));

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/earthquakes/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
  });

  it("defaults to all_day and forwards the period, UA header and abort signal upstream", async () => {
    const fetchMock: Mock<(url: string, init?: RequestInit) => Response> = vi.fn(
      () => new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    expect(new Headers(init?.headers).get("User-Agent")).toBe("OpenZenith/1.0");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts every period family and requests the matching USGS feed", async () => {
    const fetchMock = usgsFetch();
    vi.stubGlobal("fetch", fetchMock);

    const GET = await getRoute();
    const periods = [
      "all_hour",
      "all_week",
      "all_month",
      "significant_hour",
      "significant_day",
      "significant_year",
      "4.5_hour",
      "4.5_week",
      "2.5_month",
      "1.0_day",
    ];
    for (const period of periods) {
      const resp = await GET(mockRequest(`/api/earthquakes?period=${period}`));
      expect(resp.status).toBe(200);
      const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(url).toBe(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${period}.geojson`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(periods.length);
  });

  it("rejects an unknown period with 400 and the full valid list without contacting USGS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/earthquakes?period=all_year"));
    expect(resp.status).toBe(400);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const data = await resp.json();
    // 21 valid periods are enumerated back to the caller.
    expect(data.error).toMatch(/^Invalid period\. Valid: /);
    expect(data.error.split(",").map((p: string) => p.trim())).toHaveLength(21);
    expect(data.error).toContain("all_day");
    expect(data.error).toContain("1.0_month");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves an R2 cache hit without calling USGS", async () => {
    const cached = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [10, 20] }, properties: { mag: 4.2 } }],
    };
    const { r2GetJson } = await r2Json();
    (r2GetJson as Mock).mockResolvedValueOnce(cached);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/earthquakes?period=significant_week"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the upstream status as a 200 error payload on non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("unavailable", { status: 503 })));

    const resp = await (await getRoute())(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.json()).toEqual({ error: "USGS API returned 503" });
  });

  it("propagates the thrown message when the upstream request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("usgs unreachable"))));

    const resp = await (await getRoute())(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "usgs unreachable" });
  });

  it("falls back to a generic message when the cache layer throws a non-Error", async () => {
    const { r2GetJson } = await r2Json();
    (r2GetJson as Mock).mockRejectedValueOnce("boom");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "Earthquake data fetch failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps serving the fresh payload when the R2 write fails", async () => {
    const { r2PutJson } = await r2Json();
    (r2PutJson as Mock).mockRejectedValueOnce(new Error("r2 write failed"));
    const payload = { type: "FeatureCollection", features: [{ properties: { mag: 5.5 } }] };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resp = await (await getRoute())(mockRequest("/api/earthquakes"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(await resp.json()).toEqual(payload);

    // Fire-and-forget write: the rejection must be swallowed, not surfaced.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r2PutJson).toHaveBeenCalledTimes(1);
    const [key, stored, ttl] = (r2PutJson as Mock).mock.calls[0] as [string, unknown, number];
    expect(key).toContain("earthquakes");
    expect(stored).toEqual(payload);
    expect(ttl).toBe(60);
  });
});
