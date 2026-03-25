import { describe, it, expect } from "vitest";
import { LAYERS, getLayersByCategory, getDefaultToggleState, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/layers/registry";

describe("Layer Registry", () => {
  it("exports all expected layers", () => {
    expect(LAYERS.length).toBeGreaterThan(10);
  });

  it("each layer has required fields", () => {
    for (const layer of LAYERS) {
      expect(layer.id).toBeTruthy();
      expect(layer.name).toBeTruthy();
      expect(layer.category).toBeTruthy();
      expect(layer.description).toBeTruthy();
      expect(typeof layer.defaultEnabled).toBe("boolean");
      expect(layer.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("all layer IDs are unique", () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getLayersByCategory returns layers grouped by category", () => {
    const groups = getLayersByCategory();
    expect(groups.weather).toBeDefined();
    expect(groups.weather!.length).toBeGreaterThan(0);
    for (const layer of groups.weather!) {
      expect(layer.category).toBe("weather");
    }
    expect(groups.terrain).toBeDefined();
    expect(groups.aviation).toBeDefined();
  });

  it("getDefaultToggleState returns boolean map", () => {
    const state = getDefaultToggleState();
    expect(Object.keys(state).length).toBe(LAYERS.length);
    for (const [id, enabled] of Object.entries(state)) {
      expect(typeof enabled).toBe("boolean");
      const layer = LAYERS.find((l) => l.id === id);
      expect(layer).toBeDefined();
      expect(enabled).toBe(layer!.defaultEnabled);
    }
  });

  it("CATEGORY_ORDER has expected categories", () => {
    expect(CATEGORY_ORDER).toContain("weather");
    expect(CATEGORY_ORDER).toContain("terrain");
    expect(CATEGORY_ORDER).toContain("aviation");
    expect(CATEGORY_ORDER).toContain("infrastructure");
  });

  it("CATEGORY_LABELS covers all categories in ORDER", () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});
