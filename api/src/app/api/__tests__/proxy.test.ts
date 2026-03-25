import { describe, it, expect } from "vitest";

describe("Proxy endpoint", () => {
  it("returns 403 for non-allowed domain", async () => {
    const res = await fetch("http://localhost:9006/api/proxy/https://evil.com/data");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("not allowed");
  });

  it("returns CORS headers on OPTIONS", async () => {
    const res = await fetch("http://localhost:9006/api/proxy/https://earthquake.usgs.gov/test", {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns error JSON on GET for blocked domain", async () => {
    const res = await fetch("http://localhost:9006/api/proxy/https://evil.com/data");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });
});
