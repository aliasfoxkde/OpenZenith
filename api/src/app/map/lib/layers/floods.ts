import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Flood Extent (NASA GIBS VIIRS Combined 3-Day Flood) ─── */

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
  } catch {
    setStatus(handle, "floods", "error");
  }
}

export function removeFloods(map: maplibregl.Map): void {
  try { map.removeLayer("floods-raster"); } catch {}
  try { map.removeSource("floods"); } catch {}
}
