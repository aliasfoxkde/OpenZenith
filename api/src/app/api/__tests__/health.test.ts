import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Health endpoint", () => {
  it("returns 200 with expected shape and requestId", async () => {
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET(mockRequest("/api/health"));
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.requestId).toBeDefined();
    expect(data.status).toBe("healthy");
    expect(data.storage).toBeDefined();
    expect(data.storage.backend).toBeDefined();
    expect(data.coverage).toBeDefined();
    expect(data.coverage.latRange).toHaveLength(2);
    expect(data.coverage.lonRange).toHaveLength(2);
  });

  it("includes CORS headers", async () => {
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET(mockRequest("/api/health"));
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
