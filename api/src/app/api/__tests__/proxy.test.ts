import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockRequest } from "./helpers";

const route = () => import("@/app/api/proxy/[...path]/route");

/** UTF-8 bytes as a real ArrayBuffer (no casts). */
function bytes(text: string): ArrayBuffer {
  const out = new ArrayBuffer(text.length);
  new Uint8Array(out).set(new TextEncoder().encode(text));
  return out;
}

describe("Proxy endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 403 for non-allowed domain", async () => {
    const { GET } = await import("@/app/api/proxy/[...path]/route");
    const req = new Request("http://localhost:8788/api/proxy/https://evil.com/data");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await GET(req as any, { params: Promise.resolve({ path: ["https://evil.com/data"] }) });
    expect(resp.status).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain("not allowed");
  });

  it("returns CORS headers on OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/proxy/[...path]/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns error JSON on GET for blocked domain", async () => {
    const { GET } = await import("@/app/api/proxy/[...path]/route");
    const req = new Request("http://localhost:8788/api/proxy/https://evil.com/data");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await GET(req as any, { params: Promise.resolve({ path: ["https://evil.com/data"] }) });
    expect(resp.status).toBe(403);
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });
});

describe("Proxy endpoint — forwarding, cache TTL and error fallthrough", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("forwards path and query to an allowed host and passes through the response", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(
          new Response(bytes("usgs-payload"), { status: 200, headers: { "Content-Type": "application/json" } }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await route();
    const resp = await GET(
      mockRequest(
        "/api/proxy/https://earthquake.usgs.gov/fdsnws/event/1/query?starttime=2026-01-01&format=geojson",
      ),
      { params: Promise.resolve({ path: ["https://earthquake.usgs.gov/fdsnws/event/1/query"] }) },
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // earthquake.usgs.gov has a per-host TTL of 60s.
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    expect(await resp.arrayBuffer()).toEqual(bytes("usgs-payload"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchMock.mock.calls[0];
    const url = typeof rawUrl === "string" ? rawUrl : rawUrl instanceof URL ? rawUrl.href : rawUrl.url;
    expect(url).toBe("https://earthquake.usgs.gov/fdsnws/event/1/query?starttime=2026-01-01&format=geojson");
    expect(init).toBeDefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe("OpenZenith/1.0");
    expect(headers.get("Accept")).toBe("application/json,*/*");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the default 30s TTL and application/json for unannotated responses", async () => {
    // ArrayBuffer bodies carry no Content-Type, and unpkg.com has no per-host TTL.
    const fetchMock = vi.fn(() => Promise.resolve(new Response(bytes("{}"), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/proxy/https://unpkg.com/pkg/index.mjs"), {
      params: Promise.resolve({ path: ["https://unpkg.com/pkg/index.mjs"] }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    expect(await resp.text()).toBe("{}");
  });

  it("passes through a non-2xx upstream status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream exploded", { status: 500 }))),
    );

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/proxy/https://api.open-meteo.com/v1/forecast"), {
      params: Promise.resolve({ path: ["https://api.open-meteo.com/v1/forecast"] }),
    });

    expect(resp.status).toBe(500);
    expect(await resp.text()).toBe("upstream exploded");
  });

  it("answers 200 with the thrown error message when upstream fetch rejects", async () => {
    // Fake timers keep the route's 30s abort timer from holding the worker open.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("socket hang up"))));

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/proxy/https://api.open-meteo.com/v1/forecast"), {
      params: Promise.resolve({ path: ["https://api.open-meteo.com/v1/forecast"] }),
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "socket hang up" });
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // The abort timer must be cleared even on the rejection path — a leaked
    // timer holds the controller (and the isolate) alive for the full 30s.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers 200 with the generic message for non-Error rejections", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The route's catch treats any non-Error rejection reason as "Proxy error".
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("not-an-error")));

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/proxy/https://api.open-meteo.com/v1/forecast"), {
      params: Promise.resolve({ path: ["https://api.open-meteo.com/v1/forecast"] }),
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "Proxy error" });
  });

  it("answers 200 with the parse error when the joined path is not a URL", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/proxy/not-a-url"), {
      params: Promise.resolve({ path: ["not-a-url"] }),
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ error: "Invalid URL" });
  });
});
