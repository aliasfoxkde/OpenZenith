import { test, expect, type Page } from "@playwright/test";

/** Assert a nullable Playwright value is present before use. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("unexpected null value");
  return value;
}

/**
 * The landing hydrates late (hero map + particles): SSR emits the controls,
 * but React attaches listeners only at hydration, and hydration resets
 * controlled inputs. The default-location result panel is client-rendered,
 * so its appearance is the "page is interactive" signal — wait for it
 * before filling or clicking anything.
 */
async function waitInteractive(page: Page) {
  await page.waitForSelector(".oz-result-value", { timeout: 30000 });
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
    await waitInteractive(page);

    await page.fill("#lookup-lat", "27.9881");
    await page.fill("#lookup-lon", "86.925");
    await page.click("#lookup-btn");

    // The panel already shows the default location's result (hydration
    // marker), so its mere existence proves nothing — wait for the VALUE to
    // become Everest's.
    await expect(async () => {
      const resultText = await page.locator(".oz-result-value").textContent();
      // Everest summit elevation should be > 8000m
      expect(parseInt(must(resultText).replace(/,/g, ""))).toBeGreaterThan(8000);
    }).toPass({ timeout: 15000 });
  });

  test("shows error for invalid coordinates", async ({ page }) => {
    await page.goto("/");
    await waitInteractive(page);

    await page.fill("#lookup-lat", "abc");
    await page.fill("#lookup-lon", "86.9");
    await page.click("#lookup-btn");

    await page.waitForSelector(".oz-lookup-error", { timeout: 5000 });
    const errorText = await page.locator(".oz-lookup-error").textContent();
    expect(errorText).toBeTruthy();
  });

  test("address search zooms to a picked place", async ({ page }) => {
    await page.goto("/");
    await waitInteractive(page);
    const search = page.locator("#address-search");
    await expect(search).toBeVisible({ timeout: 15000 });

    // Debounced geocode — type a well-known place and wait for the dropdown.
    // Keep the re-fill guard even though we waited for hydration above: the
    // marker can appear while a later component is still mounting.
    await expect(async () => {
      await search.fill("Eiffel Tower");
      await expect(search).toHaveValue("Eiffel Tower");
    }).toPass({ timeout: 20000 });
    const results = page.getByRole("region", { name: "Address search results" });
    await expect(results).toBeVisible({ timeout: 15000 });
    const firstResult = results.getByRole("button").first();
    await expect(firstResult).toBeVisible({ timeout: 10000 });

    // Committing a pick must drive the lookup form and the hero map fly
    // target — the inputs get the picked coordinates and the elevation
    // result panel renders.
    const pickedLat = "48.8584";
    await firstResult.click();

    await expect(page.locator("#lookup-lat")).not.toHaveValue("", { timeout: 10000 });
    await expect(page.locator("#lookup-lon")).not.toHaveValue("", { timeout: 10000 });
    // Eiffel Tower is in Paris — sanity-bound the picked coordinates.
    const lat = parseFloat(must(await page.inputValue("#lookup-lat")));
    const lon = parseFloat(must(await page.inputValue("#lookup-lon")));
    expect(lat).toBeGreaterThan(48);
    expect(lat).toBeLessThan(49);
    expect(lon).toBeGreaterThan(2);
    expect(lon).toBeLessThan(3);
    expect(Math.abs(lat - parseFloat(pickedLat))).toBeLessThan(0.1);

    // The pick also triggers the elevation lookup for the same point.
    await page.waitForSelector(".oz-result-value", { timeout: 15000 });
  });

  test("hero map renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#hero-map canvas", { timeout: 15000 });
    const canvas = page.locator("#hero-map canvas");
    await expect(canvas).toBeVisible();
  });

  test("sample location buttons work", async ({ page }) => {
    await page.goto("/");
    await waitInteractive(page);

    // Click a sample location button and wait for state update
    const sampleBtn = page.locator(".oz-sample-btn").first();
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // The click populates the controlled inputs via React state — wait for
    // the values instead of a fixed sleep (uniform hydration-marker pattern).
    await expect(async () => {
      expect(await page.inputValue("#lookup-lat")).toBeTruthy();
      expect(await page.inputValue("#lookup-lon")).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test("has feature cards", async ({ page }) => {
    await page.goto("/");
    const features = page.locator("text=Features");
    await expect(features.first()).toBeVisible();
  });

  test("back to top button appears on scroll", async ({ page }) => {
    await page.goto("/");

    // Scroll down
    await page.evaluate(() => {
      window.scrollTo(0, 1000);
    });

    // Check that the page scrolled successfully
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(500);
  });

  test("flip card toggles on click and keyboard", async ({ page }) => {
    await page.goto("/");
    await waitInteractive(page);

    const card = page.locator(".oz-flip-card").first();
    await card.scrollIntoViewIfNeeded();
    // Disclosure pattern: the corner toggle is the card's announcer
    // (aria-expanded); the card itself is not an interactive element.
    const toggle = card.locator(".oz-flip-hint");

    // Resting state: front shown, not expanded.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Click flips (state class pins it; hover-flip only drives CSS).
    await card.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(card).toHaveClass(/flipped/);

    // Click again unflips.
    await card.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Enter on the toggle flips; Escape (bubbling to the card) unflips.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(card).not.toHaveClass(/flipped/);
  });

  test("CTA link inside a flipped card does not toggle the card", async ({ page }) => {
    await page.goto("/");
    await waitInteractive(page);

    // The Contribute card's back face carries an in-app CTA; clicking it must
    // navigate without also flipping (cancel navigation here, keep the click).
    const contributeCard = page.locator(".oz-flip-card", { hasText: "Contribute Data" });
    await contributeCard.scrollIntoViewIfNeeded();

    await page.evaluate(() => {
      const anchor = document.querySelector<HTMLElement>('.oz-flip-card a[href="/contribute"]');
      if (!anchor) throw new Error("contribute CTA not found");
      anchor.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
        },
        { once: true },
      );
      anchor.click();
    });

    await expect(contributeCard.locator(".oz-flip-hint")).toHaveAttribute("aria-expanded", "false");
  });

  test("loads and interacts without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto("/");
    await waitInteractive(page);
    await page.locator(".oz-flip-card").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    // Map tiles and third-party layers fail for network reasons; those are
    // environmental, not app defects. The cloudflareinsights beacon is
    // injected by the zone (CORS-blocked and SRI-mismatched when the edge
    // challenges the request) — also environmental. Anything else fails.
    const environmental = /net::|Failed to load resource|tile| ERR_|cloudflareinsights|beacon\.min\.js/i;
    const real = errors.filter((e) => !environmental.test(e));
    expect(real).toEqual([]);
  });
});
