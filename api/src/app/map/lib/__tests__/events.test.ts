/**
 * Tests for the natural-events layer's source-data contract. EONET carries
 * the category only as `categories: [{id, title}]`, while the paint expression
 * matches a scalar — the layer must flatten it onto `category` (the machine id
 * the colour match keys on) and `categoryLabel` (the display title) at
 * source-build time, or every event paints the amber fallback.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { addNaturalEvents } from "../layers/events";
import { createLayerHandle, type LayerHandle } from "../layers/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Map stub recording the data handed to the layer's GeoJSON source. */
function mapStub() {
  const sourceData: Array<Record<string, unknown>> = [];
  return {
    sourceData,
    getSource: () => undefined,
    getLayer: () => false,
    addSource: (_id: string, source: Record<string, unknown>) => {
      sourceData.push(source);
    },
    addLayer: vi.fn(),
  } as unknown as maplibregl.Map & { sourceData: Array<Record<string, unknown>> };
}

/** Drain the add's microtasks and clear the refresh interval it registered. */
async function settle(handle: LayerHandle): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  handle.intervals.forEach(clearInterval);
  handle.intervals = [];
}

function eonetFeature(categories: unknown): unknown {
  return {
    type: "Feature",
    properties: { title: "Kilauea", categories },
    geometry: { type: "Point", coordinates: [-155.3, 19.4] },
  };
}

describe("addNaturalEvents source data", () => {
  it("flattens the first category onto `category` (id) and `categoryLabel` (title)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            features: [eonetFeature([{ id: "severeStorms", title: "Severe Storms" }])],
          }),
          { status: 200 },
        ),
      ),
    );
    const handle = createLayerHandle();
    const map = mapStub();

    addNaturalEvents(map, handle);
    await settle(handle);

    const data = map.sourceData[0]?.data as { features: Array<{ properties: Record<string, unknown> }> };
    expect(data.features[0]?.properties.category).toBe("severeStorms");
    expect(data.features[0]?.properties.categoryLabel).toBe("Severe Storms");
  });

  it("falls back to 'Event' when the feed omits the categories array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [eonetFeature(undefined)] }), { status: 200 })),
    );
    const handle = createLayerHandle();
    const map = mapStub();

    addNaturalEvents(map, handle);
    await settle(handle);

    const data = map.sourceData[0]?.data as { features: Array<{ properties: Record<string, unknown> }> };
    expect(data.features[0]?.properties.category).toBe("Event");
    expect(data.features[0]?.properties.categoryLabel).toBe("Event");
  });
});
