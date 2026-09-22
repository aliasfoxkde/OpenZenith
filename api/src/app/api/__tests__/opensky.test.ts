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
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns the error payload when the auth server responds non-2xx", async () => {
    stubCredentials();
    stubFetch(vi.fn(async () => new Response("invalid_credentials", { status: 401 })));

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
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );

    const { GET } = await import("@/app/api/opensky/token/route");
    const data = await (await GET()).json();
    expect(data.error).toContain("Failed to obtain OpenSky token");
  });

  it("requests a client-credentials token and returns it uncached", async () => {
    stubCredentials();
    stubFetch(vi.fn(async () => jsonResponse(tokenBody("tok-fresh", 3600))));

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
    stubFetch(vi.fn(async () => jsonResponse(tokenBody("tok-cached", 3600))));

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
    stubFetch(vi.fn(async () => jsonResponse(tokenBody("tok-a", 3600))));

    const { GET } = await import("@/app/api/opensky/token/route");
    const first = await GET();
    expect((await first.json()).token).toBe("tok-a");

    // Cached lifetime is 3300s (3600 minus the 300s buffer); advance past it.
    vi.setSystemTime(start + 3301 * 1000);
    fetchMock.mockImplementation(async () => jsonResponse(tokenBody("tok-b", 3600)));

    const second = await GET();
    const data = await second.json();
    expect(data.cached).toBe(false);
    expect(data.token).toBe("tok-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a token whose lifetime is shorter than the refresh buffer", async () => {
    stubCredentials();
    stubFetch(vi.fn(async () => jsonResponse(tokenBody("tok-short", 200))));

    const { GET } = await import("@/app/api/opensky/token/route");
    expect((await (await GET()).json()).cached).toBe(false);
    expect((await (await GET()).json()).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
