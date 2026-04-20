import { describe, it, expect, vi } from "vitest";

/**
 * Tests for all GIBS tile routes using the shared createGIBSHandler.
 * Each route validates: successful proxy, zoom range enforcement, error handling.
 */

const GIBS_ROUTES = [
  { name: "Dynamic Surface Water", prefix: "dynamic-surface-water", minZoom: 0, maxZoom: 9 },
  { name: "Disturbance Alerts", prefix: "disturbance-alerts", minZoom: 0, maxZoom: 8 },
  { name: "SO₂ Volcanic", prefix: "so2-volcanic", minZoom: 0, maxZoom: 5 },
  { name: "NO₂ Pollution", prefix: "no2-pollution", minZoom: 0, maxZoom: 5 },
  { name: "Precipitation", prefix: "precipitation", minZoom: 0, maxZoom: 8 },
  { name: "Soil Moisture", prefix: "soil-moisture", minZoom: 0, maxZoom: 3 },
  { name: "NDVI Vegetation", prefix: "ndvi", minZoom: 0, maxZoom: 9 },
  { name: "Sea Surface Temp", prefix: "sst", minZoom: 0, maxZoom: 8 },
  { name: "Chlorophyll-a", prefix: "chlorophyll", minZoom: 0, maxZoom: 7 },
  { name: "Snow Cover", prefix: "snow-cover", minZoom: 0, maxZoom: 8 },
  { name: "Canopy Height", prefix: "canopy-height", minZoom: 0, maxZoom: 8 },
  { name: "Aboveground Biomass", prefix: "biomass", minZoom: 0, maxZoom: 8 },
  { name: "Sea Surface Salinity", prefix: "sea-salinity", minZoom: 0, maxZoom: 5 },
  { name: "Sea Surface Height", prefix: "sea-height", minZoom: 0, maxZoom: 6 },
];

for (const route of GIBS_ROUTES) {
  describe(`${route.name} Tile API`, () => {
    it("proxies GIBS WMS tiles", async () => {
      const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
      );

      const { GET } = await import(`@/app/api/${route.prefix}/[z]/[x]/[y]/route`);
      const midZoom = Math.floor((route.minZoom + route.maxZoom) / 2);
      const resp = await GET(new Request(`http://localhost/api/${route.prefix}/${midZoom}/1/1`), {
        params: Promise.resolve({ z: String(midZoom), x: "1", y: "1" }),
      });
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("image/png");
      expect(resp.headers.get("Cache-Control")).toContain("max-age");
    });

    it("returns 400 for zoom below minimum", async () => {
      const { GET } = await import(`@/app/api/${route.prefix}/[z]/[x]/[y]/route`);
      // For minZoom=0, test with -1; for minZoom>0, test with minZoom-1
      const testZoom = route.minZoom === 0 ? -1 : route.minZoom - 1;
      const resp = await GET(new Request(`http://localhost/api/${route.prefix}/${testZoom}/0/0`), {
        params: Promise.resolve({ z: String(testZoom), x: "0", y: "0" }),
      });
      expect(resp.status).toBe(400);
    });

    it("returns 400 for zoom above maximum", async () => {
      const { GET } = await import(`@/app/api/${route.prefix}/[z]/[x]/[y]/route`);
      const aboveMax = route.maxZoom + 1;
      const resp = await GET(new Request(`http://localhost/api/${route.prefix}/${aboveMax}/0/0`), {
        params: Promise.resolve({ z: String(aboveMax), x: "0", y: "0" }),
      });
      expect(resp.status).toBe(400);
    });

    it("returns 200 on upstream failure (never 5xx)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

      const { GET } = await import(`@/app/api/${route.prefix}/[z]/[x]/[y]/route`);
      const midZoom = Math.floor((route.minZoom + route.maxZoom) / 2);
      const resp = await GET(new Request(`http://localhost/api/${route.prefix}/${midZoom}/1/1`), {
        params: Promise.resolve({ z: String(midZoom), x: "1", y: "1" }),
      });
      expect(resp.status).toBe(200);
    });
  });
}
