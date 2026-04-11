import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("GEBCO Tile API", () => {
  it("rejects invalid filename format", async () => {
    const { GET } = await import("@/app/api/gebco-tile/[name]/route");
    const resp = await GET(mockRequest("/api/gebco-tile/test.tif"), { params: Promise.resolve({ name: "test.tif" }) });
    expect(resp.status).toBe(400);
  });

  it("returns 501 for valid GEBCO filename in edge runtime", async () => {
    const { GET } = await import("@/app/api/gebco-tile/[name]/route");
    const resp = await GET(mockRequest("/api/gebco-tile/gebco_2025_sub_ice_n90.0_s0.0_w-180.0_e-90.0.tif"), {
      params: Promise.resolve({ name: "gebco_2025_sub_ice_n90.0_s0.0_w-180.0_e-90.0.tif" }),
    });
    expect(resp.status).toBe(501);
  });
});
