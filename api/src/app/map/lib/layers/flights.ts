import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Flights (ADS-B) ─── */

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
      const data = await res.json();
      const states = data?.states || [];

      if (!states.length) {
        setStatus(handle, "flights", data?.error ? "error" : "empty", 0);
        return;
      }

      const features: GeoJSON.Feature[] = states
        .filter((s: Record<string, unknown>) => s.latitude != null && s.longitude != null)
        .map((s: Record<string, unknown>) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [s.longitude as number, s.latitude as number],
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
        map.getSource("flights")?.setData?.({ type: "FeatureCollection", features });
      }
      setStatus(handle, "flights", "loaded", features.length);
    } catch {
      setStatus(handle, "flights", "error");
    }
  };

  // Load immediately, then refresh on pan/zoom
  loadFlights();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  const onMoveEnd = () => {
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(loadFlights, 5000); // 5s debounce
  };
  map.on("moveend", onMoveEnd);
  handle.cleanup = () => {
    map.off("moveend", onMoveEnd);
    if (moveTimeout) clearTimeout(moveTimeout);
  };
  // Also refresh periodically (slower, 2 min)
  handle.intervals.push(setInterval(loadFlights, 120000));
}

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
