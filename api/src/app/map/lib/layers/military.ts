import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Military ADS-B (ADSB Exchange) ─── */

export function addMilitary(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("military")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/military");
      const data = await res.json();
      const ac = data?.ac || [];
      setStatus(handle, "militaryFlights", ac.length ? "loaded" : "empty", ac.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: ac
            .filter((a: Record<string, unknown>) => a.lat && a.lon)
            .map((a: Record<string, unknown>) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [Number(a.lon), Number(a.lat)] },
              properties: {
                type: a.type || "unknown",
                callsign: a.call || a.flight || "",
                alt: a.alt_baro ?? a.alt_geom ?? 0,
                speed: a.gs ?? 0,
                heading: a.track ?? 0,
                military: a.mil ?? false,
              },
            })),
        };

        if (!map.getSource("military")) {
          map.addSource("military", { type: "geojson", data: geojson });
        } else {
          map.getSource("military")?.setData(geojson);
        }

        if (!map.getLayer("military-points")) {
          map.addLayer({
            id: "military-points",
            type: "circle",
            source: "military",
            paint: {
              "circle-radius": 4,
              "circle-color": "#a855f7",
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(168,85,247,0.3)",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "militaryFlights", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 120000));
}

export function removeMilitary(map: maplibregl.Map): void {
  ["military-points"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("military");
  } catch {}
}
