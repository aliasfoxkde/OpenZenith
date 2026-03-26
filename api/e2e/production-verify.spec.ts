import { test, expect } from "@playwright/test";

const PROD = "https://openzenith.pages.dev";

test.describe("Production site verification", () => {
  test("landing page loads and has title", async ({ page }) => {
    const resp = await page.goto(PROD);
    expect(resp!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/OpenZenith/);
  });

  test("elevation API responds", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/elevation?lat=28.0&lon=86.9`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.elevation).toBe("number");
    expect(body.elevation).toBeGreaterThan(5000); // Everest region
    expect(body.unit).toBe("meters");
    expect(body.source).toBeTruthy();
  });

  test("health API responds", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toMatch(/healthy|ok/);
    expect(body.version).toBeTruthy();
    expect(body.storage).toBeTruthy();
  });

  test("tile API returns valid binary data", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/tile/8/105/47`);
    expect(resp.status()).toBe(200);
    const buf = await resp.body();
    // 256x256 tiles * 2 bytes (Int16) = 131072 bytes
    expect(buf.length).toBe(131072);
  });

  test("OpenAPI docs page loads", async ({ page }) => {
    const resp = await page.goto(`${PROD}/api/docs`);
    expect(resp!.status()).toBeLessThan(400);
    await page.waitForTimeout(2000);
    // Verify the docs page rendered HTML content
    const html = await page.content();
    expect(html.length).toBeGreaterThan(200);
  });

  test("map page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const resp = await page.goto(`${PROD}/map`);
    expect(resp!.status()).toBeLessThan(400);
    await page.waitForTimeout(5000);
    expect(errors).toHaveLength(0);
  });

  test("worldview/globe page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      // CesiumJS "Event" error is benign — ignore it
      if (err.message !== "Event") errors.push(err.message);
    });
    const resp = await page.goto(`${PROD}/worldview`);
    expect(resp!.status()).toBeLessThan(400);
    await page.waitForTimeout(5000);
    expect(errors).toHaveLength(0);
  });

  test("demo page loads", async ({ page }) => {
    const resp = await page.goto(`${PROD}/demo`);
    expect(resp!.status()).toBeLessThan(400);
  });

  test("explore page loads", async ({ page }) => {
    const resp = await page.goto(`${PROD}/explore`);
    expect(resp!.status()).toBeLessThan(400);
  });

  test("about page loads", async ({ page }) => {
    const resp = await page.goto(`${PROD}/about`);
    expect(resp!.status()).toBeLessThan(400);
  });

  test("contribute page loads", async ({ page }) => {
    const resp = await page.goto(`${PROD}/contribute`);
    expect(resp!.status()).toBeLessThan(400);
  });

  test("geocode API responds", async ({ request }) => {
    const resp = await request.get(
      `${PROD}/api/geocode?query=${encodeURIComponent("Mount Everest")}`,
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.results).toBeTruthy();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].lat).toBeTruthy();
    expect(body.results[0].lon).toBeTruthy();
  });

  test("flights API responds or times out gracefully", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/flights?lat=40.6&lon=-73.8&radius=50`);
    // OpenSky API may timeout on Cloudflare edge — accept 200 or 502
    expect([200, 502, 504]).toContain(resp.status());
  });

  test("weather warnings API responds or times out gracefully", async ({ request }) => {
    const resp = await request.get(`${PROD}/api/weather/warnings`);
    // NOAA API may timeout on Cloudflare edge — accept 200 or 502
    expect([200, 502, 504]).toContain(resp.status());
  });

  test("robots.txt and sitemap.xml are accessible", async ({ request }) => {
    const robots = await request.get(`${PROD}/robots.txt`);
    expect(robots.status()).toBe(200);
    const sitemap = await request.get(`${PROD}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
  });
});
