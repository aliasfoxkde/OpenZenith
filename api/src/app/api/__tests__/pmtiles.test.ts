import { describe, it, expect } from "vitest";

describe("PMTiles API (deprecated)", () => {
  it("returns 410 Gone", async () => {
    const { GET } = await import("@/app/api/pmtiles/[key]/route");
    const resp = await GET();
    expect(resp.status).toBe(410);
    const data = await resp.json();
    expect(data.error).toContain("deprecated");
    expect(data.alternatives).toBeTruthy();
    expect(data.alternatives.length).toBeGreaterThan(0);
  });

  it("lists alternative endpoints", async () => {
    const { GET } = await import("@/app/api/pmtiles/[key]/route");
    const data = await (await GET()).json();
    const urls = data.alternatives.map((a: { url: string }) => a.url);
    expect(urls).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(urls).toContain("/api/elevation?lat={lat}&lon={lon}");
  });
});
