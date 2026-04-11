import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Overpass API", () => {
  it("proxies query to Overpass API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 48.85, lon: 2.35 }] }), { status: 200 }),
    );

    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest(
      "/api/overpass",
      "POST",
      JSON.stringify({ query: "[out:json];node(48.85,2.35,48.86,2.36);out 1;" }),
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.elements).toHaveLength(1);
  });

  it("rejects missing query", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({}));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects query over 10000 chars", async () => {
    const { POST } = await import("@/app/api/overpass/route");
    const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "x".repeat(10001) }));
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("too long");
  });
});
