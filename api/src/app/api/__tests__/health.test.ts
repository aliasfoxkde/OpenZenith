import { describe, it, expect } from "vitest";

describe("Health endpoint", () => {
  it("returns 200 with expected shape", async () => {
    const res = await fetch("http://localhost:9006/api/health");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("healthy");
    expect(data.storage).toBeDefined();
    expect(data.storage.backend).toBeDefined();
    expect(data.coverage).toBeDefined();
    expect(data.coverage.latRange).toHaveLength(2);
    expect(data.coverage.lonRange).toHaveLength(2);
  });

  it("includes CORS headers", async () => {
    const res = await fetch("http://localhost:9006/api/health");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
