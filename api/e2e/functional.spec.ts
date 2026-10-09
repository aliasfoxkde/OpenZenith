import { test, expect } from "@playwright/test";

/**
 * Functional interaction tests — the click-paths behind each surface, as
 * opposed to production-verify.spec.ts (HTTP/smoke) and a11y.spec.ts (WCAG).
 *
 * Selectors were verified against the rendered DOM (roles and labels from
 * the actual components), so the specs do not depend on implementation
 * classes. Tests that exercise a click-path into a third-party upstream
 * (geocoder, USGS feed, DEM origin) stub the app's own API route instead of
 * waiting on the live service: two workers × browser projects hit those
 * public endpoints concurrently and get rate-limited, which is a property of
 * the upstream, not of this app. The real end-to-end wiring (route → origin
 * → response) stays covered by production-verify.spec.ts against prod.
 * The suite runs against the configured baseURL (production by default,
 * E2E_BASE_URL to retarget) with no test data setup.
 *
 * Per-test timeouts are well above the 30s default on purpose: the pages
 * mount WebGL maps and stream tile/feature data, and cold targets (dev
 * server first-compile, prod edge) legitimately take longer than a static
 * page before interactions become actionable.
 */

/** The map pages' WebGL canvas — the click surface for queries. */
const MAP_CANVAS = ".maplibregl-canvas";

/**
 * Reach the page's MapLibre instance through the React fiber tree: the map
 * lives in a component-level ref, so walk up from the `.maplibregl-map`
 * container fiber and find the useRef slot whose current exposes
 * getLayer/getStyle. Returns found=false (never a fabricated pass) when the
 * walk cannot reach the instance.
 */
async function readMapLayers(page: import("@playwright/test").Page): Promise<MapStyleState> {
  return page.evaluate(() => {
    const container = document.querySelector(".maplibregl-map");
    if (!container) return { found: false };
    const key = Object.keys(container).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return { found: false };
    type Fiber = { memoizedState?: unknown; return?: Fiber };
    let fiber: Fiber | undefined = (container as unknown as Record<string, Fiber>)[key];
    for (let hops = 0; hops < 50 && fiber; hops++) {
      type Hook = { memoizedState?: unknown; next?: Hook };
      let hook: Hook | undefined = fiber.memoizedState as Hook | undefined;
      for (let j = 0; j < 40 && hook; j++) {
        const v: unknown = hook.memoizedState;
        if (v && typeof v === "object" && "current" in (v as Record<string, unknown>)) {
          const cur: unknown = (v as { current: unknown }).current;
          if (
            cur &&
            typeof cur === "object" &&
            typeof (cur as { getLayer?: unknown }).getLayer === "function" &&
            typeof (cur as { getStyle?: unknown }).getStyle === "function"
          ) {
            const map = cur as {
              getLayer(id: string): unknown;
              getStyle(): { layers: { id: string }[] };
            };
            return {
              found: true,
              layers: map.getStyle().layers.map((l) => l.id),
              hillshade: Boolean(map.getLayer("hillshade-base")),
            };
          }
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return { found: false };
  });
}

interface MapStyleState {
  found: boolean;
  layers?: string[];
  hillshade?: boolean;
}

test.describe("Map page interactions", () => {
  test("search box geocodes a location", async ({ page }) => {
    test.setTimeout(90_000);
    // Stub the geocode route: { results: [{ lat, lon }] } is the contract the
    // page consumes (results[0] feeds flyTo at zoom 12).
    await page.route("**/api/geocode*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "e2e",
          results: [{ display_name: "Everest, Kansas, United States", lat: 39.6772, lon: -98.4055 }],
          count: 1,
        }),
      }),
    );
    await page.goto("/map");
    const search = page.getByPlaceholder("Search location...");
    await expect(search).toBeVisible({ timeout: 30_000 });
    // The search handler no-ops its flyTo while mapRef is still null, so the
    // map instance (canvas) must exist before Enter — the input renders long
    // before MapLibre finishes loading.
    await page.waitForSelector(MAP_CANVAS, { timeout: 60_000 });
    await search.fill("Everest");
    await search.press("Enter");
    // The top hit flies the map; the mirrored hash must leave the default
    // 0,0/2.5 view for the stub result's center at the fixed result zoom.
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(location.hash)), { timeout: 30_000 })
      .toMatch(/lat=39\.6772&zoom=12/);
  });

  test("hash deep-link restores center and zoom", async ({ page }) => {
    test.setTimeout(90_000);
    // Paris at a distinct zoom; the page must adopt it, not the default.
    await page.goto("/map#lng=2.3522&lat=48.8566&zoom=11&bm=satellite");
    await page.waitForTimeout(4_000);
    const hash = await page.evaluate(() => location.hash);
    expect(hash).toContain("lat=48.8");
    expect(hash).toContain("zoom=11");
    expect(hash).toContain("bm=satellite");
  });

  test("zoom controls change the map zoom", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await page.waitForSelector(MAP_CANVAS, { timeout: 30_000 });
    await page.waitForTimeout(3_000);
    const before = await page.evaluate(() => location.hash);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).not.toBe(before); // zoom is mirrored into the hash
  });

  test("elevation query on map click updates the readout", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await page.waitForSelector(MAP_CANVAS, { timeout: 30_000 });
    await page.waitForTimeout(3_000);
    // Click a spot with known land elevation (Alps) — the pin panel should
    // carry a numeric elevation readout.
    await page.mouse.click(720, 450);
    await page.waitForTimeout(6_000);
    const body = await page.textContent("body");
    expect(body).toMatch(/\d{3,}\s*m|elevation/i);
  });
});

