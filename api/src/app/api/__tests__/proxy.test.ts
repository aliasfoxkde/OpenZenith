import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Proxy endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 403 for non-allowed domain", async () => {
    const { GET } = await import("@/app/api/proxy/[...path]/route");
    const req = new Request("http://localhost:8788/api/proxy/https://evil.com/data");
    const resp = await GET(req as any, { params: Promise.resolve({ path: ["https://evil.com/data"] }) });
    expect(resp.status).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain("not allowed");
  });

  it("returns CORS headers on OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/proxy/[...path]/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns error JSON on GET for blocked domain", async () => {
    const { GET } = await import("@/app/api/proxy/[...path]/route");
    const req = new Request("http://localhost:8788/api/proxy/https://evil.com/data");
    const resp = await GET(req as any, { params: Promise.resolve({ path: ["https://evil.com/data"] }) });
    expect(resp.status).toBe(403);
    const data = await resp.json();
    expect(data.error).toBeTruthy();
  });
});
