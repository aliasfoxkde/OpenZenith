import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// Re-mock the cache module for this file only so the `CACHE_TTL.WARNINGS || 300`
// fallback branch is reachable.
vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn(async (url: string, ...args: unknown[]) =>
    fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object") as RequestInit[])),
  ),
  staleWhileRevalidate: vi.fn(),
  CACHE_TTL: { WARNINGS: 0 },
}));

// Mock env vars
const originalEnv = process.env;

function createMockRequest(url: string) {
  return { url } as unknown as import("next/server").NextRequest;
}

/**
 * Column layout — NASA FIRMS area CSV is a fixed 14-column grid:
 * lat(0) lon(1) brightness(2) scan(3) track(4) acq_date(5) acq_time(6)
 * satellite(7) instrument(8) confidence(9) version(10) bright_t31(11)
 * frp(12) daynight(13).
 */
const FIRMS_HEADER =
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight";

describe("Wildfires API", () => {
  it("returns empty features when no API key is configured", async () => {
    // Temporarily remove the key
    process.env = { ...originalEnv, FIRMS_MAP_KEY: "" };

    const { GET } = await import("@/app/api/wildfires/route");
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
    expect(data.error).toContain("not configured");

    process.env = originalEnv;
  });

  it("accepts custom bbox and days parameters", async () => {
    process.env = { ...originalEnv, FIRMS_MAP_KEY: "test-key" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(FIRMS_HEADER, { status: 200 }));

    const { GET } = await import("@/app/api/wildfires/route");
    const resp = await GET(createMockRequest("https://example.com/api/wildfires?days=3&bbox=-130,25,-60,50"));
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.days).toBe(3);
    expect(data.bbox).toBe("-130,25,-60,50");

    process.env = originalEnv;
  });
});

