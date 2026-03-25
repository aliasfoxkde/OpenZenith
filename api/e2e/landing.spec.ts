import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/");
    expect(response!.status()).toBeLessThan(400);
  });

  test("has correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OpenZenith/);
  });

  test("has elevation lookup form", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#lookup-lat")).toBeVisible();
    await expect(page.locator("#lookup-lon")).toBeVisible();
    await expect(page.locator("#lookup-btn")).toBeVisible();
  });

  test("performs elevation lookup", async ({ page }) => {
    await page.goto("/");

    await page.fill("#lookup-lat", "28.0");
    await page.fill("#lookup-lon", "86.9");
    await page.click("#lookup-btn");

    // Wait for result to appear
    await page.waitForSelector(".oz-result-value", { timeout: 15000 });
    const resultText = await page.locator(".oz-result-value").textContent();
    // Everest elevation should be > 8000m
    expect(parseInt(resultText!.replace(/,/g, ""))).toBeGreaterThan(8000);
  });

  test("shows error for invalid coordinates", async ({ page }) => {
    await page.goto("/");

    await page.fill("#lookup-lat", "abc");
    await page.fill("#lookup-lon", "86.9");
    await page.click("#lookup-btn");

    await page.waitForSelector(".oz-lookup-error", { timeout: 5000 });
    const errorText = await page.locator(".oz-lookup-error").textContent();
    expect(errorText).toBeTruthy();
  });

  test("hero map renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#hero-map canvas", { timeout: 15000 });
    const canvas = page.locator("#hero-map canvas");
    await expect(canvas).toBeVisible();
  });

  test("sample location buttons work", async ({ page }) => {
    await page.goto("/");

    // Click a sample location button
    const sampleBtn = page.locator(".oz-sample-btn").first();
    const btnText = await sampleBtn.textContent();
    await sampleBtn.click();

    // Verify inputs are populated
    const lat = await page.inputValue("#lookup-lat");
    const lon = await page.inputValue("#lookup-lon");
    expect(lat).toBeTruthy();
    expect(lon).toBeTruthy();
  });

  test("has feature cards", async ({ page }) => {
    await page.goto("/");
    const features = page.locator("text=Features");
    await expect(features.first()).toBeVisible();
  });

  test("back to top button appears on scroll", async ({ page }) => {
    await page.goto("/");

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 1000));

    // Back to top should appear
    const btn = page.locator(".oz-back-to-top");
    await expect(btn).toBeVisible();
  });
});
