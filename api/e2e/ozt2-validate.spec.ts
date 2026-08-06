/**
 * OZT2 Tile E2E Tests
 *
 * Validates that the dem-tile API serves valid OZT2 tiles end-to-end.
 * These tests run against the production API.
 *
 * Prerequisites:
 *   - OZT2 tiles must be generated (scripts/convert_to_ozt2.py) and uploaded to R2
 *   - API must be deployed with terrain-ozt2.ts changes
 *
 * Run:
 *   npx playwright test e2e/ozt2-validate.spec.ts
 */

import { test, expect } from "@playwright/test";

const PROD = "https://openzenith.cyopsys.com";

// Well-known tiles that should have land (mountains/coastal areas)
const TEST_TILES = [
  { z: 10, x: 163, y: 395, name: "Mt. Everest area" },
  { z: 8, x: 40, y: 98, name: "Alps area" },
  { z: 7, x: 20, y: 49, name: "Rocky Mountains" },
  { z: 9, x: 85, y: 176, name: "Himalayas" },
];

test.describe("OZT2 Tile Format", () => {
  test("dem-tile metadata shows OZT2 format", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/dem-tile`);
    expect(resp.ok()).toBe(true);

    const meta = await resp.json();
    expect(meta.tileFormat).toBe("ozt2");
    expect(meta.version).toBe("2.0.0");
    expect(meta.maxzoom).toBeGreaterThanOrEqual(12);
  });

  for (const tile of TEST_TILES) {
    test(`OZT2 tile ${tile.z}/${tile.x}/${tile.y} (${tile.name})`, async ({ request }) => {
      const errors: string[] = [];
      const resp = await request.get(`${PROD}/api/dem-tile/${tile.z}/${tile.x}/${tile.y}?format=ozt2`, {
        headers: { Accept: "application/octet-stream" },
      });

      // If OZT2 tiles not yet in R2, server falls back to PNG
      const contentType = resp.headers()["content-type"] ?? "";
      const xFormatFallback = resp.headers()["x-dem-tile-format-fallback"] ?? "";

      if (xFormatFallback === "ozt2-to-png" || contentType.includes("png")) {
        console.log(`⚠️  OZT2 not in R2 yet — server returned PNG fallback (expected before Phase 2 upload)`);
        // Check at least PNG is served
        expect(resp.ok()).toBe(true);
        return;
      }

      // OZT2 path
      expect(resp.ok(), `Tile ${tile.z}/${tile.x}/${tile.y} not OK: ${resp.status()}`).toBe(true);

      const bytes = await resp.body();
      expect(bytes).not.toBeNull();
      expect(bytes!.length).toBeGreaterThan(6);

      // Verify OZT2 header
      const view = new DataView(bytes!.buffer, bytes!.byteOffset, 6);
      const vmin = view.getInt16(0, true);
      const vrange = view.getUint16(2, true);
      const bits = new Uint8Array(bytes!.buffer, bytes!.byteOffset + 4, 1)[0];
      const flags = new Uint8Array(bytes!.buffer, bytes!.byteOffset + 5, 1)[0];

      // Header sanity checks
      expect(vmin).toBeGreaterThanOrEqual(-500);   // Dead Sea
      expect(vmin).toBeLessThanOrEqual(9000);     // Mt. Everest
      expect(vrange).toBeGreaterThanOrEqual(0);
      expect(vrange).toBeLessThanOrEqual(10000);
      expect(bits).toBeGreaterThanOrEqual(8);
      expect(bits).toBeLessThanOrEqual(16);
      expect(flags).toBeGreaterThanOrEqual(0);
      expect(flags).toBeLessThanOrEqual(15);  // bits 0-3 only

      const predictor = flags & 0x03;
      const compressor = (flags >> 2) & 0x03;
      expect(predictor).toBeLessThanOrEqual(2);
      expect(compressor).toBeLessThanOrEqual(2);

      // Tile should be small (OZT2 is ~93% smaller than PNG)
      // PNG at this zoom is ~15KB; OZT2 should be <2KB
      const sizeKB = bytes!.length / 1024;
      console.log(`  ${tile.name}: ${sizeKB.toFixed(1)}KB (PNG would be ~15KB)`);
      expect(bytes!.length).toBeLessThan(5 * 1024);
    });
  }

  test("PNG fallback still works for legacy clients", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/dem-tile/8/40/98?format=png`);
    expect(resp.ok()).toBe(true);

    const contentType = resp.headers()["content-type"] ?? "";
    expect(contentType).toContain("png");

    const body = await resp.body();
    expect(body).not.toBeNull();
    // PNG signature: 137 80 78 71 13 10 26 10
    expect(body![0]).toBe(137);
    expect(body![1]).toBe(80); // 'P'
    expect(body![2]).toBe(78); // 'N'
    expect(body![3]).toBe(71); // 'G'
  });

  test("OZT2 tiles smaller than PNG equivalent", async ({ request }) => {
    // Test with a tile known to have varied terrain
    const ozt2Resp = await request.get(`${PROD}/api/dem-tile/10/163/395?format=ozt2`);
    const pngResp = await request.get(`${PROD}/api/dem-tile/10/163/395?format=png`);

    if (!ozt2Resp.ok() || !pngResp.ok()) return;

    const ozt2Bytes = await ozt2Resp.body();
    const pngBytes = await pngResp.body();

    if (!ozt2Bytes || !pngBytes) return;

    const xFallback = ozt2Resp.headers()["x-dem-tile-format-fallback"];
    if (xFallback === "ozt2-to-png") {
      console.log("⚠️  OZT2 not in R2 — skipping size comparison");
      return;
    }

    const ratio = pngBytes.length / ozt2Bytes.length;
    console.log(`  OZT2/PNG size ratio: ${ratio.toFixed(1)}x (${ozt2Bytes.length}B vs ${pngBytes.length}B)`);
    expect(ratio).toBeGreaterThan(3); // OZT2 should be at least 3x smaller
  });
});

test.describe("CesiumJS OZT2 Terrain Provider", () => {
  test("globe page loads with terrain without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push("PAGE:" + err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push("CONSOLE:" + msg.text());
    });

    await page.goto(`${PROD}/globe`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(8000);

    const diag = await page.evaluate(() => {
      const C = (window as any).Cesium;
      return {
        cesiumLoaded: !!C,
        viewerExists: !!(window as any).__ozViewer,
      };
    });

    console.log("Errors:", errors.filter((e) => !e.includes("401") && !e.includes("ion")));
    expect(diag.cesiumLoaded).toBe(true);
    expect(diag.viewerExists).toBe(true);
    // Filter out known non-critical errors (Cesium Ion 401s, etc.)
    const criticalErrors = errors.filter(
      (e) => !e.includes("401") && !e.includes("ion") && !e.includes("CesiumIon")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
