import { describe, it, expect, vi } from "vitest";

describe("ArcGIS Proxy API", () => {
  it("proxies to allowed ArcGIS host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ currentVersion: 10.81 }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(new Request("http://localhost/api/arcgis?url=https://services9.arcgis.com/test"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.currentVersion).toBe(10.81);
  });

  it("rejects missing url parameter", async () => {
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(new Request("http://localhost/api/arcgis"));
    expect(resp.status).toBe(400);
  });

  it("blocks disallowed domains", async () => {
    const { GET } = await import("@/app/api/arcgis/route");
    const resp = await GET(new Request("http://localhost/api/arcgis?url=https://evil.com/data"));
    expect(resp.status).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain("not allowed");
  });
});
