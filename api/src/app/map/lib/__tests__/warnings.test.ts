/**
 * Tests for the weather-warnings layer's paint contract. The fill and outline
 * both colour by `["downcase", ["get", …]]` on the alert event name, and the
 * route relays NWS alerts with a lowercase `event` property — pinning the
 * property name here, because a capitalised read silently matches nothing and
 * paints every polygon the amber fallback.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { addWarnings } from "../layers/warnings";
import { createLayerHandle, type LayerHandle } from "../layers/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What the stub records per added source/layer, keyed by MapLibre id. */
interface AddedEntries {
  added: Record<string, { id: string; layer?: Record<string, unknown> }>;
  getSource(): undefined;
  getLayer(): boolean;
  addSource(id: string): void;
  addLayer(layer: Record<string, unknown>): void;
}

/** Map stub that records added sources/layers so paint expressions are readable. */
function mapStub(): AddedEntries {
  const added: AddedEntries["added"] = {};
  return {
    added,
    getSource: () => undefined,
    getLayer: () => false,
    addSource: (id) => {
      added[id] = { id };
    },
    addLayer: (layer) => {
      const id = layer.id;
      if (typeof id === "string") added[id] = { id, layer };
    },
  };
}

/** The paint block of a recorded layer spec, or an empty one when absent. */
function paintOf(layer: Record<string, unknown> | undefined): Record<string, unknown> {
  const paint: unknown = layer?.paint;
  return typeof paint === "object" && paint !== null ? (paint as Record<string, unknown>) : {};
}

/** Drain the add's microtasks and clear the refresh interval it registered. */
async function settle(handle: LayerHandle): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  handle.intervals.forEach(clearInterval);
  handle.intervals = [];
}

describe("addWarnings paint contract", () => {
  it("colours both layers by the lowercase `event` property the route emits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 })),
    );
    const handle = createLayerHandle();
    const map = mapStub();

    addWarnings(map as unknown as maplibregl.Map, handle);
    await settle(handle);

    // A missing entry fails loudly here on purpose: the layer must have been
    // added for the paint contract to mean anything.
    const fillPaint = paintOf(map.added["warnings-fill"].layer);
    const linePaint = paintOf(map.added["warnings-outline"].layer);
    expect(fillPaint["fill-color"]).toEqual(
      expect.arrayContaining(["match", ["downcase", ["get", "event"]]]),
    );
    expect(linePaint["line-color"]).toEqual(
      expect.arrayContaining(["match", ["downcase", ["get", "event"]]]),
    );
  });
});
