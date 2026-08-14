import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Precipitation (IMERG) ─── */

export function addPrecipitation(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("precipitation")) return;

  try {
    if (!map.getSource("precipitation")) {
      map.addSource("precipitation", {
        type: "raster",
        tiles: ["/api/precipitation/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 8,
      });
    }
    if (!map.getLayer("precipitation-raster")) {
      map.addLayer({
        id: "precipitation-raster",
        type: "raster",
        source: "precipitation",
        paint: { "raster-opacity": 0.8 },
      });
    }
    setStatus(handle, "precipitation", "loaded");
  } catch {
    setStatus(handle, "precipitation", "error");
  }
}

export function removePrecipitation(map: maplibregl.Map): void {
  try {
    map.removeLayer("precipitation-raster");
  } catch {}
  try {
    map.removeSource("precipitation");
  } catch {}
}
