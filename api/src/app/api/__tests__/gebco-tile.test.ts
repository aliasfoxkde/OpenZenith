import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("GEBCO Tile API", () => {
  const route = () => import("@/app/api/gebco-tile/[name]/route");

  it("rejects invalid filename format", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/gebco-tile/test.tif"), { params: Promise.resolve({ name: "test.tif" }) });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toBe("Invalid tile name");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 200 with an edge-runtime explanation for a valid GEBCO filename", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/gebco-tile/gebco_2025_sub_ice_n90.0_s0.0_w-180.0_e-90.0.tif"), {
      params: Promise.resolve({ name: "gebco_2025_sub_ice_n90.0_s0.0_w-180.0_e-90.0.tif" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.error).toContain("GEBCO COG tiles require Node.js runtime");
    expect(data.error).toContain("/api/dem-tile/{z}/{x}/{y}");
  });

  it("rejects names that do not match the GEBCO 2025 sub-ice scheme", async () => {
    const { GET } = await route();
    for (const name of [
      "gebco_2024_sub_ice_n00.0.tif",
      "GEBCO_2025_sub_ice_n00.0_s00.0_w000.0_e000.0.tif",
      "gebco_2025_sub_ice_n00.0.tif.png",
      "../../etc/passwd",
      "gebco_2025_sub_ice_n00.0_s00.0_w000.0_e000.0",
      "",
    ]) {
      const resp = await GET(mockRequest(`/api/gebco-tile/${encodeURIComponent(name)}`), {
        params: Promise.resolve({ name }),
      });
      expect(resp.status, `expected 400 for ${JSON.stringify(name)}`).toBe(400);
    }
  });

  it("accepts the documented filename character set", async () => {
    const { GET } = await route();
    for (const name of [
      "gebco_2025_sub_ice_n00.0_s00.0_w000.0_e000.0.tif",
      "gebco_2025_sub_ice_n-00.5_s00.5.tif",
      "gebco_2025_sub_ice_N00_S00_W000_E000.TIF".toLowerCase(),
    ]) {
      const resp = await GET(mockRequest(`/api/gebco-tile/${encodeURIComponent(name)}`), {
        params: Promise.resolve({ name }),
      });
      expect(resp.status, `expected 200 for ${JSON.stringify(name)}`).toBe(200);
      expect(resp.headers.get("Cache-Control")).toBeNull();
    }
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await route();
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});
