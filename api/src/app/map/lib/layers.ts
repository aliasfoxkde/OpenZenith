/**
 * MapLibre data layer loaders for 2D map page.
 *
 * Each layer provides add/remove functions compatible with MapLibre GL's
 * source/layer API. Layers that fetch GeoJSON data from APIs include
 * auto-refresh via setInterval (returned for cleanup).
 */

export interface LayerHandle {
  /** Interval IDs that need clearing on unmount / toggle-off. */
  intervals: ReturnType<typeof setInterval>[];
}

/* ─── Earthquakes ─── */

export function addEarthquakes(map: maplibregl.Map, handle: LayerHandle): void {
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
          map.getSource("earthquakes")?.setData(data);
        }

        // Circle layer — sized by magnitude
        if (!map.getLayer("earthquakes-circles")) {
          map.addLayer({
            id: "earthquakes-circles",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 3, 3, 6, 5, 10, 7, 16],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "mag"],
                0,
                "#22c55e",
                3,
                "#eab308",
                5,
                "#f97316",
                7,
                "#ef4444",
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
              "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 6, 3, 12, 5, 20, 7, 32],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "mag"],
                0,
                "rgba(34,197,94,0.15)",
                3,
                "rgba(234,179,8,0.15)",
                5,
                "rgba(249,115,22,0.15)",
                7,
                "rgba(239,68,68,0.2)",
              ],
              "circle-blur": 1,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 60000));
}

export function removeEarthquakes(map: maplibregl.Map): void {
  ["earthquakes-glow", "earthquakes-circles"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("earthquakes");
  } catch {}
}

/* ─── Weather Warnings ─── */

export function addWarnings(map: maplibregl.Map, handle: LayerHandle): void {
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
          map.getSource("warnings")?.setData(data);
        }

        // Fill layer
        if (!map.getLayer("warnings-fill")) {
          map.addLayer({
            id: "warnings-fill",
            type: "fill",
            source: "warnings",
            paint: {
              "fill-color": [
                "match",
                ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"],
                "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"],
                "#f97316",
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
                "match",
                ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"],
                "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"],
                "#f97316",
                "#eab308",
              ],
              "line-width": 2,
              "line-opacity": 0.7,
              "line-dasharray": [2, 2],
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000));
}

export function removeWarnings(map: maplibregl.Map): void {
  ["warnings-outline", "warnings-fill"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("warnings");
  } catch {}
}

/* ─── Natural Events (NASA EONET) ─── */

export function addNaturalEvents(map: maplibregl.Map, handle: LayerHandle): void {
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
          map.getSource("natural-events")?.setData(data);
        }

        if (!map.getLayer("natural-events-points")) {
          map.addLayer({
            id: "natural-events-points",
            type: "circle",
            source: "natural-events",
            paint: {
              "circle-radius": 6,
              "circle-color": [
                "match",
                ["coalesce", ["get", "category"], ""],
                ["volcanoes", "severeStorms", "icebergs"],
                "#ef4444",
                ["wildfires", "seaLakeIce"],
                "#f97316",
                ["floods", "landslides"],
                "#3b82f6",
                "#eab308",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.6)",
            },
          });

          // Glow underneath
          if (!map.getLayer("natural-events-glow")) {
            map.addLayer({
              id: "natural-events-glow",
              type: "circle",
              source: "natural-events",
              paint: {
                "circle-radius": 14,
                "circle-color": "rgba(239, 68, 68, 0.2)",
                "circle-blur": 1,
              },
            });
          }
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000));
}

export function removeNaturalEvents(map: maplibregl.Map): void {
  try {
    map.removeLayer("natural-events-glow");
  } catch {}
  try {
    map.removeLayer("natural-events-points");
  } catch {}
  try {
    map.removeSource("natural-events");
  } catch {}
}

/* ─── Weather Radar (RainViewer) ─── */

