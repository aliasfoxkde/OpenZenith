import type { LayerHandle } from "./types";

/* ─── Night Lights (NASA Black Marble) ─── */

export function addNightLights(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("nightLights")) return;

  // NASA Black Marble tiles via Earth Observatory (free, no key)
  const tileUrl =
    "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/BlackMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

  try {
    if (!map.getSource("nightLights")) {
      map.addSource("nightLights", {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 8,
        attribution: "NASA Black Marble",
      });
    }

    if (!map.getLayer("nightLights-raster")) {
      map.addLayer({
        id: "nightLights-raster",
        type: "raster",
        source: "nightLights",
        paint: {
          "raster-opacity": 0.85,
          "raster-brightness-max": 1.2,
        },
      });
    }
  } catch {
    /* source/layer may already exist */
  }
}

export function removeNightLights(map: maplibregl.Map): void {
  try {
    map.removeLayer("nightLights-raster");
  } catch {}
  try {
    map.removeSource("nightLights");
  } catch {}
}
