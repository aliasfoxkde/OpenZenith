import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Flights (ADS-B) ─── */

/**
 * Slimmed OpenSky state vector as relayed by /api/flights (see `slimState`
 * in src/app/api/flights/route.ts). Fields OpenSky omits come through as
 * `null`.
 */
interface FlightState {
  icao24?: string;
  callsign?: string | null;
  origin_country?: string;
  longitude?: number | null;
  latitude?: number | null;
  baro_altitude?: number | null;
  on_ground?: boolean | null;
  velocity?: number | null;
}

/** Payload served by /api/flights — `error` accompanies a failure fallback. */
interface FlightsResponse {
  states?: FlightState[];
  error?: string;
}

/**
 * Add the civil-aviation layer: OpenSky state vectors for the current map
 * viewport, requested from /api/flights with the visible bounds as a bbox.
 * States without a position are dropped; the rest become cyan 3px circles
 * under a soft glow, with ICAO24, callsign, origin country, velocity (m/s),
 * barometric altitude (m) and on_ground carried as properties. Refreshes on
 * moveend with a 5-second debounce plus a 2-minute interval, and marks the
 * handle "error" when the route reports a fallback error, "empty" when the
 * bbox simply has no traffic.
 */
export function addFlights(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("flights")) return;
  setStatus(handle, "flights", "loading");

  map.addSource("flights", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Circle layer for aircraft positions
  map.addLayer({
    id: "flights-circles",
    type: "circle",
    source: "flights",
    paint: {
      "circle-radius": 3,
      "circle-color": "#00e5ff",
      "circle-opacity": 0.8,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(0,229,255,0.3)",
    },
  });

  // Glow layer
  map.addLayer({
    id: "flights-glow",
    type: "circle",
    source: "flights",
    paint: {
      "circle-radius": 8,
      "circle-color": "rgba(0,229,255,0.15)",
      "circle-blur": 1,
    },
  });

  const loadFlights = async () => {
    try {
      if (!map.getSource("flights")) return;
      const bounds = map.getBounds();
      const url = `/api/flights?lamin=${bounds.getSouthWest().lat.toFixed(2)}&lamax=${bounds.getNorthEast().lat.toFixed(2)}&lomin=${bounds.getSouthWest().lng.toFixed(2)}&lomax=${bounds.getNorthEast().lng.toFixed(2)}`;
      const res = await fetch(url);
      const data = (await res.json()) as FlightsResponse | null;
      const states = data?.states || [];

      if (!states.length) {
        setStatus(handle, "flights", data?.error ? "error" : "empty", 0);
        return;
      }

      const features: GeoJSON.Feature[] = states
        .filter(
          (s: FlightState): s is FlightState & { latitude: number; longitude: number } =>
            s.latitude != null && s.longitude != null,
        )
        .map((s) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [s.longitude, s.latitude],
          },
          properties: {
            icao24: s.icao24,
            callsign: s.callsign,
            origin_country: s.origin_country,
            velocity: s.velocity,
            baro_altitude: s.baro_altitude,
            on_ground: s.on_ground,
          },
        }));

      if (map.getSource("flights")) {
        map.getSource("flights")?.setData({ type: "FeatureCollection", features });
      }
      setStatus(handle, "flights", "loaded", features.length);
    } catch (err) {
      warnLayerError("flights", err);
      setStatus(handle, "flights", "error");
      }
  };

  // Load immediately, then refresh on pan/zoom
  void loadFlights();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  const onMoveEnd = () => {
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      void loadFlights();
    }, 5000); // 5s debounce
  };
  map.on("moveend", onMoveEnd);
  handle.cleanup = () => {
    map.off("moveend", onMoveEnd);
    if (moveTimeout) clearTimeout(moveTimeout);
  };
  // Also refresh periodically (slower, 2 min)
  handle.intervals.push(
    setInterval(() => {
      void loadFlights();
    }, 120000),
  );
}

/** Remove the flight glow and circle layers plus the `flights` source, ignoring "not found" errors. */
export function removeFlights(map: maplibregl.Map): void {
  try {
    map.removeLayer("flights-glow");
  } catch {}
  try {
    map.removeLayer("flights-circles");
  } catch {}
  try {
    map.removeSource("flights");
  } catch {}
}
