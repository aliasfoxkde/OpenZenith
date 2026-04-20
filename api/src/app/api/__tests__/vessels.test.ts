import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Vessels API", () => {
  it("returns 200 when AISSTREAM_KEY not set", async () => {
    const { GET } = await import("@/app/api/vessels/route");
    const resp = await GET(mockRequest("/api/vessels"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("not configured");
    expect(data.wsUrl).toBeNull();
  });
});
