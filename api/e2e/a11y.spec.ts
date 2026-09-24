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
  const builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag2aaa",
    "best-practice",
  ]);
  const results = await builder.analyze();
  return results.violations ?? [];
}

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/map", name: "map" },
  { path: "/explore", name: "explore" },
  { path: "/studio", name: "studio" },
  { path: "/demo", name: "demo" },
  { path: "/about", name: "about" },
  { path: "/contribute", name: "contribute" },
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
