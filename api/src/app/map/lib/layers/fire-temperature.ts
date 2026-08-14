import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Fire Temperature (GOES-East ABI Fire Temperature) ─── */

export function addFireTemperature(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("fire-temperature")) return;

  try {
    if (!map.getSource("fire-temperature")) {
      map.addSource("fire-temperature", {
        type: "raster",
        tiles: ["/api/fire-temperature/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 1,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("fire-temperature-raster")) {
      map.addLayer({
        id: "fire-temperature-raster",
        type: "raster",
        source: "fire-temperature",
        paint: {
          "raster-opacity": 0.8,
        },
      });
    }
    setStatus(handle, "fireTemperature", "loaded");
  } catch {
    setStatus(handle, "fireTemperature", "error");
  }
}

export function removeFireTemperature(map: maplibregl.Map): void {
  try {
    map.removeLayer("fire-temperature-raster");
  } catch {}
  try {
    map.removeSource("fire-temperature");
  } catch {}
}
