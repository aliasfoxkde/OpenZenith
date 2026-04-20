import { describe, it, expect, vi } from "vitest";

describe("Sentinel-2 Tile API", () => {
  it("returns 200 when no STAC items (GIBS fallback)", async () => {
    // The sentinel2 route now falls back to GIBS MODIS when STAC returns no items
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/sentinel2/10/500/350"), {
      params: Promise.resolve({ z: "10", x: "500", y: "350" }),
    });
    expect(resp.status).toBe(200);
  });
});
