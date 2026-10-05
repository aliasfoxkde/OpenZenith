import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Flood Extent (NASA GIBS VIIRS Combined 3-Day Flood) ─── */

/**
 * Add the flood-extent raster: a 256px source at /api/floods-tile/{z}/{x}/{y}
 * (NASA GIBS VIIRS combined 3-day flood product — note the route id is
 * floods-tile, not floods, zooms 0-9) at 0.75 opacity. Guarded per
 * source/layer; reports "loaded"/"error" under the "floods" id.
 */
export function addFloods(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("floods")) return;

  try {
    if (!map.getSource("floods")) {
      map.addSource("floods", {
        type: "raster",
        tiles: ["/api/floods-tile/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("floods-raster")) {
      map.addLayer({
        id: "floods-raster",
        type: "raster",
        source: "floods",
        paint: {
          "raster-opacity": 0.75,
        },
      });
    }
    setStatus(handle, "floods", "loaded");
  } catch (err) {
    warnLayerError("floods", err);
    setStatus(handle, "floods", "error");
    }
}

/** Remove the floods raster layer and its `floods` source, ignoring "not found" errors. */
export function removeFloods(map: maplibregl.Map): void {
  try {
    map.removeLayer("floods-raster");
  } catch {}
  try {
    map.removeSource("floods");
  } catch {}
}
