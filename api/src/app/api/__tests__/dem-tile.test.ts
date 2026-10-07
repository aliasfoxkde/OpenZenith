import { describe, it, expect, vi } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

/** TileJSON metadata served by GET /api/dem-tile (no health probe). */
interface DemTileMetadataBody {
  tilejson: string;
  tiles: string[];
  encoding: string;
  minzoom: number;
  maxzoom: number;
}

/** Body served by GET /api/dem-tile?health=1. */
interface DemTileHealthBody {
  status: string;
  backend: string;
  message: string;
  http_status?: number;
}

describe("DEM Tile Metadata API", () => {
  it("returns TileJSON metadata", async () => {
    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<DemTileMetadataBody>(resp);
    expect(data.tilejson).toBe("3.0.0");
    expect(data.tiles).toContain("/api/dem-tile/{z}/{x}/{y}");
    expect(data.encoding).toBe("terrarium");
    expect(data.minzoom).toBe(0);
    expect(data.maxzoom).toBe(12);
  });

  it("returns healthy when HuggingFace is reachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<DemTileHealthBody>(resp);
    expect(data.status).toBe("ok");
    expect(data.backend).toBe("huggingface");
  });

  it("returns degraded when HuggingFace returns error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 503 }));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<DemTileHealthBody>(resp);
    expect(data.status).toBe("degraded");
  });

  it("skips the health probe unless health is exactly 1", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { GET } = await import("@/app/api/dem-tile/route");
    for (const query of ["", "?health=0", "?health=true", "?format=ozt2"]) {
      const resp = await GET(mockRequest(`/api/dem-tile${query}`));
      expect(resp.status).toBe(200);
      expect((await bodyAs<DemTileMetadataBody>(resp)).tilejson).toBe("3.0.0");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("treats every standard redirect status from HuggingFace as a healthy backend", async () => {
    // res.ok is false for a redirect, so the explicit status check is what
    // keeps an edge-redirected HEAD probe from being reported degraded. The
    // probe accepts the full redirect class — HF has moved /resolve/ targets
    // between permanent (301), temporary (302/307) and preserve-method (308)
    // redirects before.
    for (const redirectStatus of [301, 302, 303, 307, 308]) {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(null, { status: redirectStatus, headers: { Location: "https://cdn.example/N35W120.merged" } }),
        );

      const { GET } = await import("@/app/api/dem-tile/route");
      const resp = await GET(mockRequest("/api/dem-tile?health=1"));
      expect(resp.status).toBe(200);
      const data = await bodyAs<DemTileHealthBody>(resp);
      expect(data.status).toBe("ok");
      expect(data.http_status).toBe(redirectStatus);
      expect(resp.headers.get("Cache-Control")).toBe("no-cache");
      fetchSpy.mockRestore();
    }
  });

  it("reports degraded for a non-redirect 3xx status", async () => {
    // 304 Not Modified carries no Location and proves nothing about the
    // chunk endpoint, so it stays outside the healthy redirect class.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 304 }));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<DemTileHealthBody>(resp);
    expect(data.status).toBe("degraded");
    expect(data.message).toBe("HuggingFace returned status 304");
    fetchSpy.mockRestore();
  });

  it("reports 503 with the thrown message when the probe rejects", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("HuggingFace request aborted"));

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(503);
    const data = await bodyAs<DemTileHealthBody>(resp);
    expect(data.status).toBe("error");
    expect(data.backend).toBe("huggingface");
    expect(data.message).toBe("HuggingFace request aborted");
    fetchSpy.mockRestore();
  });

  it("reports 503 with a generic message when the probe rejects with a non-Error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("network unreachable");

    const { GET } = await import("@/app/api/dem-tile/route");
    const resp = await GET(mockRequest("/api/dem-tile?health=1"));
    expect(resp.status).toBe(503);
    const data = await bodyAs<DemTileHealthBody>(resp);
    expect(data.status).toBe("error");
    expect(data.message).toBe("Health check failed");
    fetchSpy.mockRestore();
  });
});
