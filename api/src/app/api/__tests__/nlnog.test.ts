import { describe, it, expect } from "vitest";

describe("NLNOG endpoint", () => {
  it("returns nodes array with count", async () => {
    const res = await fetch("http://localhost:9006/api/nlnog");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(typeof data.count).toBe("number");
    expect(data.count).toBe(data.nodes.length);
    // NLNOG API may return 0 if rate limited or unavailable
    expect(data.count).toBeGreaterThanOrEqual(0);
  });

  it("nodes have required fields", async () => {
    const res = await fetch("http://localhost:9006/api/nlnog");
    const data = await res.json();

    if (data.nodes.length === 0) return;

    const node = data.nodes[0];
    expect(typeof node.id).toBe("number");
    expect(typeof node.hostname).toBe("string");
    expect(typeof node.lat).toBe("number");
    expect(typeof node.lon).toBe("number");
  });

  it("includes CORS and cache headers", async () => {
    const res = await fetch("http://localhost:9006/api/nlnog");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
