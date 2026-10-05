import { AxeBuilder } from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Automated WCAG 2.1 audit via axe-core.
 *
 * Rule set: `wcag2a` + `wcag2aa` (the axe-enforceable core) plus `wcag2aaa`
 * (blink/marquee/meta-refresh-no-exceptions and the AAA-tagged extras) and
 * `best-practice`. The AA→AAA deltas axe cannot fully express (7:1 contrast,
 * 44px target size) are covered by the token audit in
 * docs/planning/MASTER_PLAN_2026-09-22.md §Phase C and the design tokens
 * themselves.
 *
 * Third-party exclusion: MapLibre/Cesium ship their own control DOM
 * (`.maplibregl-ctrl-*`, `.cesium-*`). WCAG 2.1 exempts user-agent- and
 * author-supplied-third-party controls the page cannot restyle without
 * forking the vendor component; violations scoped inside those selectors are
 * filtered and reported as known exclusions rather than silently dropped.
 */

/** Vendor control containers whose internals are out of first-party scope. */
const VENDOR_SCOPES = [".maplibregl-ctrl", ".cesium-viewer", ".cesium-widget"];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeViolation = NonNullable<AxeResults["violations"]>[number];

/** True when every targeted element sits inside a vendor control container. */
function isVendorOnly(violation: AxeViolation): boolean {
  return violation.nodes.every((node) =>
    node.target.some((sel) => VENDOR_SCOPES.some((scope) => sel.includes(scope))),
  );
}

async function scan(page: Page, path: string): Promise<AxeViolation[]> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Give client-side frameworks a beat to hydrate before auditing.
  await page.waitForLoadState("networkidle").catch(() => {
    // Map layers stream indefinitely; the audit can proceed on what has
    // rendered — networkidle is a best-effort gate, not a correctness gate.
  });
  // Hydration gate: every audited page renders an (sr-only where the chrome
  // is a full-viewport map) h1 client-side. Auditing before it mounts reads
  // late-mounted content as violations — a flaky first attempt, not a real
  // defect. Every page carries one, so this wait is deterministic.
  await page.waitForSelector("h1", { timeout: 15_000 }).catch(() => {
    // A page that never mounts its h1 will fail the heading assertion below
    // with the real finding — don't mask it with a scan-timeout error.
  });
  // Freeze animations/transitions for the audit: axe samples an animated
  // element mid-pulse (e.g. the map-loading fade, which dips to opacity
  // 0.4) and reads its transient state as a contrast failure — a false
  // positive by construction. `@axe-core/playwright` 4.13 has no
  // disableAnimations(), so neutralize animations with an injected
  // stylesheet instead; every animated element's base style is what the
  // audit then sees.
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag2aaa",
    "best-practice",
  ]);
  const results = await builder.analyze();
  return results.violations;
}

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/map", name: "map" },
  { path: "/explore", name: "explore" },
  { path: "/studio", name: "studio" },
  { path: "/demo", name: "demo" },
  { path: "/about", name: "about" },
  { path: "/contribute", name: "contribute" },
  { path: "/api/docs", name: "api docs" },
  { path: "/wasm-demo", name: "wasm demo" },
  { path: "/not-found", name: "not found" },
];

// The globe page boots Cesium from CDN and streams terrain; it is audited
// separately below with vendor scoping, not excluded from the suite.
const GLOBE_PATH = "/globe";

