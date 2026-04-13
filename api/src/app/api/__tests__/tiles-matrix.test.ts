import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Tile Matrix Set API", () => {
  it("returns WebMercatorQuad metadata", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad"), {
      params: Promise.resolve({ tileMatrixSetId: "WebMercatorQuad" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("WebMercatorQuad");
    expect(data.title).toBe("Google Web Mercator");
    expect(data.crs).toContain("3857");
    expect(data.tileMatrices).toHaveLength(15); // z0-z14
    expect(data.tileMatrices[0].id).toBe("0");
    expect(data.tileMatrices[14].id).toBe("14");
    expect(data.links).toBeTruthy();
  });

  it("returns WorldCRS84Quad metadata", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/WorldCRS84Quad"), {
      params: Promise.resolve({ tileMatrixSetId: "WorldCRS84Quad" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("WorldCRS84Quad");
    expect(data.title).toBe("WGS 84");
    expect(data.crs).toContain("4326");
    expect(data.tileMatrices).toHaveLength(15);
  });

  it("returns 400 for unknown tile matrix set", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/UnknownSet"), {
      params: Promise.resolve({ tileMatrixSetId: "UnknownSet" }),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.code).toBe("InvalidParameterValue");
  });
});
