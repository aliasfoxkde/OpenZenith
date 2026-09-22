/**
 * Tests for src/lib/basemaps.ts — the shared basemap registry.
 *
 * The map and globe clients both derive their pickers from this module, so
 * the invariants here (complete order, label-URL coherence, dark detection,
 * fallback) are what keeps the two UIs from drifting apart.
 */
import { describe, it, expect } from "vitest";
import { BASEMAPS, BASEMAP_ORDER, GLOBE_BASEMAP_KEYS, getBasemap, type BasemapDef } from "@/lib/basemaps";
import { SURVEILLANCE_THEME } from "@/lib/theme";

const ALL: Record<string, BasemapDef> = BASEMAPS;

describe("basemap registry", () => {
  it("covers every order entry and vice versa", () => {
    expect(Object.keys(BASEMAPS).sort()).toEqual([...BASEMAP_ORDER].sort());
  });

  it("restricts the globe to keys that exist in the registry", () => {
    for (const key of GLOBE_BASEMAP_KEYS) {
      expect(BASEMAPS[key], key).toBeTruthy();
    }
  });

  it("gives every basemap a label, tile URL, and attribution", () => {
    for (const [key, def] of Object.entries(ALL)) {
      expect(def.label, key).toBeTruthy();
      expect(def.url, key).toMatch(/^https:\/\//);
      expect(def.attribution, key).toMatch(/^&copy;/);
    }
  });

  it("provides a label overlay URL exactly when the basemap lacks its own labels", () => {
    for (const [key, def] of Object.entries(ALL)) {
      if (def.hasLabels) {
        expect(def.labelUrl, `${key} has its own labels`).toBeUndefined();
      } else {
        expect(def.labelUrl, `${key} needs a label overlay`).toMatch(/only_labels/);
      }
    }
  });

  it("marks the dark variants dark and everything else light", () => {
    expect(Object.entries(BASEMAPS).filter(([, d]) => d.isDark).map(([k]) => k)).toEqual([
      "dark",
      "dark_contrast",
      "dark_nolabel",
    ]);
  });

  it("falls back to dark for unknown keys", () => {
    expect(getBasemap("nope")).toBe(BASEMAPS.dark);
    expect(getBasemap("satellite")).toBe(BASEMAPS.satellite);
  });

  it("keeps the theme's dark basemap URLs in sync with the registry", () => {
    expect(SURVEILLANCE_THEME.basemapDark).toBe(BASEMAPS.dark.url);
    expect(SURVEILLANCE_THEME.basemapDarkNolabels).toBe(BASEMAPS.dark_nolabel.url);
  });
});
