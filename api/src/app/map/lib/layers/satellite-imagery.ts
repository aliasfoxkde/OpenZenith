import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── GOES Satellite Imagery ─── */

// Uses NASA GIBS MODIS Terra True Color tiles.
// These are freely available raster tiles with CORS enabled.
// We compute a recent date at module load time.

function getRecentGibsDate(): string {
  // GIBS needs a specific date — MODIS Terra has ~2 day processing delay.
  // Use 3 days ago to ensure imagery is always available.
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

const GIBS_DATE = getRecentGibsDate();

export function addSatelliteImagery(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("satellite")) return;

  try {
    if (!map.getSource("satellite")) {
      // NASA GIBS MODIS Terra True Color (daily, global coverage)
      map.addSource("satellite", {
        type: "raster",
        tiles: [
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
        attribution: "© NASA GIBS / MODIS Terra",
      });
    }

    if (!map.getLayer("satellite")) {
      map.addLayer({
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: {
          "raster-opacity": 0.8,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  setStatus(handle, "satellite", "loaded");
}

export function removeSatelliteImagery(map: maplibregl.Map): void {
  try { map.removeLayer("satellite"); } catch {}
  try { map.removeSource("satellite"); } catch {}
}