export function addRadar(map: maplibregl.Map, handle: LayerHandle): void {
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
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeRadar(map: maplibregl.Map): void {
  try {
    map.removeLayer("radar-layer");
  } catch {}
  try {
    map.removeSource("radar");
  } catch {}
}

/* ─── Waterways ─── */

export function addWaterways(map: maplibregl.Map, handle: LayerHandle): void {
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
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  // Re-fetch on pan (debounced via interval)
  handle.intervals.push(setInterval(doLoad, 30000));
}

export function removeWaterways(map: maplibregl.Map): void {
  try {
    map.removeLayer("waterways-line");
  } catch {}
  try {
    map.removeSource("waterways");
  } catch {}
}

/* ─── Hurricane Tracks ─── */

export function addHurricaneTracks(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("hurricanes")) return;

  const doLoad = async () => {
    try {
      // Use server API which parses IBTrACS CSV and returns clean GeoJSON
      const res = await fetch("/api/hurricanes?active=true");
      const data = await res.json();
      if (!map.getSource) return;
      if (!data?.features?.length) return;

      try {
        if (!map.getSource("hurricanes")) {
          map.addSource("hurricanes", { type: "geojson", data });
        } else {
          map.getSource("hurricanes")?.setData(data);
        }

        if (!map.getLayer("hurricanes-points")) {
          map.addLayer({
            id: "hurricanes-points",
            type: "circle",
            source: "hurricanes",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "wind"],
                0,
                4,
                34,
                5,
                64,
                6,
                96,
                7,
                130,
                9,
              ],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "wind"],
                0,
                "#fbbf24",
                34,
                "#f97316",
                64,
                "#f97316",
                96,
                "#ef4444",
                130,
                "#dc2626",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#fff",
            },
          });

          // Glow layer
          if (!map.getLayer("hurricanes-glow")) {
            map.addLayer({
              id: "hurricanes-glow",
              type: "circle",
              source: "hurricanes",
              paint: {
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["get", "wind"],
                  0,
                  8,
                  64,
                  14,
                  130,
                  22,
                ],
                "circle-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "wind"],
                  0,
                  "rgba(251,191,36,0.15)",
                  64,
                  "rgba(249,115,22,0.15)",
                  130,
                  "rgba(220,38,38,0.2)",
                ],
                "circle-blur": 1,
              },
            });
          }

          // Labels for storm names
          if (!map.getLayer("hurricanes-labels")) {
            map.addLayer({
              id: "hurricanes-labels",
              type: "symbol",
              source: "hurricanes",
              layout: {
                "text-field": ["coalesce", ["get", "name"], ""],
                "text-size": 11,
                "text-offset": [0, 1.5],
                "text-anchor": "top",
                "text-max-width": 8,
              },
              paint: {
                "text-color": "#f97316",
                "text-halo-color": "rgba(0,0,0,0.9)",
                "text-halo-width": 2,
              },
            });
          }
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeHurricaneTracks(map: maplibregl.Map): void {
  try {
    map.removeLayer("hurricanes-labels");
  } catch {}
  try {
    map.removeLayer("hurricanes-glow");
  } catch {}
  try {
    map.removeLayer("hurricanes-points");
  } catch {}
  try {
    map.removeSource("hurricanes");
  } catch {}
}

/* ─── NLNOG Nodes ─── */

