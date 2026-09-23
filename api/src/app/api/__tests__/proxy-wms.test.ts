import { describe, it, expect, vi, afterEach } from "vitest";
import { mockRequest } from "./helpers";

/** Resolve a request URL the way `fetch` receives it (string, URL or Request). */
function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/**
 * One-shot fetch stub for the file's `stubGlobal` idiom: records the proxy
 * target URL the route built and always answers with `response`.
 */
function stubFetchRecording(response: Response, onCaptured: (url: string) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      onCaptured(requestUrl(input));
      return Promise.resolve(response);
    }),
  );
}

describe("Proxy WMS API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies WMS GetMap request from allowed host", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }))),
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=test&BBOX=-180,-90,180,90"));
    expect(resp.status).toBe(200);
  });

  it("returns error when url is missing", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms"));
    expect(resp.status).toBe(400);
  });

  it("blocks disallowed host (SSRF protection)", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest("/api/proxy/wms?url=https://internal-server.local/wms&layers=test&BBOX=-180,-90,180,90"),
    );
    expect(resp.status).toBe(403);
  });

  it("returns 400 for an unparseable url", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=not-a-url&layers=test"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBe("Invalid URL");
  });

  it("rejects non-http(s) schemes", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=ftp://example.com/wms&layers=test"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBe("Only HTTP/HTTPS URLs allowed");
  });

  it("requires a layers parameter", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&BBOX=-180,-90,180,90"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBe("Missing 'layers' parameter");
  });

  it("requires a bbox parameter", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=demo"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBe("Missing 'bbox' parameter");
  });

  it("applies WMS defaults and drops unknown params", async () => {
    let captured = "";
    stubFetchRecording(
      new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "image/png" } }),
      (url) => {
        captured = url;
      },
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=demo&bbox=-10,-10,10,10&secret=nope"),
    );
    expect(resp.status).toBe(200);

    const forwarded = new URL(captured);
    expect(forwarded.searchParams.get("SERVICE")).toBe("WMS");
    expect(forwarded.searchParams.get("VERSION")).toBe("1.3.0");
    expect(forwarded.searchParams.get("REQUEST")).toBe("GetMap");
    expect(forwarded.searchParams.get("LAYERS")).toBe("demo");
    expect(forwarded.searchParams.get("BBOX")).toBe("-10,-10,10,10");
    expect(forwarded.searchParams.get("WIDTH")).toBe("256");
    expect(forwarded.searchParams.get("HEIGHT")).toBe("256");
    expect(forwarded.searchParams.get("FORMAT")).toBe("image/png");
    expect(forwarded.searchParams.get("TRANSPARENT")).toBe("TRUE");
    expect(forwarded.searchParams.get("secret")).toBeNull();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(resp.headers.get("content-type")).toBe("image/png");
  });

  it("passes through caller-supplied width, height, format and version", async () => {
    let captured = "";
    stubFetchRecording(
      new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      (url) => {
        captured = url;
      },
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest(
        "/api/proxy/wms?url=https://example.com/wms&layers=demo&bbox=-10,-10,10,10&width=512&height=384&format=image/jpeg&version=1.1.1&cql_filter=type%3Droad",
      ),
    );
    expect(resp.status).toBe(200);

    const forwarded = new URL(captured);
    expect(forwarded.searchParams.get("VERSION")).toBe("1.1.1");
    expect(forwarded.searchParams.get("WIDTH")).toBe("512");
    expect(forwarded.searchParams.get("HEIGHT")).toBe("384");
    expect(forwarded.searchParams.get("FORMAT")).toBe("image/jpeg");
    expect(forwarded.searchParams.get("CQL_FILTER")).toBe("type=road");
    expect(resp.headers.get("content-type")).toBe("image/jpeg");
  });

  it("joins with & when the upstream url already carries a query string", async () => {
    let captured = "";
    stubFetchRecording(new Response(new Uint8Array([1]), { status: 200 }), (url) => {
      captured = url;
    });

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest("/api/proxy/wms?url=https%3A%2F%2Fexample.com%2Fwms%3Fservice%3DWMS&layers=demo&bbox=-10,-10,10,10"),
    );
    expect(resp.status).toBe(200);
    expect(captured.startsWith("https://example.com/wms?service=WMS&")).toBe(true);
    expect(new URL(captured).searchParams.get("LAYERS")).toBe("demo");
  });

  it("strips a URL fragment so appended WMS params stay reachable", async () => {
    // Without this, "?A=B" appended after "#map" lands inside the fragment
    // and the WMS server sees a request with no SERVICE/LAYERS/BBOX at all.
    let captured = "";
    stubFetchRecording(new Response(new Uint8Array([1]), { status: 200 }), (url) => {
      captured = url;
    });

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest("/api/proxy/wms?url=https%3A%2F%2Fexample.com%2Fwms%23map&layers=demo&bbox=-10,-10,10,10"),
    );
    expect(resp.status).toBe(200);
    expect(captured).not.toContain("#");
    expect(new URL(captured).searchParams.get("LAYERS")).toBe("demo");
  });

  it("propagates the upstream status on a WMS error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("tile unavailable", { status: 500 }))),
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=demo&bbox=-10,-10,10,10"));
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.error).toBe("WMS error: 500");
  });

  it("falls back to image/png when upstream omits Content-Type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))),
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=demo&bbox=-10,-10,10,10"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("image/png");
  });

  it("returns 502 when the upstream fetch rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("connect ECONNREFUSED"))),
    );

    try {
      const { GET } = await import("@/app/api/proxy/wms/route");
      const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=demo&bbox=-10,-10,10,10"));
      expect(resp.status).toBe(502);
      const data = await resp.json();
      expect(data.error).toBe("Failed to fetch from WMS server");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/proxy/wms/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
