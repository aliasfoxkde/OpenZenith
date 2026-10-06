/**
 * Tests for the waterways layer client. The layer's query previously used a
 * lat/lon/radius shape the route never accepted — every fetch 400'd and the
 * payload was silently dropped, so the layer could never draw and the row
 * never reported status. These pin the bbox contract and the status
 * reporting (loaded/empty with count, error on non-ok and on error bodies).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { addWaterways, waterwaysBbox } from "../layers/waterways";
import { createLayerHandle, type LayerHandle, type LayerStatus } from "../layers/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Map stub: records added sources/layers, fixed centre, configurable source existence. */
function mapStub(sourceExists = false) {
  return {
    getSource: () => sourceExists,
    getLayer: () => false,
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getCenter: () => ({ lat: 40.7, lng: -74.0 }),
  } as unknown as maplibregl.Map;
}

/** Handle that records status transitions; also drains the layer's interval. */
function handleSpy(): { handle: LayerHandle; calls: Array<[string, LayerStatus, number?]> } {
  const calls: Array<[string, LayerStatus, number?]> = [];
  const handle = createLayerHandle((layerId, status, count) => calls.push([layerId, status, count]));
  return { handle, calls };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("waterwaysBbox", () => {
  it("builds a 4-value bbox spanning ~50km around the centre", () => {
    const [minLon, minLat, maxLon, maxLat] = waterwaysBbox(40.7, -74.0).split(",").map(Number);
    expect(minLat).toBeCloseTo(40.7 - 50 / 111.32, 3);
    expect(maxLat).toBeCloseTo(40.7 + 50 / 111.32, 3);
    expect(minLon).toBeLessThan(-74);
    expect(maxLon).toBeGreaterThan(-74);
    // longitude widening at 40.7°N: half-extent / cos(lat)
    const lonHalf = (maxLon - minLon) / 2;
    expect(lonHalf).toBeCloseTo(50 / 111.32 / Math.cos((40.7 * Math.PI) / 180), 3);
  });

  it("widens longitude by the cos floor near the poles instead of dividing by ~0", () => {
    const [minLon, , maxLon] = waterwaysBbox(89, 0).split(",").map(Number);
    expect(maxLon - minLon).toBeCloseTo(2 * (50 / 111.32 / 0.1), 3);
  });
});

describe("addWaterways status reporting", () => {
  it("fetches the route's bbox contract and reports loaded with the feature count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: {} }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { handle, calls } = handleSpy();

    addWaterways(mapStub(), handle);
    await settle();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/^\/api\/waterways\?bbox=-74\.\d+,40\.\d+,-73\.\d+,41\.\d+$/);
    expect(calls).toContainEqual(["waterways", "loaded", 1]);
  });

  it("reports empty when the route answers with zero features", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ type: "FeatureCollection", features: [] })));
    const { handle, calls } = handleSpy();

    addWaterways(mapStub(), handle);
    await settle();

    expect(calls).toContainEqual(["waterways", "empty", 0]);
  });

  it("reports error on a non-ok response instead of dropping it silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}" , { status: 400 })));
    const { handle, calls } = handleSpy();

    addWaterways(mapStub(), handle);
    await settle();

    expect(calls).toContainEqual(["waterways", "error", undefined]);
  });

  it("reports error on the route's 200 error body (no features field)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ error: "Overpass API unavailable" })));
    const { handle, calls } = handleSpy();

    addWaterways(mapStub(), handle);
    await settle();

    expect(calls).toContainEqual(["waterways", "error", undefined]);
  });

  it("does nothing when the source already exists (toggle re-entry)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const map = mapStub(true);
    const { handle } = handleSpy();

    addWaterways(map, handle);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
