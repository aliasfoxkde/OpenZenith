/**
 * MapLibre data layer loaders for 2D map page.
 *
 * Each layer provides add/remove functions compatible with MapLibre GL's
 * source/layer API. Layers that fetch GeoJSON data from APIs include
 * auto-refresh via setInterval (returned for cleanup).
 */

import { SURVEILLANCE_THEME as T } from "@/lib/theme";

export interface LayerHandle {
  /** Interval IDs that need clearing on unmount / toggle-off. */
  intervals: ReturnType<typeof setInterval>[];
}

/* ─── Earthquakes ─── */

export function addEarthquakes(map: any, handle: LayerHandle): void {
  if (map.getSource("earthquakes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
      const data = await res.json();
      if (!map.getSource) return;

      try {
        if (!map.getSource("earthquakes")) {
          map.addSource("earthquakes", { type: "geojson", data });
        } else {
          (map.getSource("earthquakes") as any).setData(data);
        }

        // Circle layer — sized by magnitude
        if (!map.getLayer("earthquakes-circles")) {
          map.addLayer({
            id: "earthquakes-circles",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["get", "mag"],
                0, 3, 3, 6, 5, 10, 7, 16,
              ],
              "circle-color": [
                "interpolate", ["linear"], ["get", "mag"],
                0, "#22c55e", 3, "#eab308", 5, "#f97316", 7, "#ef4444",
              ],
              "circle-opacity": 0.7,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.2)",
            },
          });
        }

        // Glow layer underneath
        if (!map.getLayer("earthquakes-glow")) {
          map.addLayer({
            id: "earthquakes-glow",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["get", "mag"],
                0, 6, 3, 12, 5, 20, 7, 32,
              ],
              "circle-color": [
                "interpolate", ["linear"], ["get", "mag"],
                0, "rgba(34,197,94,0.15)", 3, "rgba(234,179,8,0.15)", 5, "rgba(249,115,22,0.15)", 7, "rgba(239,68,68,0.2)",
              ],
              "circle-blur": 1,
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 60000));
}

export function removeEarthquakes(map: any): void {
  ["earthquakes-glow", "earthquakes-circles"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("earthquakes"); } catch {}
}

/* ─── Weather Warnings ─── */

