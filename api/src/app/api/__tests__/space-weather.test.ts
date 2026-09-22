import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/space-weather — NOAA SWPC Kp index and aurora proxy.
 *
 * Outbound SWPC traffic is stubbed at `fetch`; the suite covers the type
 * selector, each upstream failure mode, and the route's 200-with-error-payload
 * contract (no 5xx is ever emitted).
 */

const KP_URL = "https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json";
const AURORA_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

const KP_PAYLOAD = [{ kp_index: 3, estimated_kp: 3.33, kp: "3" }];
const AURORA_PAYLOAD = { coordinates: [[60, 0, 5]], Observation_Time: "2026-09-22T00:00:00Z" };

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function request(type?: string): NextRequest {
  const url = type ? `http://localhost/api/space-weather?type=${type}` : "http://localhost/api/space-weather";
  return new NextRequest(url);
}

function okResponse(): void {
  mockFetch.mockImplementation((url: string) => Promise.resolve(url === KP_URL ? jsonResponse(KP_PAYLOAD) : jsonResponse(AURORA_PAYLOAD)));
}

/**
 * Queue responses in call order. The route fetches each requested source
 * exactly once — for a combined request that is Kp then aurora in parallel.
 */
function queueResponses(...responses: Array<Response | Error>): void {
  const pending = [...responses];
  mockFetch.mockImplementation(() => {
    const next = pending.shift();
    if (!next) return Promise.reject(new Error("unexpected extra fetch"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  okResponse();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Space weather API (/api/space-weather)", () => {
  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/space-weather/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("combines Kp forecast and aurora when no type is given", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const resp = await GET(request());
    expect(resp.status).toBe(200);
    // Each source is fetched exactly once for a combined request
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([KP_URL, AURORA_URL]);

    const body = (await resp.json()) as { kp_forecast: unknown; aurora: { coordinates: number[][] } };
    expect(body.kp_forecast).toEqual(KP_PAYLOAD);
    expect(body.aurora.coordinates).toEqual([[60, 0, 5]]);
  });

  it("caps the combined response at the shorter of the two TTLs", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const resp = await GET(request("all"));
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("treats an unknown type as a combined request with a single fetch pair", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const resp = await GET(request("bogus"));
    expect(resp.status).toBe(200);
    // Unknown types skip the two sequential prefetches that `type=all` performs
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([KP_URL, AURORA_URL]);
    const body = (await resp.json()) as { kp_forecast: unknown; aurora: unknown };
    expect(body.kp_forecast).toEqual(KP_PAYLOAD);
    expect(body.aurora).toEqual(AURORA_PAYLOAD);
  });

  it("returns the raw Kp payload for type=kp", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const resp = await GET(request("kp"));
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(KP_URL);

    const body = (await resp.json()) as Array<{ kp_index: number }>;
    expect(body).toEqual(KP_PAYLOAD);
    expect(body[0].kp_index).toBe(3);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("returns the raw aurora payload for type=aurora", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const resp = await GET(request("aurora"));
    expect(resp.status).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(AURORA_URL);

    const body = (await resp.json()) as { coordinates: number[][] };
    expect(body.coordinates).toEqual([[60, 0, 5]]);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=600");
  });

  it("sends a browser-independent User-Agent and a timeout signal upstream", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    await GET(request("kp"));

    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string>; signal: AbortSignal };
    expect(init.headers["User-Agent"]).toBe("OpenZenith/1.0");
    expect(init.signal.aborted).toBe(false);
  });

  it("returns a 200 error payload when the Kp upstream fails for type=kp", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    mockFetch.mockResolvedValueOnce(new Response("upstream down", { status: 503 }));

    const resp = await GET(request("kp"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("SWPC Kp API returned 503");
  });

  it("returns a 200 error payload when the aurora upstream fails for type=aurora", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    mockFetch.mockResolvedValueOnce(new Response("upstream down", { status: 500 }));

    const resp = await GET(request("aurora"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("SWPC Aurora API returned 500");
  });

  it("reports when both upstreams fail for the combined request", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    const down = new Response("upstream down", { status: 503 });
    queueResponses(down, down);

    const resp = await GET(request());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Both SWPC APIs unavailable");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("degrades to an empty Kp list when only the Kp upstream fails", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    queueResponses(new Response("upstream down", { status: 503 }), jsonResponse(AURORA_PAYLOAD));

    const resp = await GET(request());
    const body = (await resp.json()) as { kp_forecast: unknown[]; aurora: { coordinates: number[][] } };
    expect(body.kp_forecast).toEqual([]);
    expect(body.aurora.coordinates).toEqual([[60, 0, 5]]);
  });

  it("degrades to empty aurora coordinates when only the aurora upstream fails", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    queueResponses(jsonResponse(KP_PAYLOAD), new Response("upstream down", { status: 500 }));

    const resp = await GET(request());
    const body = (await resp.json()) as { kp_forecast: Array<{ kp_index: number }>; aurora: { coordinates: unknown[] } };
    expect(body.kp_forecast).toEqual(KP_PAYLOAD);
    expect(body.aurora.coordinates).toEqual([]);
  });

  it("returns a 200 error payload when a fetch rejects", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    mockFetch.mockRejectedValue(new Error("network unreachable"));

    const resp = await GET(request());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("network unreachable");
  });

  it("uses the generic message for non-Error rejections", async () => {
    const { GET } = await import("@/app/api/space-weather/route");
    mockFetch.mockRejectedValue("boom");

    const resp = await GET(request());
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Space weather fetch failed");
  });
});
