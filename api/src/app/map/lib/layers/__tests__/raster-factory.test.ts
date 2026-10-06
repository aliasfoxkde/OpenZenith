/**
 * Tests for the shared raster-layer factory. The ~30 raster overlay modules
 * in this directory delegate their guarded-add/status/remove lifecycle here,
 * so these tests pin the lifecycle contract once instead of per file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/diagnostics", () => ({ warnLayerError: vi.fn() }));

import { warnLayerError } from "@/lib/diagnostics";
import type { LayerHandle } from "../types";
import { createLayerHandle } from "../types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "../raster-factory";

/** In-memory maplibregl.Map stand-in covering the factory's surface. */
function mockMap() {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, Record<string, unknown>>();
  return {
    sources,
    layers,
    addSource: (id: string, source: Record<string, unknown>) => {
      if (sources.has(id)) throw new Error(`source ${id} exists`);
      sources.set(id, source);
    },
    removeSource: (id: string) => {
      if (!sources.delete(id)) throw new Error(`no source ${id}`);
    },
    getSource: (id: string) => sources.get(id),
    addLayer: (layer: Record<string, unknown>) => {
      const id = layer.id as string;
      if (layers.has(id)) throw new Error(`layer ${id} exists`);
      layers.set(id, layer);
    },
    removeLayer: (id: string) => {
      if (!layers.delete(id)) throw new Error(`no layer ${id}`);
    },
    getLayer: (id: string) => layers.get(id),
  };
}

type MockMap = ReturnType<typeof mockMap>;

const baseSpec: RasterLayerSpec = {
  sourceId: "chlorophyll",
  tiles: ["/api/chlorophyll/{z}/{x}/{y}"],
  opacity: 0.85,
};

describe("addRasterLayer", () => {
  let map: MockMap;
  let handle: LayerHandle;

  beforeEach(() => {
    map = mockMap();
    handle = createLayerHandle();
    vi.mocked(warnLayerError).mockClear();
  });

  it("adds source and layer with the derived ids and reports loaded", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, baseSpec);

    expect([...map.sources.keys()]).toEqual(["chlorophyll"]);
    expect([...map.layers.keys()]).toEqual(["chlorophyll-raster"]);
    const layer = map.layers.get("chlorophyll-raster");
    expect(layer).toMatchObject({ type: "raster", source: "chlorophyll" });
    expect(layer?.paint).toEqual({ "raster-opacity": 0.85 });
    expect(handle.status.chlorophyll).toBe("loaded");
  });

  it("passes zooms, tile size, and attribution through to the source", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, {
      sourceId: "seaIce",
      tiles: ["https://example.test/wms?BBOX={bbox-epsg-3857}"],
      opacity: 0.7,
      minzoom: 1,
      maxzoom: 8,
      tileSize: 512,
      attribution: "NSIDC Sea Ice / OSI SAF",
    });

    expect(map.sources.get("seaIce")).toEqual({
      type: "raster",
      tiles: ["https://example.test/wms?BBOX={bbox-epsg-3857}"],
      tileSize: 512,
      minzoom: 1,
      maxzoom: 8,
      attribution: "NSIDC Sea Ice / OSI SAF",
    });
  });

  it("merges extra paint after raster-opacity and honours a custom layer id", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, {
      sourceId: "bathymetry",
      tiles: ["/api/elevation-color/{z}/{x}/{y}"],
      opacity: 0.55,
      layerId: "bathymetry",
      paint: { "raster-saturation": 0.3, "raster-brightness-max": 0.75 },
    });

    expect([...map.layers.keys()]).toEqual(["bathymetry"]);
    expect(map.layers.get("bathymetry")?.paint).toEqual({
      "raster-opacity": 0.55,
      "raster-saturation": 0.3,
      "raster-brightness-max": 0.75,
    });
  });

  it("reports under statusId when given", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, {
      ...baseSpec,
      sourceId: "canopy-height",
      statusId: "canopyHeight",
    });
    expect(handle.status.canopyHeight).toBe("loaded");
    expect(handle.status["canopy-height"]).toBeUndefined();
  });

  it("is idempotent: a second call adds nothing new", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, baseSpec);
    addRasterLayer(map as unknown as maplibregl.Map, handle, baseSpec);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it("self-heals a partial failure on the next call", () => {
    // First call: the layer add throws after the source landed.
    const failing = map as unknown as maplibregl.Map;
    vi.spyOn(map, "addLayer").mockImplementationOnce(() => {
      throw new Error("style busy");
    });
    addRasterLayer(failing, handle, baseSpec);
    expect(handle.status.chlorophyll).toBe("error");
    expect(warnLayerError).toHaveBeenCalledWith("chlorophyll", expect.any(Error));

    // Second call: source exists, layer add succeeds → repaired + loaded.
    addRasterLayer(failing, handle, baseSpec);
    expect(handle.status.chlorophyll).toBe("loaded");
    expect(map.layers.size).toBe(1);
  });

  it("with reportStatus false: no handle writes, failures still warn", () => {
    addRasterLayer(map as unknown as maplibregl.Map, handle, { ...baseSpec, reportStatus: false });
    expect(handle.status).toEqual({});

    // Fresh map so the source add actually runs and can fail.
    const fresh = mockMap();
    vi.spyOn(fresh, "addSource").mockImplementationOnce(() => {
      throw new Error("quota");
    });
    addRasterLayer(fresh as unknown as maplibregl.Map, handle, { ...baseSpec, reportStatus: false });
    expect(handle.status).toEqual({});
    expect(warnLayerError).toHaveBeenCalledWith("chlorophyll", expect.any(Error));
  });
});

describe("removeRasterLayer", () => {
  it("removes layer then source, tolerating absent parts", () => {
    const map = mockMap();
    const order: string[] = [];
    map.removeLayer = (id: string) => {
      order.push(`layer:${id}`);
      if (!map.layers.delete(id)) throw new Error(`no layer ${id}`);
      return map as unknown as maplibregl.Map;
    };
    map.removeSource = (id: string) => {
      order.push(`source:${id}`);
      if (!map.sources.delete(id)) throw new Error(`no source ${id}`);
      return map as unknown as maplibregl.Map;
    };

    // Nothing added yet: both removals are skipped (guarded — a bare remove
    // would log a console ErrorEvent) and must not throw.
    const noopRemove = () => {
      removeRasterLayer(map as unknown as maplibregl.Map, "chlorophyll");
    };
    expect(noopRemove).not.toThrow();
    expect(order).toEqual([]);

    addRasterLayer(map as unknown as maplibregl.Map, createLayerHandle(), baseSpec);
    removeRasterLayer(map as unknown as maplibregl.Map, "chlorophyll");
    expect(order).toEqual(["layer:chlorophyll-raster", "source:chlorophyll"]);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it("honours a custom layer id on removal", () => {
    const map = mockMap();
    addRasterLayer(map as unknown as maplibregl.Map, createLayerHandle(), {
      ...baseSpec,
      sourceId: "elevation-color",
      layerId: "elevation-color-layer",
    });
    removeRasterLayer(map as unknown as maplibregl.Map, "elevation-color", "elevation-color-layer");
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });
});
