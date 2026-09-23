import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mockRequest } from "./helpers";

const tokenBody = (accessToken: string, expiresIn: number): string =>
  JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" });

const jsonResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });

describe("OpenSky Flights API", () => {
  it("returns flight data with credit headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ states_count: 50, states: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Credits-Used")).toBeTruthy();
    expect(resp.headers.get("X-Authenticated")).toBe("false");
  });

  it("returns error when upstream fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.status).toBe(200);
  });
});

describe("OpenSky Token API", () => {
  let fetchMock: Mock;

  /** Replace global fetch for the duration of a single test. */
  const stubFetch = (impl: Mock): void => {
    fetchMock = impl;
    vi.stubGlobal("fetch", impl);
  };

  /** Credentials must be present for every path that reaches fetchToken(). */
  const stubCredentials = (): void => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "client-id");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "client-secret");
  };

  beforeEach(() => {
    // The token route keeps a module-level cache — re-import it fresh per test.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("returns an error payload (still HTTP 200) when credentials are not configured", async () => {
    const { GET } = await import("@/app/api/opensky/token/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("token");
    expect(data.authenticated).toBe(false);
  });

  it("treats blank credentials as unconfigured", async () => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "secret");
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);

    const { GET } = await import("@/app/api/opensky/token/route");
    const data = await (await GET()).json();
    expect(data.error).toContain("Failed to obtain OpenSky token");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/opensky/token/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns the error payload when the auth server responds non-2xx", async () => {
    stubCredentials();
    stubFetch(vi.fn(() => new Response("invalid_credentials", { status: 401 })));

    const { GET } = await import("@/app/api/opensky/token/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("Failed to obtain OpenSky token");
    expect(data.authenticated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the error payload when the token request rejects", async () => {
    stubCredentials();
    stubFetch(
      vi.fn(() => {
        throw new Error("network unreachable");
      }),
    );

    const { GET } = await import("@/app/api/opensky/token/route");
    const data = await (await GET()).json();
    expect(data.error).toContain("Failed to obtain OpenSky token");
  });

  it("requests a client-credentials token and returns it uncached", async () => {
    stubCredentials();
    stubFetch(vi.fn(() => jsonResponse(tokenBody("tok-fresh", 3600))));

    const { GET } = await import("@/app/api/opensky/token/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.cached).toBe(false);
    expect(data.token).toBe("tok-fresh");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe("grant_type=client_credentials");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Basic ${btoa("client-id:client-secret")}`,
    );
    // expires_at = now + (expires_in - 300) * 1000
    expect(data.expires_at).toBeLessThanOrEqual(Date.now() + 3300 * 1000);
    expect(data.expires_at).toBeGreaterThan(Date.now() + 3200 * 1000);
  });

  it("serves the second request from the in-memory token cache", async () => {
    stubCredentials();
    stubFetch(vi.fn(() => jsonResponse(tokenBody("tok-cached", 3600))));

    const { GET } = await import("@/app/api/opensky/token/route");
    const first = await GET();
    const firstData = await first.json();
    expect(firstData.cached).toBe(false);

    const second = await GET();
    const secondData = await second.json();
    expect(secondData.cached).toBe(true);
    expect(secondData.token).toBe("tok-cached");
    expect(secondData.expires_at).toBe(firstData.expires_at);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cached token enters the 5 minute refresh window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    vi.setSystemTime(start);
    stubCredentials();
    stubFetch(vi.fn(() => jsonResponse(tokenBody("tok-a", 3600))));

    const { GET } = await import("@/app/api/opensky/token/route");
    const first = await GET();
    expect((await first.json()).token).toBe("tok-a");

    // Cached lifetime is 3300s (3600 minus the 300s buffer); advance past it.
    vi.setSystemTime(start + 3301 * 1000);
    fetchMock.mockImplementation(() => jsonResponse(tokenBody("tok-b", 3600)));

    const second = await GET();
    const data = await second.json();
    expect(data.cached).toBe(false);
    expect(data.token).toBe("tok-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a token whose lifetime is shorter than the refresh buffer", async () => {
    stubCredentials();
    stubFetch(vi.fn(() => jsonResponse(tokenBody("tok-short", 200))));

    const { GET } = await import("@/app/api/opensky/token/route");
    expect((await (await GET()).json()).cached).toBe(false);
    expect((await (await GET()).json()).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("OpenSky Flights API auth, credits and failure paths", () => {
  const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

  const statesResponse = (): Response => new Response(JSON.stringify({ time: 1, states: [] }), { status: 200 });

  /** fetch's first argument is a union — normalise it to a URL string. */
  const toUrl = (input: RequestInfo | URL): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  /** Route on the URL so one mock can serve both the token and states calls. */
  const stubByRole = (tokenResponse: () => Response) =>
    vi.spyOn(globalThis, "fetch").mockImplementation((input): Promise<Response> =>
      Promise.resolve(toUrl(input) === TOKEN_URL ? tokenResponse() : statesResponse()),
    );

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects a partial bbox with 400", async () => {
    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights?lamin=91"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid bbox params");
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/opensky/flights/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 200 with the thrown message when the upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unreachable"));

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("network unreachable");
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("timed out");

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    const data = await resp.json();
    expect(data.error).toBe("Flight data fetch failed");
  });

  it("sends a fresh bearer token and reuses the cached one on the next request", async () => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "client-id");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "client-secret");
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response(tokenBody("tok-1", 3600), { status: 200 }));
    spy.mockResolvedValueOnce(statesResponse());
    spy.mockResolvedValueOnce(statesResponse());

    const { GET } = await import("@/app/api/opensky/flights/route");
    const first = await GET(mockRequest("/api/opensky/flights"));
    expect(first.headers.get("X-Authenticated")).toBe("true");
    const second = await GET(mockRequest("/api/opensky/flights"));
    expect(second.headers.get("X-Authenticated")).toBe("true");

    // One token request total — the second flight call went out with the same
    // bearer token and no trip to the auth server.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toBe(TOKEN_URL);
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(toUrl(spy.mock.calls[1][0])).toContain("opensky-network.org/api/states/all");
    const firstFlightHeaders = (spy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    const secondFlightHeaders = (spy.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(firstFlightHeaders["Authorization"]).toBe("Bearer tok-1");
    expect(secondFlightHeaders["Authorization"]).toBe("Bearer tok-1");
  });

  it("drops the cached token after an upstream 401", async () => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "client-id");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "client-secret");
    // Credentials are still configured and the previous test left a valid
    // cached token, so this request goes out authenticated.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toBe("OpenSky API returned 401");
    expect(data.authenticated).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to anonymous when the token endpoint responds non-2xx", async () => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "client-id");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "client-secret");
    const spy = stubByRole(() => new Response("invalid_credentials", { status: 401 }));

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.headers.get("X-Authenticated")).toBe("false");
    expect(spy.mock.calls[0][0]).toBe(TOKEN_URL);
    // The states request went out without credentials.
    const flightHeaders = (spy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(flightHeaders["Authorization"]).toBeUndefined();
  });

  it("falls back to anonymous when the token request throws", async () => {
    vi.stubEnv("OPENSKY_CLIENT_ID", "client-id");
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "client-secret");
    const spy = stubByRole(() => {
      throw new Error("auth server down");
    });

    const { GET } = await import("@/app/api/opensky/flights/route");
    const resp = await GET(mockRequest("/api/opensky/flights"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Authenticated")).toBe("false");
    expect(spy.mock.calls[0][0]).toBe(TOKEN_URL);
  });

  it("charges credits by bbox area tier", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(statesResponse()));

    const { GET } = await import("@/app/api/opensky/flights/route");
    // Global request costs the top tier (4) — used purely as the counter base.
    const global = await GET(mockRequest("/api/opensky/flights"));
    const before = Number(global.headers.get("X-Credits-Used"));

    // 2° x 2° = 4 deg² -> tier 1.
    const tiny = await GET(mockRequest("/api/opensky/flights?lamin=40&lamax=42&lomin=-74&lomax=-72"));
    expect(Number(tiny.headers.get("X-Credits-Used"))).toBe(before + 1);

    // 5° x 6° = 30 deg² -> tier 2.
    const mid = await GET(mockRequest("/api/opensky/flights?lamin=40&lamax=45&lomin=-74&lomax=-68"));
    expect(Number(mid.headers.get("X-Credits-Used"))).toBe(before + 3);

    // 10° x 30° = 300 deg² -> tier 3 (the top non-global tier).
    const large = await GET(mockRequest("/api/opensky/flights?lamin=0&lamax=10&lomin=0&lomax=30"));
    expect(Number(large.headers.get("X-Credits-Used"))).toBe(before + 6);
  });

  it("resets the credit counter at date rollover", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(statesResponse()));

    const { GET } = await import("@/app/api/opensky/flights/route");
    // Global (bbox-less) requests cost 4 credits each.
    const first = await GET(mockRequest("/api/opensky/flights"));
    const before = Number(first.headers.get("X-Credits-Used"));
    const second = await GET(mockRequest("/api/opensky/flights"));
    expect(Number(second.headers.get("X-Credits-Used"))).toBe(before + 4);

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const third = await GET(mockRequest("/api/opensky/flights"));
    expect(third.headers.get("X-Credits-Used")).toBe("4");
    expect(third.headers.get("X-Credits-Remaining")).toBe("3996");
  });

  it("returns 429 once the daily credit budget is exhausted and serves again next day", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(statesResponse()));

    const { GET } = await import("@/app/api/opensky/flights/route");
    // 4 credits per global request against a 4000/day budget — drive the
    // counter over the line rather than reaching into module state.
    let exhausted: { error?: string; credits_used?: number; budget?: number } | undefined;
    for (let i = 0; i < 1400 && !exhausted; i += 1) {
      const resp = await GET(mockRequest("/api/opensky/flights"));
      if (resp.status === 429) exhausted = await resp.json();
    }
    expect(exhausted).toBeDefined();
    expect(exhausted?.error).toBe("Daily credit budget exhausted");
    expect(exhausted?.budget).toBe(4000);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const nextDay = await GET(mockRequest("/api/opensky/flights"));
    expect(nextDay.status).toBe(200);
    expect(nextDay.headers.get("X-Credits-Used")).toBe("4");
  });
});