describe("Wildfires API — caching, CSV parsing and error paths", () => {
  let fetchMock: Mock;

  const stubFetch = (impl: Mock): void => {
    fetchMock = impl;
    vi.stubGlobal("fetch", impl);
  };

  const stubKey = (): void => {
    vi.stubEnv("FIRMS_MAP_KEY", "test-key");
  };

  const getRoute = async () => (await import("@/app/api/wildfires/route")).GET;
  const r2Json = async () => await import("@/lib/storage/r2-json-cache");

  beforeEach(() => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/wildfires/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("serves the R2 cached payload with X-Cache HIT and never calls FIRMS", async () => {
    const cached = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [10, 20] }, properties: { confidence: 90 } },
      ],
      count: 1,
    };
    const { r2GetJson } = await r2Json();
    (r2GetJson as Mock).mockResolvedValueOnce(cached);
    stubFetch(vi.fn());

    const GET = await getRoute();
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await resp.json()).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses FIRMS CSV rows into GeoJSON points and stores them in R2", async () => {
    stubKey();
    const csv = [
      FIRMS_HEADER,
      "37.5,-122.3,333.4,1.2,1.1,2026-09-21,1830,VIIRS_SNPP_NRT,viirs,85,1.0NRT,300.2,42.7,N",
      "38.1,-121.9,,1.0,1.0,2026-09-21,1831,VIIRS_SNPP_NRT,viirs,l,1.0NRT,299.9,,",
    ].join("\n");
    stubFetch(vi.fn(async () => new Response(csv, { status: 200 })));

    const GET = await getRoute();
    const resp = await GET(createMockRequest("https://example.com/api/wildfires?days=2"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");

    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.count).toBe(2);
    expect(data.days).toBe(2);
    expect(data.bbox).toBe("-180,-90,180,90");
    expect(data.satellite).toBe("VIIRS_SNPP_NRT");
    expect(data.apiKeyStatus).toBe("configured");
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [first, second] = data.features;
    expect(first.type).toBe("Feature");
    expect(first.geometry).toEqual({ type: "Point", coordinates: [-122.3, 37.5] });
    expect(first.properties).toEqual({ confidence: 85, brightness: 333.4, frp: 42.7, daynight: "N", satellite: "VIIRS_SNPP_NRT" });
    // Blank brightness falls back to 0, VIIRS "l" confidence stays qualitative, blank daynight defaults to D
    expect(second.properties.brightness).toBe(0);
    expect(second.properties.confidence).toBe("l");
    expect(second.properties.frp).toBe(0);
    expect(second.properties.daynight).toBe("D");

    const { r2PutJson } = await r2Json();
    expect(r2PutJson).toHaveBeenCalledTimes(1);
    const [key, payload, ttl] = (r2PutJson as Mock).mock.calls[0];
    expect(String(key)).toContain("wildfires");
    expect(payload.count).toBe(2);
    expect(ttl).toBe(3600);
  });

  it("reads frp and daynight from the real 14-column FIRMS layout", async () => {
    stubKey();
    // Regression: frp sits at index 12 and daynight at 13 — the route used to
    // read one column late, zeroing frp and defaulting daynight everywhere.
    const csv = [
      FIRMS_HEADER,
      "37.5,-122.3,333.4,1.2,1.1,2026-09-21,1830,VIIRS_SNPP_NRT,viirs,85,1.0NRT,300.2,42.7,N",
    ].join("\n");
    stubFetch(vi.fn(async () => new Response(csv, { status: 200 })));

    const GET = await getRoute();
    const data = await (await GET(createMockRequest("https://example.com/api/wildfires"))).json();
    const props = data.features[0].properties;
    expect(props.frp).toBe(42.7);
    expect(props.daynight).toBe("N");
  });

  it("skips rows with too few columns or non-numeric coordinates", async () => {
    stubKey();
    const csv = [
      FIRMS_HEADER,
      "1.0,2.0,300,1,1,2026-09-21,1830,SAT,inst,50,1.0,290,1,N",
      "1.0,2.0,300", // too few columns
      ",,300,1,1,2026-09-21,1830,SAT,inst,50,1.0,290,1,N", // NaN lat/lon
      "3.0,4.0,301,1,1,2026-09-21,1831,SAT,inst,60,1.0,291,1,D",
    ].join("\n");
    stubFetch(vi.fn(async () => new Response(csv, { status: 200 })));

    const GET = await getRoute();
    const data = await (await GET(createMockRequest("https://example.com/api/wildfires"))).json();
    expect(data.count).toBe(2);
    expect(data.features.map((f: { geometry: { coordinates: number[] } }) => f.geometry.coordinates)).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  it("caps the parsed feature list at 3000 rows", async () => {
    stubKey();
    const rows = [FIRMS_HEADER];
    for (let i = 0; i < 3010; i++) {
      rows.push(`${10 + i * 0.001},${20 + i * 0.001},300,1,1,2026-09-21,1830,SAT,inst,50,1.0,290,1,N`);
    }
    stubFetch(vi.fn(async () => new Response(rows.join("\n"), { status: 200 })));

    const GET = await getRoute();
    const data = await (await GET(createMockRequest("https://example.com/api/wildfires"))).json();
    expect(data.count).toBe(3000);
    expect(data.features).toHaveLength(3000);
  });

  it("returns a 200 error payload when FIRMS responds non-2xx", async () => {
    stubKey();
    const longBody = "rate limit exceeded — please retry later and reference the FIRMS usage policy page for details.";
    stubFetch(vi.fn(async () => new Response(longBody, { status: 429 })));

    const GET = await getRoute();
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    const data = await resp.json();
    expect(data.count).toBe(0);
    expect(data.features).toHaveLength(0);
    expect(data.error).toContain("FIRMS API returned 429");
    expect(data.error).toContain(longBody.slice(0, 100));
  });

  it("returns an empty feature collection for a header-only CSV", async () => {
    stubKey();
    stubFetch(vi.fn(async () => new Response(FIRMS_HEADER, { status: 200 })));

    const GET = await getRoute();
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const data = await resp.json();
    expect(data.count).toBe(0);
    expect(data.features).toHaveLength(0);
    expect(data.error).toBeUndefined();
  });

  it("clamps days to 1..7 in the upstream URL", async () => {
    stubKey();
    stubFetch(vi.fn(async () => new Response(FIRMS_HEADER, { status: 200 })));

    const GET = await getRoute();
    await GET(createMockRequest("https://example.com/api/wildfires?days=100"));
    await GET(createMockRequest("https://example.com/api/wildfires?days=abc"));
    await GET(createMockRequest("https://example.com/api/wildfires?days=0"));

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toContain("/csv/test-key/VIIRS_SNPP_NRT/-180,-90,180,90/7");
    expect(urls[1]).toContain("/csv/test-key/VIIRS_SNPP_NRT/-180,-90,180,90/1");
    expect(urls[2]).toContain("/csv/test-key/VIIRS_SNPP_NRT/-180,-90,180,90/1");
  });

  it("forwards a custom satellite to the FIRMS URL and the response payload", async () => {
    stubKey();
    stubFetch(vi.fn(async () => new Response(FIRMS_HEADER, { status: 200 })));

    const GET = await getRoute();
    const data = await (
      await GET(createMockRequest("https://example.com/api/wildfires?satellite=MODIS_NRT&bbox=-10,10,10,20"))
    ).json();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://firms.modaps.eosdis.nasa.gov/api/area/csv/test-key/MODIS_NRT/-10,10,10,20/1");
    expect(data.satellite).toBe("MODIS_NRT");
    expect(data.bbox).toBe("-10,10,10,20");
  });

  it("returns a 200 error payload when the cache layer throws", async () => {
    stubKey();
    stubFetch(vi.fn());
    const { r2GetJson } = await r2Json();
    (r2GetJson as Mock).mockRejectedValueOnce(new Error("R2 unavailable"));

    const GET = await getRoute();
    const resp = await GET(createMockRequest("https://example.com/api/wildfires"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("R2 unavailable");
    expect(data.count).toBe(0);
    expect(data.type).toBe("FeatureCollection");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    stubKey();
    stubFetch(vi.fn());
    const { r2GetJson } = await r2Json();
    (r2GetJson as Mock).mockRejectedValueOnce("boom");

    const GET = await getRoute();
    const data = await (await GET(createMockRequest("https://example.com/api/wildfires"))).json();
    expect(data.error).toBe("Failed to fetch FIRMS data");
  });
});
