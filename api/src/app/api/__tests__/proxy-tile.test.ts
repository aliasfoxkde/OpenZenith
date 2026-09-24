import { describe, it, expect, vi, afterEach } from "vitest";
import { mockRequest } from "./helpers";

describe("Proxy Tile API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers CORS preflight requests", async () => {
    const { OPTIONS } = await import("@/app/api/proxy/tile/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });

  it("proxies tile from allowed host", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } })),
    );

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
  });

  it("defaults missing upstream Content-Type and Cache-Control headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 })), // no headers
    );

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=1&x=0&y=1"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("substitutes {z}/{x}/{y} templates, including TMS reversed y and percent-encoded forms", async () => {
    const fetchMock = vi.fn(() => new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/proxy/tile/route");
    await GET(
      mockRequest(
        "/api/proxy/tile?url=https%3A%2F%2Fexample.com%2F%7Bz%7D%2F%7Bx%7D%2F%7By%7D.png&z=3&x=2&y=1&reverse_y=true",
      ),
    );

    // reverse_y: actualY = 2^3 - 1 - 1 = 6, substituted into the %7By%7D form
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/3/2/6.png", expect.any(Object));
  });

  it.each([
    ["url", "&z=1&x=0&y=0"],
    ["z", "?url=https://example.com/{z}/{x}/{y}.png&x=0&y=0"],
    ["x", "?url=https://example.com/{z}/{x}/{y}.png&z=1&y=0"],
    ["y", "?url=https://example.com/{z}/{x}/{y}.png&z=1&x=0"],
  ])("rejects requests missing the %s parameter", async (_name, query) => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest(`/api/proxy/tile${query}`));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "Missing required parameters: url, z, x, y" });
  });

  it.each([
    "&z=abc&x=2&y=3",
    "&z=1&x=abc&y=3",
    "&z=1&x=2&y=abc",
  ])("rejects non-numeric tile coordinates (%s)", async (coords) => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest(`/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png${coords}`));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "z, x, y must be integers" });
  });

  it("rejects templates that do not yield a parseable URL", async () => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=example.com/{z}/{x}/{y}.png&z=1&x=0&y=0"));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "Invalid tile URL after template substitution" });
  });

  it("rejects non-HTTP URL schemes", async () => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=file://example.com/{z}/{x}/{y}.png&z=1&x=0&y=0"));
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "Only HTTP/HTTPS URLs allowed" });
  });

  it("returns transparent PNG on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("not found", { status: 404 })));

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
  });

  it("propagates other upstream error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("boom", { status: 503 })));

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(503);
    expect(await resp.json()).toEqual({ error: "Tile server error: 503" });
  });

  it("maps upstream fetch failures to a 502", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "Failed to fetch tile" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("blocks disallowed host (SSRF protection)", async () => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(
      mockRequest("/api/proxy/tile?url=https://internal-server.local/{z}/{x}/{y}.png&z=0&x=0&y=0"),
    );
    expect(resp.status).toBe(403);
  });
});