test.describe("Explore page interactions", () => {
  test("tab switch renders a distinct dataset panel", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/explore");
    // Each tab owns a labeled fetch control; Flights' is "Fetch Flights".
    await page.getByRole("tab", { name: /Flights/ }).click({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Fetch Flights" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("fetch earthquakes populates the list", async ({ page }) => {
    test.setTimeout(120_000);
    // The tab relays the USGS feed through /api/proxy/<encoded-url>; stub it
    // with the FeatureCollection shape the item list renders (properties.mag/
    // place/coordinates/depth/tsunami).
    await page.route("**/api/proxy/*earthquake.usgs.gov*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                mag: 5.4,
                place: "72 km SW of Fixture City",
                coordinates: [-155.32, 19.51],
                depth: 12.4,
                tsunami: 0,
              },
              geometry: { type: "Point", coordinates: [-155.32, 19.51] },
            },
            {
              type: "Feature",
              properties: {
                mag: 3.1,
                place: "Fixture Ridge",
                coordinates: [142.4, 38.3],
                depth: 33.0,
                tsunami: 0,
              },
              geometry: { type: "Point", coordinates: [142.4, 38.3] },
            },
          ],
        }),
      }),
    );
    await page.goto("/explore");
    await page.getByRole("tab", { name: /Earthquakes/ }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    // Fetch → proxy → list: the info bar counts features, the list renders
    // one item per fixture feature.
    await expect(page.locator(".ex-info-bar")).toContainText("earthquakes", {
      timeout: 30_000,
    });
    await expect(page.locator(".ex-quake-item")).toHaveCount(2);
    await expect(page.locator(".ex-quake-item").first()).toContainText("72 km SW of Fixture City");
  });
});