export function addNLNOGNodes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("nlnog-nodes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/nlnog");
      const data = await res.json();
      if (!map.getSource) return;

      // API returns {nodes: [...], count: N}, not GeoJSON — convert
      const nodes = data?.nodes || data?.features || [];
      if (!nodes.length) return;

      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: nodes.map((n: { lat: number; lon: number; id: number; hostname?: string; asn?: number; city?: string; country?: string }) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [n.lon, n.lat] },
          properties: {
            id: n.id,
            hostname: n.hostname || "",
            asn: n.asn || 0,
            city: n.city || "",
            country: n.country || "",
          },
        })),
      };

      try {
        if (!map.getSource("nlnog-nodes")) {
          map.addSource("nlnog-nodes", { type: "geojson", data: geojson });
        } else {
          map.getSource("nlnog-nodes")?.setData(geojson);
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
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeNLNOGNodes(map: maplibregl.Map): void {
  try {
    map.removeLayer("nlnog-circles");
  } catch {}
  try {
    map.removeSource("nlnog-nodes");
  } catch {}
}

/* ─── Wildfires (NASA FIRMS) ─── */

export function addWildfires(map: maplibregl.Map, handle: LayerHandle): void {
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
          map.getSource("wildfires")?.setData(data);
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
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.2,
                "rgba(255,170,0,0.4)",
                0.4,
                "rgba(255,136,0,0.6)",
                0.6,
                "rgba(255,102,0,0.8)",
                0.8,
                "rgba(255,0,0,0.9)",
                1,
                "rgba(255,0,0,1)",
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
              "circle-radius": ["interpolate", ["linear"], ["get", "confidence"], 0, 2, 30, 3, 50, 4, 80, 6, 100, 8],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "confidence"],
                0,
                "#ffaa00",
                30,
                "#ff8800",
                50,
                "#ff6600",
                80,
                "#ff0000",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 3600000)); // 1 hour
}

export function removeWildfires(map: maplibregl.Map): void {
  try {
    map.removeLayer("wildfires-circles");
  } catch {}
  try {
    map.removeLayer("wildfires-heat");
  } catch {}
  try {
    map.removeSource("wildfires");
  } catch {}
}

/* ─── Buildings (Overture Maps) ─── */