export function addWarnings(map: any, handle: LayerHandle): void {
  if (map.getSource("warnings")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/weather/warnings");
      const data = await res.json();
      if (!map.getSource || !data.features) return;

      try {
        if (!map.getSource("warnings")) {
          map.addSource("warnings", { type: "geojson", data });
        } else {
          (map.getSource("warnings") as any).setData(data);
        }

        // Fill layer
        if (!map.getLayer("warnings-fill")) {
          map.addLayer({
            id: "warnings-fill",
            type: "fill",
            source: "warnings",
            paint: {
              "fill-color": [
                "match", ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"], "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"], "#f97316",
                "#eab308",
              ],
              "fill-opacity": 0.15,
            },
          });
        }

        // Outline layer with dash
        if (!map.getLayer("warnings-outline")) {
          map.addLayer({
            id: "warnings-outline",
            type: "line",
            source: "warnings",
            paint: {
              "line-color": [
                "match", ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"], "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"], "#f97316",
                "#eab308",
              ],
              "line-width": 2,
              "line-opacity": 0.7,
              "line-dasharray": [2, 2],
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000));
}

export function removeWarnings(map: any): void {
  ["warnings-outline", "warnings-fill"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("warnings"); } catch {}
}

/* ─── Natural Events (NASA EONET) ─── */

export function addNaturalEvents(map: any, handle: LayerHandle): void {
  if (map.getSource("natural-events")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
      const data = await res.json();
      if (!map.getSource || !data.features) return;

      try {
        if (!map.getSource("natural-events")) {
          map.addSource("natural-events", { type: "geojson", data });
        } else {
          (map.getSource("natural-events") as any).setData(data);
        }

        if (!map.getLayer("natural-events-points")) {
          map.addLayer({
            id: "natural-events-points",
            type: "symbol",
            source: "natural-events",
            layout: {
              "icon-image": "marker-15",
              "icon-size": 0.8,
              "text-field": ["coalesce", ["get", "title"], ""],
              "text-font": ["Open Sans Regular"],
              "text-size": 10,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-max-width": 8,
            },
            paint: {
              "text-color": "#ef4444",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1.5,
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000));
}

export function removeNaturalEvents(map: any): void {
  try { map.removeLayer("natural-events-points"); } catch {}
  try { map.removeSource("natural-events"); } catch {}
}

/* ─── Weather Radar (RainViewer) ─── */

export function addRadar(map: any, handle: LayerHandle): void {
  if (map.getSource("radar")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const data = await res.json();
      const latest = data.radar?.past?.[data.radar.past.length - 1];
      if (!latest || !map.getSource) return;

      try {
        if (!map.getSource("radar")) {
          map.addSource("radar", {
            type: "raster",
            tiles: [`https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`],
            tileSize: 256,
          });
        }

        if (!map.getLayer("radar-layer")) {
          map.addLayer({
            id: "radar-layer",
            type: "raster",
            source: "radar",
            paint: { "raster-opacity": 0.5 },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeRadar(map: any): void {
  try { map.removeLayer("radar-layer"); } catch {}
  try { map.removeSource("radar"); } catch {}
}

/* ─── Waterways ─── */

export function addWaterways(map: any, handle: LayerHandle): void {
  // Waterways require a lat/lon center to query. Fetch from current map center.
  if (map.getSource("waterways")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/waterways?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&radius=50`);
      const data = await res.json();
      if (!map.getSource || !data?.features) return;

      try {
        if (!map.getSource("waterways")) {
          map.addSource("waterways", { type: "geojson", data });
        } else {
          (map.getSource("waterways") as any).setData(data);
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
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  // Re-fetch on pan (debounced via interval)
  handle.intervals.push(setInterval(doLoad, 30000));
}

export function removeWaterways(map: any): void {
  try { map.removeLayer("waterways-line"); } catch {}
  try { map.removeSource("waterways"); } catch {}
}

/* ─── Hurricane Tracks ─── */

export function addHurricaneTracks(map: any, handle: LayerHandle): void {
  if (map.getSource("hurricanes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv");
      const csv = await res.text();
      if (!map.getSource) return;

      // Parse CSV into GeoJSON LineString features
      const lines = csv.trim().split("\n");
      if (lines.length < 3) return;
      const headers = lines[0].replace(/^"/, "").split(",").map((h: string) => h.trim());
      const sidIdx = headers.indexOf("SID");
      const latIdx = headers.indexOf("LAT");
      const lonIdx = headers.indexOf("LON");
      const nameIdx = headers.indexOf("NAME");
      const seasonIdx = headers.indexOf("SEASON");
      const windIdx = headers.indexOf("WMO_WIND");

      if (sidIdx < 0 || latIdx < 0 || lonIdx < 0) return;

      // Group by storm ID
      const storms: Record<string, { coords: [number, number][]; name: string; season: string; maxWind: number }> = {};
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const sid = cols[sidIdx]?.trim();
        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);
        if (!sid || isNaN(lat) || isNaN(lon)) continue;

        if (!storms[sid]) storms[sid] = { coords: [], name: cols[nameIdx]?.replace(/"/g, "") || "UNNAMED", season: cols[seasonIdx]?.trim() || "", maxWind: 0 };
        storms[sid].coords.push([lon, lat]);
        const wind = parseFloat(cols[windIdx]);
        if (!isNaN(wind) && wind > storms[sid].maxWind) storms[sid].maxWind = wind;
      }

      const features = Object.values(storms)
        .filter((s) => s.coords.length > 3)
        .map((s) => ({
          type: "Feature" as const,
          properties: { name: s.name, season: s.season, maxWind: s.maxWind },
          geometry: { type: "LineString" as const, coordinates: s.coords },
        }));

      const geojson = { type: "FeatureCollection" as const, features };

      try {
        if (!map.getSource("hurricanes")) {
          map.addSource("hurricanes", { type: "geojson", data: geojson });
        }

        if (!map.getLayer("hurricanes-line")) {
          map.addLayer({
            id: "hurricanes-line",
            type: "line",
            source: "hurricanes",
            paint: {
              "line-color": "#f97316",
              "line-width": 1.5,
              "line-opacity": 0.6,
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 3600000));
}

export function removeHurricaneTracks(map: any): void {
  try { map.removeLayer("hurricanes-line"); } catch {}
  try { map.removeSource("hurricanes"); } catch {}
}

/* ─── NLNOG Nodes ─── */

export function addNLNOGNodes(map: any, handle: LayerHandle): void {
  if (map.getSource("nlnog-nodes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/nlnog");
      const data = await res.json();
      if (!map.getSource || !data?.features) return;

      try {
        if (!map.getSource("nlnog-nodes")) {
          map.addSource("nlnog-nodes", { type: "geojson", data });
        } else {
          (map.getSource("nlnog-nodes") as any).setData(data);
        }

        if (!map.getLayer("nlnog-circles")) {
          map.addLayer({
            id: "nlnog-circles",
            type: "circle",
            source: "nlnog-nodes",
            paint: {
              "circle-radius": 4,
              "circle-color": "#f97316",
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeNLNOGNodes(map: any): void {
  try { map.removeLayer("nlnog-circles"); } catch {}
  try { map.removeSource("nlnog-nodes"); } catch {}
}

/* ─── Wildfires (NASA FIRMS) ─── */

export function addWildfires(map: any, handle: LayerHandle): void {
  if (map.getSource("wildfires")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/wildfires");
      const data = await res.json();
      if (!data?.features?.length) return;

      try {
        if (!map.getSource("wildfires")) {
          map.addSource("wildfires", { type: "geojson", data });
        } else {
          (map.getSource("wildfires") as any).setData(data);
        }

        if (!map.getLayer("wildfires-heat")) {
          map.addLayer({
            id: "wildfires-heat",
            type: "heatmap",
            source: "wildfires",
            maxzoom: 9,
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "confidence"], 0, 0.1, 100, 1],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(0,0,0,0)",
                0.2, "rgba(255,170,0,0.4)",
                0.4, "rgba(255,136,0,0.6)",
                0.6, "rgba(255,102,0,0.8)",
                0.8, "rgba(255,0,0,0.9)",
                1, "rgba(255,0,0,1)",
              ],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 9, 20],
              "heatmap-opacity": 0.7,
            },
          });
        }

        if (!map.getLayer("wildfires-circles")) {
          map.addLayer({
            id: "wildfires-circles",
            type: "circle",
            source: "wildfires",
            minzoom: 6,
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["get", "confidence"],
                0, 2, 30, 3, 50, 4, 80, 6, 100, 8,
              ],
              "circle-color": [
                "interpolate", ["linear"], ["get", "confidence"],
                0, "#ffaa00", 30, "#ff8800", 50, "#ff6600", 80, "#ff0000",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
            },
          });
        }
      } catch { /* style may have changed */ }
    } catch { /* fetch failed */ }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 3600000)); // 1 hour
}

export function removeWildfires(map: any): void {
  try { map.removeLayer("wildfires-circles"); } catch {}
  try { map.removeLayer("wildfires-heat"); } catch {}
  try { map.removeSource("wildfires"); } catch {}
}

/* ─── Buildings (Overture Maps) ─── */

export function addBuildings(map: any, _handle: LayerHandle): void {
  if (map.getSource("overture-buildings")) return;

  map.addSource("overture-buildings", {
    type: "vector",
    tiles: ["https://tiles.overturemaps.org/{z}/{x}/{y}.pbf"],
    maxzoom: 16,
  });

  map.addLayer({
    id: "buildings-fill",
    type: "fill",
    source: "overture-buildings",
    "source-layer": "building",
    minzoom: 12,
    paint: {
      "fill-color": "#d4c5a9",
      "fill-opacity": 0.5,
    },
  });

  map.addLayer({
    id: "buildings-outline",
    type: "line",
    source: "overture-buildings",
    "source-layer": "building",
    minzoom: 12,
    paint: {
      "line-color": "#a89070",
      "line-width": 0.5,
      "line-opacity": 0.7,
    },
  });
}

export function removeBuildings(map: any): void {
  try { map.removeLayer("buildings-outline"); } catch {}
  try { map.removeLayer("buildings-fill"); } catch {}
  try { map.removeSource("overture-buildings"); } catch {}
}

/* ─── Master add/remove dispatcher ─── */

const LAYER_HANDLERS: Record<string, {
  add: (map: any, handle: LayerHandle) => void;
  remove: (map: any) => void;
}> = {
  earthquakes: { add: addEarthquakes, remove: removeEarthquakes },
  warnings: { add: addWarnings, remove: removeWarnings },
  events: { add: addNaturalEvents, remove: removeNaturalEvents },
  radar: { add: addRadar, remove: removeRadar },
  waterways: { add: addWaterways, remove: removeWaterways },
  hurricaneTracks: { add: addHurricaneTracks, remove: removeHurricaneTracks },
  nlnogNodes: { add: addNLNOGNodes, remove: removeNLNOGNodes },
  wildfires: { add: addWildfires, remove: removeWildfires },
  buildings: { add: addBuildings, remove: removeBuildings },
};

export function addDataLayer(map: any, handle: LayerHandle, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.add(map, handle);
}

export function removeDataLayer(map: any, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.remove(map);
}

/** Layer IDs that are available in MapLibre 2D context. */
export const MAP_2D_LAYER_IDS = new Set(Object.keys(LAYER_HANDLERS));
