import { describe, it, expect, vi } from "vitest";
import { addProfileLayers, removeProfileLayers } from "../profile-layers";

/** Minimal maplibregl.Map test double covering the surface profile-layers touches. */
function makeMap() {
  const sources = new Map<string, { setData: (d: unknown) => void; type: string }>();
  const layers = new Map<string, Record<string, unknown>>();
  const map = {
    addSource: (id: string, spec: Record<string, unknown>) => {
      sources.set(id, { setData: vi.fn(), type: String(spec["type"]) });
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => {
      sources.delete(id);
    },
    addLayer: (layer: Record<string, unknown>) => {
      layers.set(String(layer["id"]), layer);
    },
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => {
      layers.delete(id);
    },
    getStyle: () => ({ layers: [...layers.keys()].map((id) => ({ id, type: "line" })) }),
  };
  return map as unknown as maplibregl.Map & { getSource: (id: string) => { setData: (d: unknown) => void } | undefined };
}

const TWO: [number, number][] = [
  [36.6, -118.2],
  [36.7, -118.1],
];

describe("profile-layers", () => {
  it("adds the line and one marker per endpoint", () => {
    const map = makeMap();
    addProfileLayers(map, TWO);
    expect(map.getSource("profile-line")).toBeDefined();
    expect(map.getSource("profile-marker-0")).toBeDefined();
    expect(map.getSource("profile-marker-1")).toBeDefined();
  });

  it("updates the line source in place on repeat, no duplicate layers", () => {
    const map = makeMap();
    addProfileLayers(map, TWO);
    const line = map.getSource("profile-line");
    const setData = line ? vi.spyOn(line, "setData") : undefined;
    addProfileLayers(map, TWO);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.getSource("profile-marker-0")).toBeDefined();
    expect(map.getSource("profile-marker-1")).toBeDefined();
  });

  it("removes markers left over from a longer previous profile", () => {
    const map = makeMap();
    addProfileLayers(map, TWO);
    addProfileLayers(map, [TWO[0]!]);
    expect(map.getSource("profile-line")).toBeDefined();
    expect(map.getSource("profile-marker-0")).toBeDefined();
    expect(map.getSource("profile-marker-1")).toBeUndefined();
  });

  it("removeProfileLayers clears every profile layer and source", () => {
    const map = makeMap();
    addProfileLayers(map, TWO);
    removeProfileLayers(map);
    expect(map.getSource("profile-line")).toBeUndefined();
    expect(map.getSource("profile-marker-0")).toBeUndefined();
    expect(map.getSource("profile-marker-1")).toBeUndefined();
  });

  it("removeProfileLayers on a clean map is a no-op", () => {
    const map = makeMap();
    expect(() => {
      removeProfileLayers(map);
    }).not.toThrow();
  });
});
