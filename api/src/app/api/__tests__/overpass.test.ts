import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

/**
 * One-shot fetch stub that hands the recorded request to `onCaptured` and
 * answers with a JSON body.
 */
function stubFetchRecording(onCaptured: (url: string, init: RequestInit | undefined) => void, body = "{}") {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    onCaptured(url, init);
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

describe("Overpass API", () => {
  it("proxies query to Overpass API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 48.85, lon: 2.35 }] }), { status: 200 }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest(
      "/api/overpass",
      "POST",
      JSON.stringify({ query: "[out:json];node(48.85,2.35,48.86,2.36);out 1;" }),
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.elements).toHaveLength(1);
  });

  it("posts the query as an encoded form body with CORS and cache headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    stubFetchRecording(
      (url, init) => {
        capturedUrl = url;
        capturedInit = init;
      },
      JSON.stringify({ elements: [] }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const query = "[out:json];node(48.85,2.35,48.86,2.36);out 1;";
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query }));
    const resp = await POST(req);

    expect(capturedUrl).toBe("https://overpass-api.de/api/interpreter");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(`data=${encodeURIComponent(query)}`);
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");

    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toBe("public, max-age=60");
    expect(resp.headers.get("content-type")).toBe("application/json");
  });

  it("rejects missing query", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({}));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects a non-string query", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: 12345 }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toBe("Missing query string");
  });

  it("rejects query over 10000 chars", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "x".repeat(10001) }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("too long");
  });

  it("accepts a query at the 10000 char limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "x".repeat(10000) }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.elements).toEqual([]);
  });

  it("returns a silent 200 with the error message when the upstream request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("upstream reset"));

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "[out:json];" }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("upstream reset");
  });

  it("falls back to the generic message for non-Error rejections", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("not an error object");

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "[out:json];" }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.error).toBe("Overpass proxy error");
  });

  it("returns a silent 200 when the request body is not JSON", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", "{not json");
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(typeof data.error).toBe("string");
    expect(data.error).not.toBe("Missing query string");
  });

  it("returns a silent 200 when upstream replies with non-JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>too many requests</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "[out:json];" }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(typeof data.error).toBe("string");
  });

  it("passes an abort signal that is not yet fired", async () => {
    let capturedInit: RequestInit | undefined;
    stubFetchRecording(
      (_url, init) => {
        capturedInit = init;
      },
      JSON.stringify({ elements: [] }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "[out:json];" }));
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const signal = capturedInit?.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/overpass/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
