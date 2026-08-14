import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Military API", () => {
  it("returns aircraft data from ADSB Exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ac: [{ hex: "ABC123" }], total: 1 }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military?lat=30&lon=-90&dist=100"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.ac).toHaveLength(1);
  });

  it("clamps dist to max 1000", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ac: [] }), { status: 200 }));

    const { GET } = await import("@/app/api/military/route");
    await GET(mockRequest("/api/military?dist=5000"));

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/dist/1000");
  });

  it("handles 402/403 gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Payment Required", { status: 402 }));

    const { GET } = await import("@/app/api/military/route");
    const resp = await GET(mockRequest("/api/military"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("API key");
  });
});
