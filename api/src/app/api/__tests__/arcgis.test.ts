import { describe, it, expect, vi } from "vitest";
import { mockRequest, bodyAs, stubFetchRecording } from "./helpers";

/** Bodies the ArcGIS proxy returns: either the upstream JSON or `{ error }`. */
interface ArcgisBody {
  currentVersion?: number;
  error?: string;
}

describe("ArcGIS Proxy API", () => {
  it("proxies to allowed ArcGIS host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ currentVersion: 10.81 }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.currentVersion).toBe(10.81);
  });

  it("rejects missing url parameter", async () => {
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis"));
    expect(resp.status).toBe(400);
  });

  it("blocks disallowed domains", async () => {
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://evil.com/data"));
    expect(resp.status).toBe(403);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toContain("not allowed");
  });

  it("rejects hosts that merely end with an allowlisted suffix", async () => {
    // evil-services9.arcgis.com endsWith services9.arcgis.com — the allowlist
    // must match exact hosts or dot-bounded subdomains only.
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://evil-services9.arcgis.com/ArcGIS/rest"));
    expect(resp.status).toBe(403);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toContain("not allowed");
  });

  it("still allows real subdomains of an allowlisted host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://tile.gis.fema.gov/services"));
    expect(resp.status).toBe(200);
  });

  it("keeps the upstream path and forces f=json", async () => {
    let captured = "";
    stubFetchRecording(
      (url) => {
        captured = url;
      },
      JSON.stringify({ services: [] }),
    );

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(
      mockRequest(
        "/api/arcgis?url=https%3A%2F%2Fservices9.arcgis.com%2FRHVPKKiFTONKtxq3%2FArcGIS%2Frest%2Fservices%3Ff%3Dpjson",
      ),
    );
    expect(resp.status).toBe(200);

    const forwarded = new URL(captured);
    expect(forwarded.hostname).toBe("services9.arcgis.com");
    expect(forwarded.pathname).toBe("/RHVPKKiFTONKtxq3/ArcGIS/rest/services");
    expect(forwarded.searchParams.get("f")).toBe("json");
  });

  it("sets cache and content-type headers on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services.arcgis.com/folder"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toBe("public, max-age=300");
    expect(resp.headers.get("content-type")).toBe("application/json");
  });

  it("returns 502 for an unparseable url", async () => {
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=not-a-url"));
    expect(resp.status).toBe(502);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toBe("Invalid URL");
  });

  it("returns 502 with the error message when the upstream request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("dns resolution failed"));

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(502);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toBe("dns resolution failed");
  });

  it("returns 502 with the generic message for non-Error rejections", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("not an error object");

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(502);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toBe("ArcGIS proxy error");
  });

  it("returns 502 when upstream replies with non-JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>maintenance</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(502);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(typeof data.error).toBe("string");
  });

  it("returns 502 when upstream responds non-OK with a parseable body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 499 } }), { status: 499 }),
    );

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(502);
    const data = await bodyAs<ArcgisBody>(resp);
    expect(data.error).toBe("ArcGIS service returned 499");
  });

  it("passes an abort signal that is not yet fired", async () => {
    let capturedInit: RequestInit | undefined;
    stubFetchRecording((_url, init) => {
      capturedInit = init;
    });

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(mockRequest("/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(200);

    const signal = capturedInit?.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/arcgis/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });
});
