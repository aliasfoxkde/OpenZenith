import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Aviation Weather (SIGMETs / AIRMETs) ─── */

export function addAviationWeather(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("aviationWeather")) return;

  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  try {
    if (!map.getSource("aviationWeather")) {
      map.addSource("aviationWeather", { type: "geojson", data: empty });
    }

    // SIGMET polygons — red fill
    if (!map.getLayer("sigmet-fill")) {
      map.addLayer({
        id: "sigmet-fill",
        type: "fill",
        source: "aviationWeather",
        filter: ["==", ["get", "type"], "SIGMET"],
        paint: {
          "fill-color": "rgba(239, 68, 68, 0.12)",
          "fill-opacity": 0.6,
        },
      });
    }
    if (!map.getLayer("sigmet-outline")) {
      map.addLayer({
        id: "sigmet-outline",
        type: "line",
        source: "aviationWeather",
        filter: ["==", ["get", "type"], "SIGMET"],
        paint: {
          "line-color": "#ef4444",
          "line-width": 2,
          "line-dasharray": [4, 2],
        },
      });
    }

    // AIRMET polygons — amber fill
    if (!map.getLayer("airmet-fill")) {
      map.addLayer({
        id: "airmet-fill",
        type: "fill",
        source: "aviationWeather",
        filter: ["==", ["get", "type"], "AIRMET"],
        paint: {
          "fill-color": "rgba(245, 158, 11, 0.12)",
          "fill-opacity": 0.6,
        },
      });
    }
    if (!map.getLayer("airmet-outline")) {
      map.addLayer({
        id: "airmet-outline",
        type: "line",
        source: "aviationWeather",
        filter: ["==", ["get", "type"], "AIRMET"],
        paint: {
          "line-color": "#f59e0b",
          "line-width": 1.5,
          "line-dasharray": [3, 3],
        },
      });
    }

    // Labels
    if (!map.getLayer("aviationWeather-labels")) {
      map.addLayer({
        id: "aviationWeather-labels",
        type: "symbol",
        source: "aviationWeather",
        layout: {
          "text-field": ["coalesce", ["get", "hazard"], ["get", "type"], ""],
          "text-size": 10,
          "text-max-width": 10,
        },
        paint: {
          "text-color": "#ef4444",
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 2,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  const doLoad = async () => {
    try {
      setStatus(handle, "aviationWeather", "loading");
      const features: GeoJSON.Feature[] = [];

      // Fetch SIGMETs
      try {
        const sigRes = await fetch("/api/proxy/https://aviationweather.gov/api/data/sigmet?format=json");
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          if (Array.isArray(sigData)) {
            for (const s of sigData) {
              const geom = parseAviationGeometry(s);
              if (geom) {
                features.push({
                  type: "Feature",
                  geometry: geom,
                  properties: {
                    type: "SIGMET",
                    hazard: s.hazard || s.hazardType || "SIGMET",
                    severity: s.severity || "",
                    rawTime: s.start_time || s.validTimeFrom || "",
                  },
                });
              }
            }
          }
        }
      } catch {}

      // Fetch AIRMETs
      try {
        const airRes = await fetch("/api/proxy/https://aviationweather.gov/api/data/airmet?format=json");
        if (airRes.ok) {
          const airData = await airRes.json();
          if (Array.isArray(airData)) {
            for (const a of airData) {
              const geom = parseAviationGeometry(a);
              if (geom) {
                features.push({
                  type: "Feature",
                  geometry: geom,
                  properties: {
                    type: "AIRMET",
                    hazard: a.hazard || a.hazardType || "AIRMET",
                    severity: a.severity || "",
                    rawTime: a.start_time || a.validTimeFrom || "",
                  },
                });
              }
            }
          }
        }
      } catch {}

      if (!map.getSource) return;

      if (features.length === 0) {
        setStatus(handle, "aviationWeather", "empty");
        return;
      }

      try {
        if (!map.getSource("aviationWeather")) {
          map.addSource("aviationWeather", { type: "geojson", data: { type: "FeatureCollection", features } });
        } else {
          (map.getSource("aviationWeather") as any).setData({ type: "FeatureCollection", features });
        }
        setStatus(handle, "aviationWeather", "loaded", features.length);
      } catch {}
    } catch {
      setStatus(handle, "aviationWeather", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000)); // 5 min refresh
}

export function removeAviationWeather(map: maplibregl.Map): void {
  ["aviationWeather-labels", "airmet-outline", "airmet-fill", "sigmet-outline", "sigmet-fill"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("aviationWeather"); } catch {}
}

/* ─── Helpers ─── */

/** Parse aviation weather geometry from various NOAA formats */
function parseAviationGeometry(entry: Record<string, unknown>): GeoJSON.Geometry | null {
  // Try coordinates array: [[lon,lat], [lon,lat], ...]
  const coords = entry.coordinates || entry.area || (entry.geometry as Record<string, unknown>)?.coordinates;
  if (Array.isArray(coords) && coords.length >= 3) {
    const ring: [number, number][] = [];
    for (const c of coords) {
      if (Array.isArray(c) && c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
        ring.push([c[0], c[1]]);
      }
    }
    if (ring.length >= 3) {
      ring.push(ring[0]); // close the ring
      return { type: "Polygon", coordinates: [ring] };
    }
  }

  // Try polygon vertices
  const verts = entry.vertices || entry.points;
  if (Array.isArray(verts) && verts.length >= 3) {
    const ring: [number, number][] = [];
    for (const v of verts) {
      if (Array.isArray(v) && v.length >= 2) {
        ring.push([v[0], v[1]]);
      } else if (typeof v === "object" && v !== null) {
        const lon = (v as Record<string, number>).lon ?? (v as Record<string, number>).lng ?? 0;
        const lat = (v as Record<string, number>).lat ?? 0;
        ring.push([lon, lat]);
      }
    }
    if (ring.length >= 3) {
      ring.push(ring[0]);
      return { type: "Polygon", coordinates: [ring] };
    }
  }

  // Try raw GeoJSON geometry
  const geom = entry.geometry;
  if (geom && typeof geom === "object" && (geom as Record<string, unknown>).type) {
    return geom as GeoJSON.Geometry;
  }

  return null;
}
