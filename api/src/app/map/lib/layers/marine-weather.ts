import type { LayerHandle } from "./types";

/* ─── Marine Weather (Wave Height via Open-Meteo) ─── */

export function addMarineWeather(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("marineWeather")) return;

  // Marine weather is best shown as a raster tile layer from Open-Meteo
  // Using their marine API tile endpoint
  const tileUrl =
    "https://tiles.open-meteo.com/v1/marine/precipitation/{z}/{x}/{y}.png";

  try {
    if (!map.getSource("marineWeather")) {
      map.addSource("marineWeather", {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 10,
        attribution: "Open-Meteo Marine",
      });
    }

    if (!map.getLayer("marineWeather-raster")) {
      map.addLayer({
        id: "marineWeather-raster",
        type: "raster",
        source: "marineWeather",
        paint: {
          "raster-opacity": 0.6,
          "raster-saturation": 0.3,
        },
      });
    }
  } catch {
    /* source/layer may already exist */
  }
}

export function removeMarineWeather(map: maplibregl.Map): void {
  try { map.removeLayer("marineWeather-raster"); } catch {}
  try { map.removeSource("marineWeather"); } catch {}
}
