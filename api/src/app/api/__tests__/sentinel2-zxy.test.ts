import { afterEach, describe, it, expect, vi } from "vitest";
import { GET, OPTIONS } from "@/app/api/sentinel2/[z]/[x]/[y]/route";

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
