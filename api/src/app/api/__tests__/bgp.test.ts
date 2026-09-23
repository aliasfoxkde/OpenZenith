import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

const mockBgpResponse = { prefix: "8.8.8.0/24", as_path: ["15169"], origin: "igp" };

describe("BGP endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when prefix is missing", async () => {
    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("prefix");
  });

  it("returns BGP data for known prefix", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockBgpResponse), { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.prefix).toBe("8.8.8.0/24");
    expect(data.data).toBeDefined();
  });

  it("includes CORS and cache headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockBgpResponse), { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/bgp/route");
    // Sync handler today; Promise.resolve keeps this correct if it goes async.
    const resp = await Promise.resolve(OPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("reports the upstream status as a silent 200 when NLNOG fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("upstream exploded", { status: 503 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("NLNOG Looking Glass returned 503");
  });

  it("reports the thrown message as a silent 200 when the payload is not JSON", async () => {
    // A 200 with a non-JSON body makes resp.json() reject inside the try, so
    // the handler's catch runs without leaving the 15s abort timer pending.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not-json{{", { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  it("falls back to the default message for non-Error rejections", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("nope");

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Failed to query BGP data");
  });

  it("queries the NLNOG looking glass with the encoded prefix", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(mockBgpResponse), { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lg.ring.nlnog.net/api/prefix?q=8.8.8.0%2F24");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
