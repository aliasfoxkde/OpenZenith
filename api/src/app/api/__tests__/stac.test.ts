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
  }, 30000);

  it("returns collections list", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].type).toBe("Collection");
    expect(data[0].stac_version).toBeTruthy();
  }, 30000);

  it("serves the root catalog for a trailing-slash path", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).type).toBe("Catalog");
  }, 30000);

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/stac/[...path]/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  }, 30000);

  it("returns a single collection by id with self/parent/root/items links", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/hillshade"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("Collection");
    expect(data.id).toBe("hillshade");
    expect(data.extent.spatial.bbox[0]).toEqual([-180, -85, 180, 85]);

    const rels = data.links.map((link: { rel: string }) => link.rel);
    expect(rels).toEqual(["self", "parent", "root", "items", "tiles"]);
    const tiles = data.links.find((link: { rel: string }) => link.rel === "tiles");
    expect(tiles.href).toBe("http://localhost:8788/api/tile/{z}/{x}/{y}");
    expect(tiles.type).toBe("application/vnd.mapbox-vector-tile");
  }, 30000);

  it("widens the bbox to the poles for the satellites collection", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/satellites"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).extent.spatial.bbox[0]).toEqual([-180, -90, 180, 90]);
  }, 30000);

  it("advertises GeoJSON items instead of vector tiles for non-2D API layers", async () => {
    // flightArcs points at /api/flights but has no MapLibre 2D handler, so it
    // falls into the /api/ branch rather than the tiles branch.
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/flightArcs"));
    expect(resp.status).toBe(200);
    const links = (await resp.json()).links as Array<{ rel: string; href: string; type: string; title?: string }>;
    const items = links.filter((link) => link.rel === "items");
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      rel: "items",
      href: "http://localhost:8788/api/flights",
      type: "application/geo+json",
      title: "GeoJSON features",
    });
    expect(links.some((link) => link.rel === "tiles")).toBe(false);
  }, 30000);

  it("omits data access links for layers with remote non-API sources", async () => {
    // orbitalTracks has an external source and no MapLibre 2D handler, so
    // neither the vector-tile nor the GeoJSON-items link applies.
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/orbitalTracks"));
    expect(resp.status).toBe(200);
    const links = (await resp.json()).links as Array<{ rel: string }>;
    expect(links.map((link) => link.rel)).toEqual(["self", "parent", "root", "items"]);
  }, 30000);

  it("omits data access links for layers with no data source at all", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/blueMarble"));
    expect(resp.status).toBe(200);
    const links = (await resp.json()).links as Array<{ rel: string }>;
    expect(links.map((link) => link.rel)).toEqual(["self", "parent", "root", "items"]);
  }, 30000);

  it("returns 404 for an unknown collection id", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/not-a-layer"));
    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: "Collection not found" });
  }, 30000);

  it("returns 404 for an unrecognized catalog path", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/bogus"));
    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: "Not found" });
  }, 30000);
});