test.describe("Accessibility (WCAG 2.1 A/AA + AAA-tagged rules)", () => {
  // Auditing against the live site means CDN latency plus layers that stream
  // forever — axe waits for DOM stability, so the heavy pages (landing, map,
  // globe) legitimately exceed the 30 s default inside builder.analyze().
  test.setTimeout(120_000);

  for (const { path, name } of PAGES) {
    test(`no axe violations on ${name} (${path})`, async ({ page }) => {
      const violations = await scan(page, path);
      const firstParty = violations.filter((v) => !isVendorOnly(v));
      const vendor = violations.filter(isVendorOnly);
      if (vendor.length > 0) {
        console.log(
          `[a11y] ${name}: ${vendor.length} vendor-scoped violation type(s) excluded: ` +
            vendor.map((v) => v.id).join(", "),
        );
      }
      expect(
        firstParty.map((v) => ({
          rule: v.id,
          impact: v.impact,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }

  test(`no first-party axe violations on globe (${GLOBE_PATH})`, async ({ page }) => {
    const violations = await scan(page, GLOBE_PATH);
    const firstParty = violations.filter((v) => !isVendorOnly(v));
    const vendor = violations.filter(isVendorOnly);
    if (vendor.length > 0) {
      console.log(
        `[a11y] globe: ${vendor.length} vendor-scoped violation type(s) excluded: ` +
          vendor.map((v) => v.id).join(", "),
      );
    }
    expect(
      firstParty.map((v) => ({
        rule: v.id,
        impact: v.impact,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      })),
    ).toEqual([]);
  });
});

/* ─── Keyboard traversal + target size (axe cannot express these) ───
 *
 * axe-core samples static DOM: it cannot press Tab, so 2.1.1 (no trap),
 * 2.4.3 (focus order) and 2.4.7 (focus visible) need a live browser, and
 * 2.5.8 (target size) needs real geometry. These checks complement the
 * axe passes above; they run on the first-party pages (the globe boots
 * Cesium from CDN and is already audited with vendor scoping above).
 */

/** First-party pages for the behavioral keyboard/geometry checks. */
const BEHAVIOR_PAGES = [
  { path: "/", name: "landing" },
  { path: "/api/docs", name: "api docs" },
  { path: "/wasm-demo", name: "wasm demo" },
  { path: "/not-found", name: "not found" },
];

interface FocusStep {
  tag: string;
  id: string;
  label: string;
}

/** Press Tab and describe where focus landed. */
async function tabOnce(page: Page): Promise<FocusStep> {
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "BODY", id: "", label: "" };
    return {
      tag: el.tagName,
      id: el.id,
      label:
        el.getAttribute("aria-label") ||
        (el instanceof HTMLElement ? (el.textContent || "").trim().slice(0, 40) : ""),
    };
  });
}

test.describe("Keyboard access (2.1.1 / 2.4.3 / 2.4.7)", () => {
  test.setTimeout(120_000);

  // Focus-order smoke: sequential Tabs must keep moving focus between real
  // elements. Not a full DOM-order proof (that needs visual ground truth);
  // it catches the real failure modes: focus dying on body from the start, a
  // wrapper eating every press, or one element re-grabbing focus. The floors
  // scale with the page's tabbable count: a one-link 404 page cannot fill
  // six stops, so it is held to "first press lands on the link" rather than
  // six distinct targets — the strict floors still apply to every rich page.
  for (const { path, name } of [...PAGES]) {
    test(`tab order advances on ${name} (${path})`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // Landing/map hydrate late; give the interactive marker a beat.
      await page.waitForSelector("h1", { timeout: 15_000 }).catch(() => {});
      const tabbables = await page.evaluate(() => {
        const visible = (el: Element) => {
          const style = getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        return [
          ...document.querySelectorAll(
            "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
          ),
        ].filter(visible).length;
      });
      const steps: FocusStep[] = [];
      for (let i = 0; i < 6; i++) steps.push(await tabOnce(page));
      // Once the presses outrun the page's stops, focus legitimately falls
      // to <body>; only body hits within the page's stop count are a trap.
      const expectedOnBody = Math.max(0, 6 - tabbables);
      const onBody = steps.filter((s) => s.tag === "BODY").length;
      expect(
        onBody,
        `focus fell to <body> ${onBody}/6 presses (page has ${tabbables} stops): ${JSON.stringify(steps)}`,
      ).toBeLessThanOrEqual(expectedOnBody);
      const distinct = new Set(steps.map((s) => `${s.tag}#${s.id}#${s.label}`)).size;
      expect(
        distinct,
        `6 presses reached only ${distinct} distinct targets (page has ${tabbables} stops): ${JSON.stringify(steps)}`,
      ).toBeGreaterThanOrEqual(Math.min(4, tabbables));
    });
  }

  for (const { path, name } of BEHAVIOR_PAGES) {
    test(`keyboard focus is visible on first-party controls (${name})`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 15_000 }).catch(() => {});
      // Walk Tab until focus rests on a first-party interactive control.
      let found: { focusVisible: boolean; indicator: string } | null = null;
      for (let i = 0; i < 12 && !found; i++) {
        await page.keyboard.press("Tab");
        found = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const firstParty = !el.closest(".maplibregl-ctrl, .cesium-viewer, .cesium-widget");
          const interactive = el.matches(
            "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
          );
          if (!firstParty || !interactive) return null;
          const style = getComputedStyle(el);
          const indicator =
            style.outlineStyle !== "none" && style.outlineWidth !== "0px"
              ? `outline ${style.outlineWidth} ${style.outlineStyle}`
              : style.boxShadow !== "none"
                ? "box-shadow"
                : "";
          return { focusVisible: el.matches(":focus-visible"), indicator };
        });
      }
      expect(found, "no first-party interactive control reached via 12 Tabs").not.toBeNull();
      expect(
        found?.focusVisible,
        "focused control does not match :focus-visible (programmatic focus?)",
      ).toBe(true);
      expect(
        found?.indicator,
        "focused control has no visible indicator (outline/box-shadow) — WCAG 2.4.7",
      ).not.toBe("");
    });
  }

  test("flip card does not trap keyboard focus", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".oz-flip-card", { timeout: 30_000 });
    const card = page.locator(".oz-flip-card").first();
    await card.scrollIntoViewIfNeeded();
    const toggle = card.locator(".oz-flip-hint");
    // Closed card: the toggle is its only tab stop — one Tab must leave THIS
    // card. Moving to the next card's toggle is correct DOM order, not a trap,
    // so the check is scoped to the card under test rather than any flip card.
    await toggle.focus();
    await page.keyboard.press("Tab");
    const left = await page.evaluate((cardEl) => {
      const el = document.activeElement;
      return Boolean(el && !cardEl.contains(el));
    }, await card.elementHandle());
    expect(left, "Tab from the closed flip card stayed inside it — keyboard trap (2.1.1)").toBe(true);
    // Opened card: Enter flips, and the back-face CTA becomes reachable.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    const reachedCta = await page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el && el.closest(".oz-flip-back"));
    });
    expect(reachedCta, "opened flip card never exposes its CTA to keyboard users").toBe(true);
    // Escape from inside (CTA focus) closes the card.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("snippet tabs do not trap keyboard focus", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".oz-snippet-tab", { timeout: 30_000 });
    const region = page.locator(".oz-snippet-tabs").locator("xpath=..");
    await region.scrollIntoViewIfNeeded();
    await page.locator(".oz-snippet-tab").first().focus();
    // 6 tabs + copy button live in the region; one press past that must exit.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    const left = await page.evaluate(() => {
      const el = document.activeElement;
      const region = document.querySelector(".oz-snippet-tabs")?.parentElement;
      return Boolean(el && region && !region.contains(el));
    });
    expect(left, "focus never left the snippet tabs region in 8 Tabs — keyboard trap (2.1.1)").toBe(true);
  });
});

