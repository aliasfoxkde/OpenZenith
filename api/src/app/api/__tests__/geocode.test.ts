import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

interface GeocodeResult {
  display_name: string;
  lat: number;
  lon: number;
}

interface GeocodeBody {
  ok?: boolean;
  requestId?: string;
  results: GeocodeResult[];
  count: number;
}

interface GeocodeErrorBody extends GeocodeBody {
  ok: false;
  error: { code: string; message: string; retryable?: boolean; retryAfter?: number };
}

const mockNominatimResponse = [
  {
    display_name: "London, England, United Kingdom",
    lat: "51.5074",
    lon: "-0.1278",
    type: "city",
    importance: 0.9,
    address: { city: "London", country: "United Kingdom" },
  },
];

describe("Geocode endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when query is missing", async () => {
    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.message).toContain("query");
  });

  it("serves a HIT from the edge cache without touching nominatim", async () => {
    const { edgeGetJson, edgePutJson } = await import("@/lib/storage/edge-cache");
    const cached = {
      results: [
        { display_name: "Paris, France", lat: 48.8566, lon: 2.3522, type: "city", importance: 0.9, address: {} },
      ],
      count: 1,
    };
    vi.mocked(edgeGetJson).mockResolvedValueOnce(cached);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=paris"));
    const data = await bodyAs<GeocodeBody>(resp);

    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(data.count).toBe(1);
    expect(data.results[0]!.display_name).toContain("Paris"); // bounds: count 1 asserted above
    expect(data.requestId).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(edgePutJson).not.toHaveBeenCalled();
  });

  it("stores successful lookups in the edge cache on MISS", async () => {
    const { edgePutJson } = await import("@/lib/storage/edge-cache");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNominatimResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=London&limit=5"));

    expect(resp.headers.get("X-Cache")).toBe("MISS");
    // TTL is short by design — nominatim etiquette.
    expect(edgePutJson).toHaveBeenCalledWith(expect.stringContaining("api/geocode"), expect.anything(), 300);
  });

  it("returns results for a valid query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNominatimResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=London&limit=3");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await bodyAs<GeocodeBody>(resp);
    expect(data.requestId).toBeDefined();
    expect(data.results).toHaveLength(1);
    expect(data.count).toBe(1);
    expect(data.results[0]!.display_name).toContain("London"); // bounds: length 1 asserted above
    expect(data.results[0]!.lat).toBe(51.5074);
    expect(data.results[0]!.lon).toBe(-0.1278);
  });

  it("returns empty results for no matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=xyznonexistent12345");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await bodyAs<GeocodeBody>(resp);
    expect(data.results).toHaveLength(0);
    expect(data.count).toBe(0);
    expect(data.requestId).toBeDefined();
  });

  it("returns 429 with a structured retryable error on an upstream rate limit", async () => {
    const headers = new Headers();
    headers.set("retry-after", "5");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("rate limited", { status: 429, headers }));

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=London"));
    expect(resp.status).toBe(429);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("GEOCODE_RATE_LIMITED");
    expect(data.error.retryable).toBe(true);
    expect(data.error.retryAfter).toBe(5);
    expect(resp.headers.get("retry-after")).toBe("5");
  });

  it("includes CORS headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockNominatimResponse), { status: 200 }),
    );

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=Paris");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 502 with a structured retryable error when Nominatim is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("upstream failed", { status: 503 }));

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=London"));
    expect(resp.status).toBe(502);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("GEOCODE_UPSTREAM");
    expect(data.error.retryable).toBe(true);
    expect(data.results).toEqual([]);
    expect(data.requestId).toBeDefined();
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/geocode/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("echoes the inbound x-request-id header as requestId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { GET } = await import("@/app/api/geocode/route");
    const req = mockRequest("/api/geocode?query=London");
    req.headers.set("x-request-id", "req-42");

    const data = await bodyAs<GeocodeBody>(await GET(req));
    expect(data.requestId).toBe("req-42");
  });

  it("treats a whitespace-only query as missing", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=%20%20%20"));
    expect(resp.status).toBe(400);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("INVALID_PARAM");
    expect(data.count).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects queries longer than 200 characters without calling upstream", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest(`/api/geocode?query=${"a".repeat(201)}`));
    expect(resp.status).toBe(400);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.error.code).toBe("INVALID_PARAM");
    expect(data.results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clamps limit into the 1-10 range and defaults to 5 when unparseable", async () => {
    // A fresh Response per call: a Response body is single-use, and a reused
    // one makes the route's body read throw into the 502 catch.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));

    const { GET } = await import("@/app/api/geocode/route");

    let call = 0;
    const limitOf = async (limitParam: string): Promise<string | null> => {
      const resp = await GET(mockRequest(`/api/geocode?query=London&${limitParam}`));
      expect(resp.status).toBe(200);
      const url = spy.mock.calls[call]![0] as string; // bounds: each limitOf call records one fetch
      call += 1;
      return new URL(url).searchParams.get("limit");
    };

    expect(await limitOf("limit=99")).toBe("10");
    expect(await limitOf("limit=2.9")).toBe("2");
    expect(await limitOf("limit=0")).toBe("1");
    expect(await limitOf("limit=-5")).toBe("1");
    expect(await limitOf("limit=abc")).toBe("5");
  });

  it("defaults the 429 retry hint to 5 seconds when upstream omits Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=London"));
    expect(resp.status).toBe(429);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.error.code).toBe("GEOCODE_RATE_LIMITED");
    expect(data.error.retryAfter).toBe(5);
    expect(resp.headers.get("retry-after")).toBe("5");
  });

  it("returns a retryable 502 when the upstream request rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("socket hang up"));

    const { GET } = await import("@/app/api/geocode/route");
    const resp = await GET(mockRequest("/api/geocode?query=London"));
    expect(resp.status).toBe(502);

    const data = await bodyAs<GeocodeErrorBody>(resp);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("GEOCODE_UNAVAILABLE");
    expect(data.error.message).toBe("Geocoding request failed");
    expect(data.error.retryable).toBe(true);
    expect(data.results).toEqual([]);
    expect(data.count).toBe(0);
  });
});
