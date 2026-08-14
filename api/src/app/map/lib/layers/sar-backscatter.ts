import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── SAR Backscatter (OPERA L2 RTC Sentinel-1) ─── */

export function addSarBackscatter(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sar-backscatter")) return;

  try {
    if (!map.getSource("sar-backscatter")) {
      map.addSource("sar-backscatter", {
        type: "raster",
        tiles: ["/api/sar-backscatter/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 1,
        maxzoom: 10,
      });
    }
    if (!map.getLayer("sar-backscatter-raster")) {
      map.addLayer({
        id: "sar-backscatter-raster",
        type: "raster",
        source: "sar-backscatter",
        paint: {
          "raster-opacity": 0.85,
        },
      });
    }
    setStatus(handle, "sarBackscatter", "loaded");
  } catch {
    setStatus(handle, "sarBackscatter", "error");
  }
}

export function removeSarBackscatter(map: maplibregl.Map): void {
  try {
    map.removeLayer("sar-backscatter-raster");
  } catch {}
  try {
    map.removeSource("sar-backscatter");
  } catch {}
}
