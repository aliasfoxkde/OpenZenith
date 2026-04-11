import { describe, it, expect } from "vitest";

describe("API Docs Markdown", () => {
  it("returns markdown documentation", async () => {
    const { GET } = await import("@/app/api/docs-md/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/markdown");
    const text = await resp.text();
    expect(text).toContain("OpenZenith API Documentation");
    expect(text).toContain("/api/query");
    expect(text).toContain("/api/elevation");
  });
});