test.describe("Target size (2.5.8 AA floor; AAA delta reported)", () => {
  test.setTimeout(120_000);

  for (const { path, name } of BEHAVIOR_PAGES) {
    test(`interactive targets are >= 24px on ${name}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 15_000 }).catch(() => {});
      const undersized = await page.evaluate(() => {
        const results: { desc: string; w: number; h: number }[] = [];
        const nodes = document.querySelectorAll(
          "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
        );
        for (const el of nodes) {
          if (el.closest(".maplibregl-ctrl, .cesium-viewer, .cesium-widget")) continue;
          if (el.getAttribute("aria-hidden") === "true") continue;
          const he = el as HTMLElement;
          if ((he as HTMLButtonElement).disabled || he.getAttribute("aria-disabled") === "true") continue;
          const style = getComputedStyle(he);
          if (style.display === "none" || style.visibility === "hidden") continue;
          // Inline text links carry 2.5.8's inline exception.
          if (style.display === "inline") continue;
          const rect = he.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.width < 24 || rect.height < 24) {
            results.push({
              desc: `${he.tagName.toLowerCase()}${he.id ? "#" + he.id : ""} "${
                (he.getAttribute("aria-label") || he.textContent || "").trim().slice(0, 30)
              }"`,
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            });
          }
        }
        return results;
      });
      expect(
        undersized,
        `targets under the 24×24 AA floor on ${name} — fix with padding/min-height, not negative margins`,
      ).toEqual([]);
    });

    test(`44px AAA target-size delta on ${name} (reported, not enforced)`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 15_000 }).catch(() => {});
      const below44 = await page.evaluate(() => {
        const out: { desc: string; minSide: number }[] = [];
        const nodes = document.querySelectorAll(
          "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
        );
        for (const el of nodes) {
          if (el.closest(".maplibregl-ctrl, .cesium-viewer, .cesium-widget")) continue;
          if (el.getAttribute("aria-hidden") === "true") continue;
          const he = el as HTMLElement;
          if ((he as HTMLButtonElement).disabled || he.getAttribute("aria-disabled") === "true") continue;
          const style = getComputedStyle(he);
          if (style.display === "none" || style.visibility === "hidden" || style.display === "inline") continue;
          const rect = he.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const minSide = Math.min(rect.width, rect.height);
          if (minSide < 44) {
            out.push({
              desc: `${he.tagName.toLowerCase()}${he.id ? "#" + he.id : ""}`,
              minSide: Math.round(minSide),
            });
          }
        }
        return out;
      });
      if (below44.length > 0) {
        console.log(
          `[a11y] ${name}: ${below44.length} control(s) under the 44px AAA guidance: ` +
            below44.map((t) => `${t.desc} (${t.minSide}px)`).join(", "),
        );
      }
    });
  }
});
