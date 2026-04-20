import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("DEM Tile Metadata API", () => {
  it("returns TileJSON metadata", async () => {
    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.tilejson).toBe("3.0.0");
    expect(data.tiles).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(data.encoding).toBe("terrarium");
    expect(data.minzoom).toBe(0);
    expect(data.maxzoom).toBe(10);
  });

  it("returns healthy when HuggingFace is reachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe("ok");
    expect(data.backend).toBe("huggingface");
  });

  it("returns degraded when HuggingFace returns error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 503 }));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe("degraded");
  });
});
