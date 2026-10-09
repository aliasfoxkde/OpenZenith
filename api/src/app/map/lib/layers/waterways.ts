import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Waterways ─── */

/**
 * Body of /api/waterways — a GeoJSON FeatureCollection whose `features` may be
 * absent when the route returns an error payload.
 */
type WaterwaysResponse = { features?: GeoJSON.Feature[] } | null;

/**
 * The layer's query radius in kilometres, translated to a bbox because
 * /api/waterways takes `bbox=minLon,minLat,maxLon,maxLat` (capped at 10° per
 * axis), not lat/lon/radius — the old query shape 400'd on every request and
 * the layer could never draw.
 */
const RADIUS_KM = 50;
const KM_PER_DEG_LAT = 111.32;

/**
 * Build the route's bbox parameter around a centre point. Latitude extent is
 * RADIUS_KM converted to degrees; longitude is widened by 1/cos(lat) so the
 * box stays roughly circular. The cos floor guards the poles, where the
 * widening would otherwise blow the box up to the route's 10° cap.
 */
export function waterwaysBbox(lat: number, lon: number): string {
  const latHalf = RADIUS_KM / KM_PER_DEG_LAT;
  const lonHalf = latHalf / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
  return [lon - lonHalf, lat - latHalf, lon + lonHalf, lat + latHalf].map((v) => v.toFixed(4)).join(",");
}

/**
 * Add the waterways layer: OpenStreetMap water features around the current
 * map centre, fetched from /api/waterways as a 50 km bbox and rendered as
 * 1.5px sky-blue lines at 0.6 opacity. The query re-runs every 30 seconds
 * against wherever the map is centred, updating the existing GeoJSON source
 * in place. Status is reported on the handle: "loaded"/"empty" with the
 * feature count on success, "error" when the route fails or answers with its
 * error body.
 */
export function addWaterways(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("waterways")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/waterways?bbox=${waterwaysBbox(center.lat, center.lng)}`);
      const data = (await res.json()) as WaterwaysResponse;
      if (!res.ok || !data?.features) {
        setStatus(handle, "waterways", "error");
        return;
      }
      setStatus(handle, "waterways", data.features.length ? "loaded" : "empty", data.features.length);

      try {
        if (!map.getSource("waterways")) {
          map.addSource("waterways", { type: "geojson", data });
        } else {
          map.getSource("waterways")?.setData(data);
        }

        if (!map.getLayer("waterways-line")) {
          map.addLayer({
            id: "waterways-line",
            type: "line",
            source: "waterways",
            paint: {
              "line-color": "#38bdf8",
              "line-width": 1.5,
              "line-opacity": 0.6,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("waterways", err);
      setStatus(handle, "waterways", "error");
    }
  };

  void doLoad();
  // Re-fetch on pan (debounced via interval)
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 30000),
  );
}

/** Remove the waterways line layer and the `waterways` source, ignoring "not found" errors. */
export function removeWaterways(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "waterways-line");
  removeSourceIfPresent(map, "waterways");
}
