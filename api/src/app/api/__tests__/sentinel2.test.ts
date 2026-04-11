import { describe, it, expect, vi } from "vitest";

describe("Sentinel-2 Tile API", () => {
  it("returns 404 when no imagery available", async () => {
    // The sentinel2 route does a two-step fetch: STAC search then TiTiler
    // If STAC returns no items, it should return 404
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );

    const { GET } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/sentinel2/10/500/350"), { params: Promise.resolve({ z: "10", x: "500", y: "350" }) });
    expect(resp.status).toBe(404);
  });
});
