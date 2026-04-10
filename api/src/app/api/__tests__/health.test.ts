import { describe, it, expect } from "vitest";

describe("Health endpoint", () => {
  it("returns 200 with expected shape", async () => {
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET();
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.status).toBe("healthy");
    expect(data.storage).toBeDefined();
    expect(data.storage.backend).toBeDefined();
    expect(data.coverage).toBeDefined();
    expect(data.coverage.latRange).toHaveLength(2);
    expect(data.coverage.lonRange).toHaveLength(2);
  });

  it("includes CORS headers", async () => {
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