export function addBuildings(map: maplibregl.Map, _handle: LayerHandle): void {
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

export function removeBuildings(map: maplibregl.Map): void {
  try {
    map.removeLayer("buildings-outline");
  } catch {}
  try {
    map.removeLayer("buildings-fill");
  } catch {}
  try {
    map.removeSource("overture-buildings");
  } catch {}
}

/* ─── Population Density (GHSL) ─── */

export function addPopulationDensity(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("population-density")) return;

  map.addSource("population-density", {
    type: "raster",
    tiles: ["/api/population/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 2,
    maxzoom: 14,
  });

  map.addLayer({
    id: "population-density-layer",
    type: "raster",
    source: "population-density",
    paint: {
      "raster-opacity": 0.6,
      "raster-color-mix": ["multiply", ["rgba(0,0,0,0.7)"], ["rgba(255,200,0,1)"]],
    },
  });
}

export function removePopulationDensity(map: maplibregl.Map): void {
  try {
    map.removeLayer("population-density-layer");
  } catch {}
  try {
    map.removeSource("population-density");
  } catch {}
}

/* ─── CORINE Land Cover ─── */

export function addLandCover(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("land-cover")) return;

  map.addSource("land-cover", {
    type: "raster",
    tiles: ["/api/landcover/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 4,
    maxzoom: 13,
  });

  map.addLayer({
    id: "land-cover-layer",
    type: "raster",
    source: "land-cover",
    paint: {
      "raster-opacity": 0.5,
    },
  });
}

export function removeLandCover(map: maplibregl.Map): void {
  try {
    map.removeLayer("land-cover-layer");
  } catch {}
  try {
    map.removeSource("land-cover");
  } catch {}
}

/* ─── Sentinel-2 Imagery ─── */

export function addSentinel2(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("sentinel2")) return;

  map.addSource("sentinel2", {
    type: "raster",
    tiles: ["/api/sentinel2/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 3,
    maxzoom: 14,
  });

  map.addLayer({
    id: "sentinel2-layer",
    type: "raster",
    source: "sentinel2",
    paint: {
      "raster-opacity": 0.8,
      "raster-saturation": 0.3,
    },
  });
}

export function removeSentinel2(map: maplibregl.Map): void {
  try {
    map.removeLayer("sentinel2-layer");
  } catch {}
  try {
    map.removeSource("sentinel2");
  } catch {}
}

/* ─── Air Quality ─── */

export function addAirQuality(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("air-quality")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/airquality?lat=${center.lat.toFixed(2)}&lon=${center.lng.toFixed(2)}`);
      const data = await res.json();
      if (!map.getSource || !data?.features) return;

      try {
        if (!map.getSource("air-quality")) {
          map.addSource("air-quality", { type: "geojson", data });
        } else {
          map.getSource("air-quality")?.setData(data);
        }

        if (!map.getLayer("air-quality-circle")) {
          map.addLayer({
            id: "air-quality-circle",
            type: "circle",
            source: "air-quality",
            paint: {
              "circle-radius": 12,
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "us_aqi"],
                0,
                "#22c55e",
                50,
                "#22c55e",
                51,
                "#eab308",
                100,
                "#eab308",
                101,
                "#f97316",
                150,
                "#f97316",
                151,
                "#ef4444",
                200,
                "#ef4444",
                201,
                "#a855f7",
                300,
                "#a855f7",
                301,
                "#7f1d1d",
              ],
              "circle-opacity": 0.7,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            },
          });
        }

        if (!map.getLayer("air-quality-label")) {
          map.addLayer({
            id: "air-quality-label",
            type: "symbol",
            source: "air-quality",
            layout: {
              "text-field": ["concat", ["to-string", ["get", "us_aqi"]], "\n", ["get", "aqi_level"]],
              "text-size": 11,
              "text-anchor": "center",
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#fff",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1.5,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000)); // 5 min
}

export function removeAirQuality(map: maplibregl.Map): void {
  try {
    map.removeLayer("air-quality-label");
  } catch {}
  try {
    map.removeLayer("air-quality-circle");
  } catch {}
  try {
    map.removeSource("air-quality");
  } catch {}
}

/* ─── Elevation Color Heatmap ─── */

export function addElevationColor(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("elevation-color")) return;

  map.addSource("elevation-color", {
    type: "raster",
    tiles: ["/api/elevation-color/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
  });

  map.addLayer({
    id: "elevation-color-layer",
    type: "raster",
    source: "elevation-color",
    paint: {
      "raster-opacity": 0.85,
    },
  });
}

export function removeElevationColor(map: maplibregl.Map): void {
  try {
    map.removeLayer("elevation-color-layer");
  } catch {}
  try {
    map.removeSource("elevation-color");
  } catch {}
}

/* ─── Elevation Accuracy Heatmap ─── */

export function addElevationAccuracy(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("elevation-accuracy")) return;

  map.addSource("elevation-accuracy", {
    type: "raster",
    tiles: ["/api/elevation-accuracy/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
  });

  map.addLayer({
    id: "elevation-accuracy-layer",
    type: "raster",
    source: "elevation-accuracy",
    paint: {
      "raster-opacity": 0.4,
    },
  });
}

export function removeElevationAccuracy(map: maplibregl.Map): void {
  try {
    map.removeLayer("elevation-accuracy-layer");
  } catch {}
  try {
    map.removeSource("elevation-accuracy");
  } catch {}
}

/* ─── Topo Contours ─── */

export function addContours(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("contours")) return;

  map.addSource("contours", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Minor contours — thin, subtle
  map.addLayer({
    id: "contours-minor",
    type: "line",
    source: "contours",
    paint: {
      "line-color": "rgba(148, 163, 184, 0.3)",
      "line-width": 0.5,
    },
    filter: ["==", ["get", "type"], "minor"],
  });

  // Major contours — thicker, brighter
  map.addLayer({
    id: "contours-major",
    type: "line",
    source: "contours",
    paint: {
      "line-color": "rgba(203, 213, 225, 0.6)",
      "line-width": 1.2,
    },
    filter: ["==", ["get", "type"], "major"],
  });

  // Load contour data for current viewport
  const loadContours = async () => {
    try {
      if (!map.getSource("contours")) return;
      const bounds = map.getBounds();
      const center = map.getCenter();
      const zoom = Math.floor(map.getZoom());
      const { x, y } = latLonToTile(center.lat, center.lng, zoom);

      // Fetch contours for center tile
      const res = await fetch(`/api/contours/${zoom}/${x}/${y}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.features?.length) return;

      if (map.getSource("contours")) {
        map.getSource("contours")?.setData?.(data);
      }
    } catch {
      /* skip */
    }
  };

  loadContours();
}

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function removeContours(map: maplibregl.Map): void {
  try {
    map.removeLayer("contours-major");
  } catch {}
  try {
    map.removeLayer("contours-minor");
  } catch {}
  try {
    map.removeSource("contours");
  } catch {}
}

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade")) return;
  if (!map.getSource("elevation")) return;
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#000000",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#333333",
      "hillshade-exaggeration": 0.5,
    },
  });
}

