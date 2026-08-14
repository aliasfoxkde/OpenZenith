import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Buildings (OpenStreetMap via Overpass API) ─── */

// Overture Maps Foundation discontinued their free tile endpoint.
// Using OpenStreetMap building footprints via the built-in Overpass proxy.
// Buildings are loaded on-demand when the user zooms in (z12+).

let currentBounds: string | null = null;

export function addBuildings(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("buildings")) return;

  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  try {
    if (!map.getSource("buildings")) {
      map.addSource("buildings", { type: "geojson", data: empty });
    }

    if (!map.getLayer("buildings-fill")) {
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: {
          "fill-color": "#d4c5a9",
          "fill-opacity": 0.4,
        },
      });
    }

    if (!map.getLayer("buildings-outline")) {
      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        paint: {
          "line-color": "#a89070",
          "line-width": 0.5,
          "line-opacity": 0.6,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  const loadBuildings = async () => {
    try {
      const zoom = map.getZoom();
      if (zoom < 12) {
        setStatus(handle, "buildings", "empty", 0);
        return;
      }

      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const boundsKey = `${sw.lat.toFixed(2)},${sw.lng.toFixed(2)},${ne.lat.toFixed(2)},${ne.lng.toFixed(2)}`;

      // Skip if we already loaded this bounding box area
      if (currentBounds === boundsKey) return;
      currentBounds = boundsKey;

      setStatus(handle, "buildings", "loading");

      const query = encodeURIComponent(
        `[out:json][timeout:10];way["building"](${sw.lat},${sw.lng},${ne.lat},${ne.lng});out geom;`,
      );

      const res = await fetch(`/api/overpass?query=${query}`, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        setStatus(handle, "buildings", "empty");
        return;
      }

      const data = await res.json();
      const features: GeoJSON.Feature[] = [];

      if (data.elements) {
        for (const el of data.elements) {
          if (el.type !== "way" || !el.geometry) continue;

          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [el.geometry.map((n: { lat: number; lon: number }) => [n.lon, n.lat])],
            },
            properties: {
              id: el.id,
              building: el.tags?.building || "yes",
              name: el.tags?.name || "",
              height: el.tags?.height || null,
              levels: el.tags?.["building:levels"] || null,
            },
          });
        }
      }

      setStatus(handle, "buildings", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
        if (!map.getSource("buildings")) {
          map.addSource("buildings", { type: "geojson", data: geojson });
        } else {
          (map.getSource("buildings") as any)?.setData(geojson);
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "buildings", "error");
    }
  };

  // Load on zoom/pan when zoom >= 12
  map.on("moveend", loadBuildings);
  loadBuildings();

  // Cleanup: remove the moveend listener
  const origCleanup = handle.cleanup;
  handle.cleanup = () => {
    map.off("moveend", loadBuildings);
    origCleanup?.();
  };
}

export function removeBuildings(map: maplibregl.Map): void {
  ["buildings-outline", "buildings-fill"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("buildings");
  } catch {}
  currentBounds = null;
}
