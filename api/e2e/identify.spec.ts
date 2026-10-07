import { test, expect } from "@playwright/test";

/**
 * Map identify — clicking a rendered data-layer feature opens the identify
 * popup for that feature instead of dropping the elevation pin.
 *
 * The identify feature is exercised against a stubbed USGS feed so the suite
 * does not depend on the live upstream: the earthquakes layer fetches
 * earthquake.usgs.gov directly from the browser (src/app/map/lib/layers/
 * earthquakes.ts), not through the app's /api/earthquakes route, so that is
 * the request intercepted here. The fixture places one quake at the map's
 * default center (DEFAULT_STATE.center = [0, 0] in src/app/map/lib/
 * view-state.ts) so the click can target a known lngLat: MapLibre projects
 * the view center to the middle of its canvas, whatever the viewport size.
 *
 * Per-test timeouts are well above the 30s default on purpose: the page
 * mounts a WebGL map and streams feature data, and cold targets legitimately
 * take longer than a static page before interactions become actionable.
 * Conventions follow functional.spec.ts.
 */

/** The map pages' WebGL canvas — the click surface for queries. */
const MAP_CANVAS = ".maplibregl-canvas";

/** Fixture quake: sits exactly on the default view center, big enough to click. */
const FIXTURE_QUAKE = {
  mag: 6.3,
  place: "18 km SW of Fixture Bay",
  lngLat: [0, 0] as [number, number],
};

/** USGS summary-feed shape for the single fixture feature. */
function fixtureFeed(): object {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "e2e-fixture-quake",
        properties: {
          mag: FIXTURE_QUAKE.mag,
          place: FIXTURE_QUAKE.place,
          time: Date.now(),
          updated: Date.now(),
          tsunami: 0,
          sig: 615,
          magType: "mww",
          type: "earthquake",
          status: "reviewed",
        },
        geometry: { type: "Point", coordinates: [FIXTURE_QUAKE.lngLat[0], FIXTURE_QUAKE.lngLat[1], 10] },
      },
    ],
  };
}

test.describe("Map identify", () => {
  test("clicking a data-layer feature opens the identify popup", async ({ page }) => {
    test.setTimeout(90_000);

    // The layer's feed request, plus the elevation endpoint the pin path
    // uses, so a mis-aimed click cannot reach the live services.
    await page.route("**/earthquake.usgs.gov/earthquakes/feed/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtureFeed()),
      }),
    );
    await page.route("**/api/elevation*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ elevation: 1234.5, surface_type: "land", ok: true }),
      }),
    );

    await page.goto("/map");
    await page.waitForSelector(MAP_CANVAS, { timeout: 60_000 });

    // The layer panel starts closed and the earthquakes toggle sits inside
    // its collapsed Hazards accordion. Click the toggle's label rather than
    // the checkbox itself: the native input is clip-hidden behind the styled
    // indicator, so the label is the reliably-hittable surface for it.
    await page.getByRole("button", { name: "Toggle layer panel" }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: /Hazards & Disasters/ }).click({ timeout: 30_000 });
    const quakesToggle = page.locator("label", {
      has: page.getByRole("checkbox", { name: "Earthquakes layer" }),
    });
    await quakesToggle.click({ timeout: 15_000 });

    // Give the feed fetch + circle paint a beat, matching the sibling specs.
    await page.waitForTimeout(3_000);

    // The view is centered on the fixture lngLat, so the circle sits at the
    // canvas center; read the box instead of hardcoding viewport pixels.
    const box = await page.locator(MAP_CANVAS).boundingBox();
    if (!box) throw new Error("map canvas reported no layout box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const popup = page.locator(".oz-identify-popup");
    await expect(popup).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".oz-identify-title")).toHaveText("Earthquakes");
    await expect(page.locator(".oz-identify-rows")).toContainText(String(FIXTURE_QUAKE.mag));
    await expect(page.locator(".oz-identify-rows")).toContainText(FIXTURE_QUAKE.place);

    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
  });
});
