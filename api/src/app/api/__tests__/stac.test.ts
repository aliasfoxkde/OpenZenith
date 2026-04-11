import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("STAC API", () => {
  it("returns STAC catalog", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("Catalog");
    expect(data.id).toBe("openzenith");
  });

  it("returns collections list", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].type).toBe("Collection");
    expect(data[0].stac_version).toBeTruthy();
  });
});
