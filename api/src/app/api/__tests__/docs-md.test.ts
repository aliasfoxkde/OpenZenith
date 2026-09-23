import { describe, it, expect } from "vitest";

describe("API Docs Markdown", () => {
  it("returns markdown documentation", async () => {
    const { GET } = await import("@/app/api/docs-md/route");
    const resp = GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/markdown");
    const text = await resp.text();
    expect(text).toContain("OpenZenith API Documentation");
    expect(text).toContain("/api/query");
    expect(text).toContain("/api/elevation");
  });

  it("sends short-lived public cache headers", async () => {
    const { GET } = await import("@/app/api/docs-md/route");
    const resp = GET();
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/docs-md/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(resp.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("documents the tile and health endpoints", async () => {
    const { GET } = await import("@/app/api/docs-md/route");
    const text = await GET().text();
    expect(text).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(text).toContain("/api/gebco-tile/{name}");
    expect(text).toContain("GET /api/query");
    expect(text).toContain("Rate Limits");
  });
});
