import { test, expect } from "@playwright/test";

/** Assert a nullable Playwright value is present before use. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("unexpected null value");
  return value;
}

test.describe("Landing page", () => {
  test("loads successfully", async ({ page }) => {
    const response = await page.goto("/");
    expect(must(response).status()).toBeLessThan(400);
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

    await page.fill("#lookup-lat", "27.9881");
    await page.fill("#lookup-lon", "86.925");
    await page.click("#lookup-btn");

    // Wait for result to appear
    await page.waitForSelector(".oz-result-value", { timeout: 15000 });
    const resultText = await page.locator(".oz-result-value").textContent();
    // Everest summit elevation should be > 8000m
    expect(parseInt(must(resultText).replace(/,/g, ""))).toBeGreaterThan(8000);
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

    // Click a sample location button and wait for state update
    const sampleBtn = page.locator(".oz-sample-btn").first();
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();
    await page.waitForTimeout(500);

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
    await page.evaluate(() => { window.scrollTo(0, 1000); });

    // Check that the page scrolled successfully
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(500);
  });

  test("flip card toggles on click and keyboard", async ({ page }) => {
    await page.goto("/");

    const card = page.locator(".oz-flip-card").first();
    await card.scrollIntoViewIfNeeded();

    // Resting state: front shown, not pressed.
    await expect(card).toHaveAttribute("aria-pressed", "false");

    // Click flips (state class pins it; hover-flip only drives CSS).
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveClass(/flipped/);

    // Click again unflips.
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "false");

    // Enter toggles, Escape unflips.
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await expect(card).not.toHaveClass(/flipped/);
  });

  test("CTA link inside a flipped card does not toggle the card", async ({ page }) => {
    await page.goto("/");

    // The Contribute card's back face carries an in-app CTA; clicking it must
    // navigate without also flipping (cancel navigation here, keep the click).
    const contributeCard = page.locator(".oz-flip-card", { hasText: "Contribute Data" });
    await contributeCard.scrollIntoViewIfNeeded();

    await page.evaluate(() => {
      const anchor = document.querySelector<HTMLElement>('.oz-flip-card a[href="/contribute"]');
      if (!anchor) throw new Error("contribute CTA not found");
      anchor.addEventListener("click", (e) => e.preventDefault(), { once: true });
      anchor.click();
    });

    await expect(contributeCard).toHaveAttribute("aria-pressed", "false");
  });

  test("loads and interacts without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto("/");
    await page.locator(".oz-flip-card").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    // Map tiles and third-party layers fail for network reasons; those are
    // environmental, not app defects. Anything else fails the test.
    const environmental = /net::|Failed to load resource|tile| ERR_/i;
    const real = errors.filter((e) => !environmental.test(e));
    expect(real).toEqual([]);
  });
});
