import { afterEach, describe, it, expect, vi } from "vitest";
import { GET, OPTIONS } from "@/app/api/sentinel2/[z]/[x]/[y]/route";
import { r2GetTile } from "@/lib/storage/r2-tile-cache";

/**
 * Covers /api/sentinel2/[z]/[x]/[y] — the Sentinel-2 tile proxy with the
 * Planetary Computer TiTiler pipeline and the NASA GIBS MODIS fallback.
 * All outbound fetches are mocked; the R2 tile cache is replaced by the
 * global test setup (always a miss).
 */

const PNG = new ArrayBuffer(8);

function stacResponse(href: string | null): Response {
  return new Response(
    JSON.stringify(
      href
        ? { features: [{ assets: { visual: { href } } }] }
        : { features: [] },
    ),
    { status: 200 },
  );
}

function pngResponse(ok: boolean): Response {
  return new Response(PNG, { status: ok ? 200 : 500 });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("Sentinel-2 tile API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles OPTIONS preflight", () => {
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
  });

  it("rejects non-numeric coordinates with 400", async () => {
    const resp = await GET(new Request("https://oz/api/sentinel2/a/b/c"), {
      params: Promise.resolve({ z: "a", x: "b", y: "c" }),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects tiles beyond the zoom range with 404", async () => {
    const resp = await GET(new Request("https://oz/api/sentinel2/3/9/0"), {
      params: Promise.resolve({ z: "3", x: "9", y: "0" }),
    });
    expect(resp.status).toBe(404);
  });

  it("serves a cached tile without contacting any upstream", async () => {
    vi.mocked(r2GetTile).mockResolvedValueOnce(PNG);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/394"), {
      params: Promise.resolve({ z: "10", x: "163", y: "394" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
  });

  it("falls back to GIBS when the STAC search itself throws", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) throw new Error("stac unreachable");
      if (url.includes("gibs.earthdata.nasa.gov")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/393"), {
      params: Promise.resolve({ z: "10", x: "163", y: "393" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS-GIBS");
  });

  it("falls back to GIBS when the STAC search returns a non-OK status", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) return new Response("rate limited", { status: 429 });
      if (url.includes("gibs.earthdata.nasa.gov")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/392"), {
      params: Promise.resolve({ z: "10", x: "163", y: "392" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS-GIBS");
  });

  it("falls back to GIBS when the STAC item has only TCI asset naming variants", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac"))
        return new Response(
          JSON.stringify({ features: [{ assets: { TCI: { href: "https://assets.example/tci.tif" } } }] }),
          { status: 200 },
        );
      if (url.includes("titiler.planetarycomputer")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/391"), {
      params: Promise.resolve({ z: "10", x: "163", y: "391" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("uses the global search bbox below zoom 6", async () => {
    // Cold module: earlier tests left the 1-hour asset-URL cache warm, which
    // would skip the STAC search entirely.
    vi.resetModules();
    const { GET: getFresh } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    let stacBody = "";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) {
        if (typeof init?.body === "string") stacBody = init.body;
        return stacResponse("https://assets.example/visual.tif");
      }
      if (url.includes("titiler.planetarycomputer")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await getFresh(new Request("https://oz/api/sentinel2/5/10/12"), {
      params: Promise.resolve({ z: "5", x: "10", y: "12" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    // z<6 swaps the tile bbox for a global search window.
    const stacSearch = JSON.parse(stacBody) as { bbox?: number[] };
    expect(stacSearch.bbox).toEqual([-180, -60, 180, 70]);
  });

  it("returns the unavailable notice when a STAC item carries no usable asset", async () => {
    vi.resetModules();
    const { GET: getFresh } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac"))
        return new Response(JSON.stringify({ features: [{ assets: {} }] }), { status: 200 });
      if (url.includes("gibs.earthdata.nasa.gov")) return pngResponse(false);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await getFresh(new Request("https://oz/api/sentinel2/10/163/390"), {
      params: Promise.resolve({ z: "10", x: "163", y: "390" }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain("temporarily unavailable");
  });

  it("serves TiTiler imagery when the STAC search and TiTiler both succeed", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) return stacResponse("https://assets.example/visual.tif");
      if (url.includes("titiler.planetarycomputer")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/395"), {
      params: Promise.resolve({ z: "10", x: "163", y: "395" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("falls back to GIBS when TiTiler fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) return stacResponse("https://assets.example/visual.tif");
      if (url.includes("titiler.planetarycomputer")) throw new Error("titiler down");
      if (url.includes("gibs.earthdata.nasa.gov")) return pngResponse(true);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/396"), {
      params: Promise.resolve({ z: "10", x: "163", y: "396" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS-GIBS");
  });

  it("returns a 200 notice when every upstream is unavailable", async () => {
    // The module-level asset URL from the first test is still within its
    // 1-hour TTL, so TiTiler is tried (and throws); GIBS also fails.
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("titiler.planetarycomputer")) throw new Error("titiler down");
      if (url.includes("gibs.earthdata.nasa.gov")) return pngResponse(false);
      if (url.includes("planetarycomputer.microsoft.com/api/stac")) return stacResponse(null);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await GET(new Request("https://oz/api/sentinel2/10/163/397"), {
      params: Promise.resolve({ z: "10", x: "163", y: "397" }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain("temporarily unavailable");
  });
});
