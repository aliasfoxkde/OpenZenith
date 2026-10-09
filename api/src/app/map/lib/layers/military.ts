import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Military ADS-B (ADSB Exchange) ─── */

/**
 * ADSB Exchange v2 aircraft record. `/api/military` relays the `ac` array
 * verbatim, so every field is treated as possibly absent.
 */
interface MilitaryAircraft {
  lat?: number;
  lon?: number;
  type?: string;
  call?: string;
  flight?: string;
  /** `alt_baro` is the literal string "ground" for aircraft on the deck. */
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  mil?: boolean;
}

/** Payload served by /api/military. */
interface MilitaryResponse {
  ac?: MilitaryAircraft[];
}

/**
 * Add the military-traffic layer: ADSB Exchange records relayed by
 * /api/military, filtered to aircraft with a known position and rendered as
 * 4px purple circles. Feature properties keep the callsign, barometric (or
 * geometric) altitude in feet, ground speed in knots, track in degrees and
 * the `mil` flag. Reports "loaded"/"empty" with the aircraft count and
 * re-polls every 2 minutes — the fastest cadence in this directory, since
 * the underlying positions move quickly. A non-ok response or thrown fetch
 * reports "error".
 */
export function addMilitary(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("military")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/military");
      if (!res.ok) {
        setStatus(handle, "militaryFlights", "error");
        return;
      }
      const data = (await res.json()) as MilitaryResponse | null;
      const ac = data?.ac || [];
      setStatus(handle, "militaryFlights", ac.length ? "loaded" : "empty", ac.length);

      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: ac
            // Same truthiness test as before; Boolean() only satisfies the
            // predicate's boolean return type.
            .filter((a: MilitaryAircraft): a is MilitaryAircraft & { lat: number; lon: number } =>
              Boolean(a.lat && a.lon),
            )
            .map((a) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
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
    } catch (err) {
      warnLayerError("militaryFlights", err);
      setStatus(handle, "militaryFlights", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 120000), // 2 min
  );
}

/** Remove the military-traffic circle layer and the `military` source, ignoring "not found" errors. */
export function removeMilitary(map: maplibregl.Map): void {
  ["military-points"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "military");
}
