/**
 * Tests for the per-layer op queue in layers/index.ts. add/remove both start
 * with a dynamic import, so without serialization a quick toggle-off could
 * run the module's remove() before the pending add's mutations — console
 * noise at best, a ghost layer at worst. These tests pin the queue's order
 * and supersession contract with mocked layer modules (no MapLibre).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLayerHandle } from "../layers/types";
import { addDataLayer, removeDataLayer } from "../layers/index";
import { addHillshade, removeHillshade } from "../layers/hillshade";

vi.mock("../layers/hillshade", () => ({
  addHillshade: vi.fn(),
  removeHillshade: vi.fn(),
}));

// The dispatcher only calls existence checks and mutations on this object.
const mapStub = {
  getLayer: () => false,
  getSource: () => false,
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
} as unknown as maplibregl.Map;

beforeEach(() => {
  vi.mocked(addHillshade).mockClear();
  vi.mocked(removeHillshade).mockClear();
});

describe("layer op queue", () => {
  it("drops a pending add entirely when a remove is scheduled after it (net: off)", async () => {
    const handle = createLayerHandle();
    const add = addDataLayer(mapStub, handle, "hillshade");
    const remove = removeDataLayer(mapStub, handle, "hillshade");
    await Promise.all([add, remove]);
    // The superseded add never mutates the map; only the remove ran.
    expect(addHillshade).not.toHaveBeenCalled();
    expect(removeHillshade).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest op under rapid toggling (add, remove, add)", async () => {
    const handle = createLayerHandle();
    await Promise.all([
      addDataLayer(mapStub, handle, "hillshade"),
      removeDataLayer(mapStub, handle, "hillshade"),
      addDataLayer(mapStub, handle, "hillshade"),
    ]);
    expect(addHillshade).toHaveBeenCalledTimes(1);
    expect(removeHillshade).not.toHaveBeenCalled();
  });

  it("drops a pending remove when a re-add is scheduled after it (net: on)", async () => {
    const handle = createLayerHandle();
    const remove = removeDataLayer(mapStub, handle, "hillshade");
    const add = addDataLayer(mapStub, handle, "hillshade");
    await Promise.all([remove, add]);
    expect(removeHillshade).not.toHaveBeenCalled();
    expect(addHillshade).toHaveBeenCalledTimes(1);
  });

  it("still runs a remove for a layer that was never added", async () => {
    const handle = createLayerHandle();
    await removeDataLayer(mapStub, handle, "hillshade");
    expect(removeHillshade).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for unknown layer ids", async () => {
    const handle = createLayerHandle();
    await expect(addDataLayer(mapStub, handle, "not-a-layer")).resolves.toBeUndefined();
    await expect(removeDataLayer(mapStub, handle, "not-a-layer")).resolves.toBeUndefined();
    expect(addHillshade).not.toHaveBeenCalled();
    expect(removeHillshade).not.toHaveBeenCalled();
  });
});
