/**
 * Unit tests for the shared hydrology opener.
 *
 * The route suites in src/app/api/__tests__/terrain-routes.test.ts exercise
 * openHydroGrid end-to-end through the HTTP surface; this file pins the
 * opener's own contract — the ok/message discrimination, the gate-before-
 * assemble ordering, and the verbatim defaults/clamps — in isolation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({
  startElevation: null as number | null,
  startElevationRejects: false,
  assembleCalls: 0,
}));

vi.mock("@/lib/terrain-grid", () => {
  return {
    TERRAIN_NODATA: -32768,
    resolveStartElevation: vi.fn(() =>
      storage.startElevationRejects
        ? Promise.reject(new Error("resolvers down"))
        : Promise.resolve(storage.startElevation),
    ),
    assembleTerrainGrid: vi.fn(() => {
      storage.assembleCalls++;
      return Promise.resolve({ dem: new Float32Array(9), rows: 3, cols: 3, cellSizeDeg: 1, cellSizeM: 2 });
    }),
  };
});

import { openHydroGrid } from "@/lib/hydro-params";

beforeEach(() => {
  storage.startElevation = 500;
  storage.startElevationRejects = false;
  storage.assembleCalls = 0;
});

describe("openHydroGrid", () => {
  it("rejects missing coordinates before any storage access", async () => {
    const res = await openHydroGrid({});
    expect(res).toMatchObject({ ok: false, message: "lat and lon are required" });
    expect(storage.assembleCalls).toBe(0);
  });

  it("rejects out-of-range coordinates before any storage access", async () => {
    const res = await openHydroGrid({ lat: 91, lon: 0 });
    expect(res).toMatchObject({ ok: false, message: "Invalid coordinates" });
    expect(storage.assembleCalls).toBe(0);
  });

  it("fails without assembling when the pour point has no elevation", async () => {
    storage.startElevation = null;
    const res = await openHydroGrid({ lat: 40.7, lon: -74.0 });
    expect(res).toMatchObject({ ok: false, message: "No elevation data at starting point" });
    expect(storage.assembleCalls).toBe(0);
  });

  it("proceeds to assembly when the gate resolver throws (documented contract)", async () => {
    storage.startElevationRejects = true;
    const res = await openHydroGrid({ lat: 40.7, lon: -74.0 });
    expect(res.ok).toBe(true);
    expect(storage.assembleCalls).toBe(1);
  });

  it("returns the assembled grid with the parsed fields on success", async () => {
    const res = await openHydroGrid({ lat: 40.7, lon: -74.0 });
    if (!res.ok) throw new Error("expected ok");
    expect(res.lat).toBe(40.7);
    expect(res.lon).toBe(-74.0);
    expect(res.zoom).toBe(10); // verbatim route default
    expect(res.radius).toBe(100); // verbatim route default
    expect(res.threshold).toBeUndefined();
    expect(res.grid.rows).toBe(3);
  });

  it("clamps radius_cells to [10, 200] exactly as the routes did", async () => {
    const low = await openHydroGrid({ lat: 0, lon: 0, radius_cells: 5 });
    const high = await openHydroGrid({ lat: 0, lon: 0, radius_cells: 500 });
    if (!low.ok || !high.ok) throw new Error("expected ok");
    expect(low.radius).toBe(10);
    expect(high.radius).toBe(200);
  });

  it("passes streams' threshold through raw", async () => {
    const res = await openHydroGrid({ lat: 0, lon: 0, threshold: 42 });
    if (!res.ok) throw new Error("expected ok");
    expect(res.threshold).toBe(42);
  });
});
