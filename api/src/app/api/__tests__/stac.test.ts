import { describe, it, expect } from "vitest";
import { mockRequest, bodyAs } from "./helpers";

/**
 * STAC bodies these suites assert on. Only the touched fields are declared;
 * the route may return more.
 */
interface StacLink {
  rel: string;
  href?: string;
  type?: string;
  title?: string;
}

interface StacCatalogBody {
  type?: string;
  id?: string;
  links?: StacLink[];
}

interface StacCollectionSummaryBody {
  type?: string;
  id?: string;
  stac_version?: string;
}

interface StacCollectionBody {
  type?: string;
  id?: string;
  extent: { spatial: { bbox: number[][] } };
  links: StacLink[];
}

interface StacErrorBody {
  error: string;
}

describe("STAC API", () => {
  it("returns STAC catalog", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<StacCatalogBody>(resp);
    expect(data.type).toBe("Catalog");
    expect(data.id).toBe("openzenith");
  }, 30000);

  it("returns collections list", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections"));
    expect(resp.status).toBe(200);
    const data = await bodyAs<StacCollectionSummaryBody[]>(resp);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].type).toBe("Collection");
    expect(data[0].stac_version).toBeTruthy();
  }, 30000);

  it("serves the root catalog for a trailing-slash path", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/"));
    expect(resp.status).toBe(200);
    expect((await bodyAs<StacCatalogBody>(resp)).type).toBe("Catalog");
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
    const data = await bodyAs<StacCollectionBody>(resp);
    expect(data.type).toBe("Collection");
    expect(data.id).toBe("hillshade");
    expect(data.extent.spatial.bbox[0]).toEqual([-180, -85, 180, 85]);

    const rels = data.links.map((link) => link.rel);
    expect(rels).toEqual(["self", "parent", "root", "items", "tiles"]);
    const tiles = data.links.find((link) => link.rel === "tiles") as StacLink;
    expect(tiles.href).toBe("http://localhost:8788/api/tile/{z}/{x}/{y}");
    expect(tiles.type).toBe("application/vnd.mapbox-vector-tile");
  }, 30000);

  it("widens the bbox to the poles for the satellites collection", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/satellites"));
    expect(resp.status).toBe(200);
    expect((await bodyAs<StacCollectionBody>(resp)).extent.spatial.bbox[0]).toEqual([-180, -90, 180, 90]);
  }, 30000);

  it("advertises GeoJSON items instead of vector tiles for non-2D API layers", async () => {
    // flightArcs points at /api/flights but has no MapLibre 2D handler, so it
    // falls into the /api/ branch rather than the tiles branch.
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/flightArcs"));
    expect(resp.status).toBe(200);
    const links = (await bodyAs<StacCollectionBody>(resp)).links;
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
    const links = (await bodyAs<StacCollectionBody>(resp)).links;
    expect(links.map((link) => link.rel)).toEqual(["self", "parent", "root", "items"]);
  }, 30000);

  it("omits data access links for layers with no data source at all", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/blueMarble"));
    expect(resp.status).toBe(200);
    const links = (await bodyAs<StacCollectionBody>(resp)).links;
    expect(links.map((link) => link.rel)).toEqual(["self", "parent", "root", "items"]);
  }, 30000);

  it("returns 404 for an unknown collection id", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/collections/not-a-layer"));
    expect(resp.status).toBe(404);
    expect(await bodyAs<StacErrorBody>(resp)).toEqual({ error: "Collection not found" });
  }, 30000);

  it("returns 404 for an unrecognized catalog path", async () => {
    const { GET } = await import("@/app/api/stac/[...path]/route");
    const resp = await GET(mockRequest("/api/stac/bogus"));
    expect(resp.status).toBe(404);
    expect(await bodyAs<StacErrorBody>(resp)).toEqual({ error: "Not found" });
  }, 30000);
});
