import { afterEach, describe, it, expect, vi } from "vitest";

describe("Sentinel-2 Tile API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to GIBS and serves a tile when no STAC items exist", async () => {
    // The sentinel2 route falls back to GIBS MODIS when STAC returns no items
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("planetarycomputer.microsoft.com/api/stac"))
        return Promise.resolve(new Response(JSON.stringify({ features: [] }), { status: 200 }));
      if (url.includes("gibs.earthdata.nasa.gov"))
        return Promise.resolve(
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          }),
        );
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/sentinel2/10/500/350"), {
      params: Promise.resolve({ z: "10", x: "500", y: "350" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
    expect(resp.headers.get("X-Cache")).toBe("MISS-GIBS");
  });

  it("returns 502 when neither STAC/TiTiler nor the GIBS fallback produce a tile", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("planetarycomputer.microsoft.com/api/stac"))
        return Promise.resolve(new Response(JSON.stringify({ features: [] }), { status: 200 }));
      if (url.includes("gibs.earthdata.nasa.gov")) return Promise.resolve(new Response("nope", { status: 500 }));
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sentinel2/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/sentinel2/10/500/351"), {
      params: Promise.resolve({ z: "10", x: "500", y: "351" }),
    });
    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "Imagery temporarily unavailable (both sources failed)" });
  });
});
