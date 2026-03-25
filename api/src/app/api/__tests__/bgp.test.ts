import { describe, it, expect } from "vitest";

describe("BGP endpoint", () => {
  it("returns 400 when prefix is missing", async () => {
    const res = await fetch("http://localhost:9006/api/bgp");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("prefix");
  });

  it("returns BGP data for known prefix", async () => {
    const res = await fetch("http://localhost:9006/api/bgp?prefix=8.8.8.0/24");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.prefix).toBe("8.8.8.0/24");
    expect(data.data).toBeDefined();
  });

  it("includes CORS and cache headers", async () => {
    const res = await fetch("http://localhost:9006/api/bgp?prefix=8.8.8.0/24");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