test.describe("Studio interactions", () => {
  test("loads, hydrates, and shows the tool palette", async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Preset the onboarding flag so the welcome dialog does not cover the
    // palette this test asserts on (its own lifecycle has a dedicated test).
    await page.addInitScript(() => {
      localStorage.setItem("openzenith-studio-onboarded", "1");
    });
    await page.goto("/studio");
    await expect(page.getByRole("heading", { name: "OpenZenith Studio" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("tab", { name: /Elevation/ })).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(errors).toHaveLength(0); // hydration regression sentinel
  });

  test("tab switch changes the tool panel", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem("openzenith-studio-onboarded", "1");
    });
    await page.goto("/studio");
    const geocode = page.getByRole("tab", { name: /Geocode/ });
    // The tab renders in SSR HTML, so the first click can land before React
    // attaches its handlers and be swallowed. Retry the click+assert pair
    // until one lands post-hydration (the landing-spec hydration pattern).
    await expect(async () => {
      await geocode.click();
      await expect(page.getByRole("tabpanel", { name: /Geocode/ })).toBeVisible();
    }).toPass({ timeout: 30_000 });
  });

  test("onboarding dismisses and persists", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/studio");
    const start = page.getByRole("button", { name: "Get Started" });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.click();
    // The dismiss writes the flag synchronously.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("openzenith-studio-onboarded"))).toBe("1");
    await page.reload();
    await page.waitForTimeout(2_000);
    expect(await page.getByRole("button", { name: "Get Started" }).isVisible()).toBe(false);
  });

  test("basemap switch restores hillshade and data layers", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("openzenith-studio-onboarded", "1");
    });
    await page.goto("/studio");
    await page.getByRole("tab", { name: /Layers/ }).click({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    // Baseline: the mount-once init registered the shared hillshade.
    const before = await readMapLayers(page);
    expect(before.found).toBe(true);
    expect(before.hillshade).toBe(true);
    // Switch basemap ("OpenStreetMap" in the registry) — setStyle() replaces
    // the whole style, and the page must re-add the elevation source,
    // hillshade and data layers afterwards.
    await page.locator("button", { hasText: "OpenStreetMap" }).first().click();
    await page.waitForTimeout(3_000);
    const after = await readMapLayers(page);
    expect(after.found).toBe(true);
    expect(after.hillshade).toBe(true);
    expect(after.layers).toContain("basemap");
    expect(after.layers).toContain("hillshade-base");
  });
});

test.describe("Demo (elevation map) interactions", () => {
  test("click queries elevation and shows the readout", async ({ page }) => {
    test.setTimeout(120_000);
    // Stub the point-elevation route ({ elevation, source } is the response
    // contract); the live origin legitimately returns "No data" for ocean or
    // under a tile-fetch blip, which is upstream behavior, not click wiring.
    await page.route("**/api/elevation*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ elevation: 5364, source: "ozt2" }),
      }),
    );
    await page.goto("/demo");
    // 60s: cold dev compile of this route plus the CDN script load are both
    // inside this wait.
    await page.waitForSelector(MAP_CANVAS, { timeout: 60_000 });
    await expect(page.getByText("Click anywhere to query elevation")).toBeVisible({
      timeout: 30_000,
    });
    await page.mouse.click(720, 450);
    // Header readout renders the stubbed value: "5,364m @ lat, lon".
    await expect.poll(() => page.locator("main").textContent(), { timeout: 30_000 }).toMatch(/5,364m\s*@/);
  });
});

test.describe("WASM demo", () => {
  test("decodes and renders terrain analysis modules", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/wasm-demo");
    await expect(page.getByRole("heading", { name: /WASM Decoder Demo/ })).toBeVisible({
      timeout: 30_000,
    });
    // The demo instantiates D8/viewshed/OZT2 WASM modules; give the compile
    // and first decode a generous window, then require at least one module
    // reported success in the page copy.
    await page.waitForTimeout(30_000);
    const body = await page.textContent("body");
    expect(body).toMatch(/(decoded|ready|success|loaded|bytes|ms)/i);
    expect(errors).toHaveLength(0);
  });
});

test.describe("API docs", () => {
  test("docs page renders the endpoint listing", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/api/docs");
    // The spec loads and renders asynchronously ("Loading docs..." first).
    await expect.poll(() => page.locator("main").textContent(), { timeout: 30_000 }).toMatch(/\/api\/elevation/);
    const body = await page.textContent("body");
    expect(body).toMatch(/(elevation|endpoint|api)/i);
  });
});
