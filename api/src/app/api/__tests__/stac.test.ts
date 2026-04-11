import { describe, it, expect } from "vitest";

describe("STAC API", () => {
  it("returns STAC catalog", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(new Request("http://localhost/api/stac"), { params: Promise.resolve({ path: [] }) });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("Catalog");
    expect(data.id).toBe("openzenith");
  });

  it("returns collections list", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(new Request("http://localhost/api/stac/collections"), { params: Promise.resolve({ path: ["collections"] }) });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].type).toBe("Collection");
    expect(data[0].stac_version).toBeTruthy();
  });
});
