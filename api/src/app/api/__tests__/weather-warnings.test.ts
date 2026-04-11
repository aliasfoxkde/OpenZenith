import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Weather Warnings API", () => {
  it("returns alerts from NOAA", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [{ properties: { event: "Tornado Warning" } }] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/weather/warnings/route");
    const resp = await GET(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.features).toHaveLength(1);
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/weather/warnings/route");
    const resp = await GET(mockRequest("/api/weather/warnings"));
    expect(resp.status).toBe(500);
  });
});
