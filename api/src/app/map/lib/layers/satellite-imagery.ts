import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus } from "./types";

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

/**
 * Add the daily true-colour satellite basemap: NASA GIBS MODIS Terra
 * CorrectedReflectance_TrueColor WMTS tiles (zooms 0-9, JPEG, attribution on
 * the source). The date is pinned once at module load to three days ago —
 * MODIS Terra needs ~2 days of processing lag — so the imagery always
 * resolves; a long-lived page therefore keeps showing that same day. Marks
 * the handle "satellite" loaded unconditionally, whether or not the tiles
 * actually render.
 */
export function addSatelliteImagery(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("satellite-imagery")) return;

  try {
    if (!map.getSource("satellite-imagery")) {
      // NASA GIBS MODIS Terra True Color (daily, global coverage)
      map.addSource("satellite-imagery", {
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

    if (!map.getLayer("satellite-imagery")) {
      map.addLayer({
        id: "satellite-imagery",
        type: "raster",
        source: "satellite-imagery",
        paint: {
          "raster-opacity": 0.85,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  setStatus(handle, "satellite", "loaded");
}

/** Remove the satellite-imagery raster layer and its source, ignoring "not found" errors. */
export function removeSatelliteImagery(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "satellite-imagery");
  removeSourceIfPresent(map, "satellite-imagery");
}
