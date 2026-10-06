/**
 * Tests for buildMapStyle (map init + basemap-switch root style). The two
 * call sites previously duplicated this object and only one carried the
 * glyphs property, which made every text-bearing symbol layer fail MapLibre
 * style validation under light basemaps — these tests pin glyphs presence
 * for BOTH themes and the dark-only land-contrast extras.
 */
import { describe, it, expect } from "vitest";
import { buildMapStyle, MAP_GLYPHS_URL, basemapRasterSource } from "../map-setup";
import { BASEMAPS, getBasemap } from "@/lib/basemaps";

const defs = Object.values(BASEMAPS);
const light = defs.find((b) => !b.isDark);
const dark = defs.find((b) => b.isDark);
if (!light || !dark) throw new Error("basemap registry must contain both a light and a dark entry");

describe("buildMapStyle", () => {
  it("always carries a glyphs property — symbol layers need it in both themes", () => {
    for (const def of defs) {
      expect(buildMapStyle(def).glyphs).toBe(MAP_GLYPHS_URL);
    }
  });

  it("accepts unvalidated keys like getBasemap does", () => {
    expect(buildMapStyle(getBasemap("no-such-basemap")).glyphs).toBe(MAP_GLYPHS_URL);
  });

  it("points at the basemap's raster source with its maxzoom and attribution", () => {
    const style = buildMapStyle(light);
    expect(style.sources.basemap).toEqual(basemapRasterSource(light));
    expect(style.layers[0]).toMatchObject({ id: "basemap", type: "raster", source: "basemap" });
  });

  it("adds the land-contrast overlay only for dark basemaps", () => {
    const darkStyle = buildMapStyle(dark);
    expect(Object.keys(darkStyle.sources)).toContain("land");
    expect(darkStyle.layers.some((l) => l.id === "land-contrast")).toBe(true);

    const lightStyle = buildMapStyle(light);
    expect(Object.keys(lightStyle.sources)).not.toContain("land");
    expect(lightStyle.layers.some((l) => l.id === "land-contrast")).toBe(false);
  });
});
