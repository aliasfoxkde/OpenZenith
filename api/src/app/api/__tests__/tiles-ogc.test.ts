import { describe, it, expect } from "vitest";

describe("Tiles OGC API", () => {
  it("returns tileset metadata", async () => {
    const { GET } = await import("@/app/api/tiles/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.tileMatrixSetLinks).toBeTruthy();
    expect(data.links).toBeTruthy();
  });
});
