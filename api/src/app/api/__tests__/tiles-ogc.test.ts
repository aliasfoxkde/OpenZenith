import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Tiles OGC API", () => {
  it("returns tileset metadata for both advertised matrix sets", async () => {
    const { GET } = await import("@/app/api/tiles/route");
    const resp = await GET(mockRequest("/api/tiles"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.tileMatrixSetLinks).toBeTruthy();
    expect(data.links).toBeTruthy();
    // #122 advertises the conformant geographic set alongside Web Mercator
    const setIds = data.tileMatrixSetLinks.map((l: { tileMatrixSet: string }) => l.tileMatrixSet);
    expect(setIds).toEqual(["WebMercatorQuad", "WorldCRS84Quad"]);
    const crs84Hrefs = data.links.filter((l: { href: string }) => l.href.includes("WorldCRS84Quad"));
    expect(crs84Hrefs.length).toBeGreaterThanOrEqual(1);
  });

  it("reflects the request origin in its links", async () => {
    const { GET } = await import("@/app/api/tiles/route");
    const resp = await GET(mockRequest("/api/tiles?probe=1"));
    const data = await resp.json();
    const hrefs = data.links.map((link: { href: string }) => link.href);
    expect(hrefs).toContain("http://localhost:8788/api/openapi.json");
    expect(data.tileMatrixSetLinks[0].href).toBe("http://localhost:8788/api/tiles/WebMercatorQuad");
    expect(data.links.find((link: { rel: string }) => link.rel === "self").href).toBe(
      "http://localhost:8788/api/tiles",
    );
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/tiles/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