export function removeHillshade(map: maplibregl.Map): void {
  try {
    map.removeLayer("hillshade");
  } catch {}
}

/* ─── Master add/remove dispatcher ─── */

const LAYER_HANDLERS: Record<
  string,
  {
    add: (map: maplibregl.Map, handle: LayerHandle) => void;
    remove: (map: maplibregl.Map) => void;
  }
> = {
  hillshade: { add: addHillshade, remove: removeHillshade },
  elevationColor: { add: addElevationColor, remove: removeElevationColor },
  elevationAccuracy: { add: addElevationAccuracy, remove: removeElevationAccuracy },
  contours: { add: addContours, remove: removeContours },
  earthquakes: { add: addEarthquakes, remove: removeEarthquakes },
  warnings: { add: addWarnings, remove: removeWarnings },
  events: { add: addNaturalEvents, remove: removeNaturalEvents },
  radar: { add: addRadar, remove: removeRadar },
  waterways: { add: addWaterways, remove: removeWaterways },
  hurricaneTracks: { add: addHurricaneTracks, remove: removeHurricaneTracks },
  nlnogNodes: { add: addNLNOGNodes, remove: removeNLNOGNodes },
  wildfires: { add: addWildfires, remove: removeWildfires },
  buildings: { add: addBuildings, remove: removeBuildings },
  populationDensity: { add: addPopulationDensity, remove: removePopulationDensity },
  landCover: { add: addLandCover, remove: removeLandCover },
  sentinel2: { add: addSentinel2, remove: removeSentinel2 },
  airQuality: { add: addAirQuality, remove: removeAirQuality },
};

export function addDataLayer(map: maplibregl.Map, handle: LayerHandle, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.add(map, handle);
}

export function removeDataLayer(map: maplibregl.Map, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.remove(map);
}

/** Layer IDs that are available in MapLibre 2D context. */
export const MAP_2D_LAYER_IDS = new Set(Object.keys(LAYER_HANDLERS));

/* ─── Hurricane Animation ─── */

export function startHurricaneAnimation(
  map: maplibregl.Map,
  handle: LayerHandle,
  callback: (progress: number) => void,
): void {
  // Get timestamp range from source data
  const source = map.getSource("hurricanes");
  if (!source?._data?.features) return;

  const times = source._data.features
    .filter(
      (f: GeoJSON.Feature) => f.geometry?.type === "Point" && (f.properties as Record<string, unknown>)?.timestamp,
    )
    .map((f: GeoJSON.Feature) => (f.properties as Record<string, unknown>).timestamp as number)
    .filter((t: number) => t > 0)
    .sort((a: number, b: number) => a - b);

  if (times.length === 0) return;

  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const duration = 15000; // 15 second animation cycle
  const startTime = Date.now();

  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = (elapsed % duration) / duration;
    const currentTime = minTime + progress * (maxTime - minTime);

    callback(progress);

    // Update filter to show only points up to current time
    try {
      if (map.getLayer("hurricanes-points")) {
        map.setFilter("hurricanes-points", [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["<=", ["get", "timestamp"], currentTime],
        ]);
      }
    } catch {}
  };

  animate();
  handle.intervals.push(setInterval(animate, 100));
}

export function stopHurricaneAnimation(map: maplibregl.Map, handle: LayerHandle): void {
  // Clear animation intervals (last one is the animation)
  while (handle.intervals.length > 0) {
    clearInterval(handle.intervals.pop()!);
  }

  // Reset filter to show all points
  try {
    if (map.getLayer("hurricanes-points")) {
      map.setFilter("hurricanes-points", ["==", ["geometry-type"], "Point"]);
    }
  } catch {}
}
