import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Marine Weather (Wave Height via Open-Meteo Marine API) ─── */

// Open-Meteo marine tile endpoint is no longer available.
// Instead, we use their JSON Marine API to fetch wave/sst data
// and display it as grid points on the map.

// Sample grid of ocean points (avoiding land coverage)
// This provides a sparse but useful visualization of marine conditions
const OCEAN_SAMPLE_POINTS: Array<{ lat: number; lon: number }> = [
  // North Atlantic
  { lat: 45, lon: -30 }, { lat: 40, lon: -40 }, { lat: 50, lon: -20 },
  { lat: 35, lon: -50 }, { lat: 55, lon: -15 }, { lat: 30, lon: -60 },
  // South Atlantic
  { lat: -20, lon: -15 }, { lat: -30, lon: -10 }, { lat: -15, lon: -20 },
  { lat: -35, lon: -5 }, { lat: -25, lon: -25 },
  // North Pacific
  { lat: 40, lon: 160 }, { lat: 35, lon: 150 }, { lat: 45, lon: 170 },
  { lat: 30, lon: 170 }, { lat: 50, lon: 180 },
  // South Pacific
  { lat: -20, lon: -130 }, { lat: -30, lon: -120 }, { lat: -15, lon: -140 },
  { lat: -25, lon: -110 }, { lat: -35, lon: -100 },
  // Indian Ocean
  { lat: -10, lon: 70 }, { lat: -20, lon: 80 }, { lat: 0, lon: 60 },
  { lat: -15, lon: 90 }, { lat: -5, lon: 50 },
  // Mediterranean
  { lat: 36, lon: 15 }, { lat: 38, lon: 20 }, { lat: 35, lon: 25 },
  // Arctic
  { lat: 70, lon: 10 }, { lat: 65, lon: -20 }, { lat: 75, lon: 0 },
  // Caribbean
  { lat: 15, lon: -60 }, { lat: 20, lon: -70 }, { lat: 10, lon: -65 },
];

export function addMarineWeather(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("marineWeather")) return;

  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  try {
    if (!map.getSource("marineWeather")) {
      map.addSource("marineWeather", { type: "geojson", data: empty });
    }

    if (!map.getLayer("marineWeather-points")) {
      map.addLayer({
        id: "marineWeather-points",
        type: "circle",
        source: "marineWeather",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "waveHeight"], 0, 3, 6, 8, 12, 12],
          "circle-color": [
            "interpolate", ["linear"], ["get", "waveHeight"],
            0, "#22d3ee",    // calm — cyan
            2, "#3b82f6",    // moderate — blue
            4, "#f59e0b",    // rough — amber
            6, "#f97316",    // very rough — orange
            9, "#ef4444",    // high — red
          ],
          "circle-opacity": 0.8,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
      });
    }

    if (!map.getLayer("marineWeather-labels")) {
      map.addLayer({
        id: "marineWeather-labels",
        type: "symbol",
        source: "marineWeather",
        layout: {
          "text-field": ["concat", ["get", "waveHeightStr"], "m"],
          "text-size": 10,
          "text-offset": [0, 1.5],
          "text-optional": true,
        },
        paint: {
          "text-color": "#e2e8f0",
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 1,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  const doLoad = async () => {
    try {
      setStatus(handle, "marineWeather", "loading");

      // Fetch marine data for all sample points in one request
      // Open-Meteo Marine API: batch coordinates
      const latitudes = OCEAN_SAMPLE_POINTS.map((p) => p.lat);
      const longitudes = OCEAN_SAMPLE_POINTS.map((p) => p.lon);
      const params = new URLSearchParams({
        latitude: latitudes.join(","),
        longitude: longitudes.join(","),
        current: "wave_height,wind_wave_height,swell_wave_height,sea_surface_temperature",
        timezone: "UTC",
      });

      const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
      if (!res.ok) {
        setStatus(handle, "marineWeather", "empty");
        return;
      }

      const data = await res.json();
      const features: GeoJSON.Feature[] = [];

      if (data.current) {
        // Batch response format
        const times = Array.isArray(data.current?.time) ? data.current.time : [data.current?.time];
        const waveHeights = Array.isArray(data.current?.wave_height) ? data.current.wave_height : [data.current?.wave_height];
        const windWaves = Array.isArray(data.current?.wind_wave_height) ? data.current.wind_wave_height : [data.current?.wind_wave_height];
        const swellWaves = Array.isArray(data.current?.swell_wave_height) ? data.current.swell_wave_height : [data.current.swell_wave_height];
        const sst = Array.isArray(data.current?.sea_surface_temperature) ? data.current.sea_surface_temperature : [data.current?.sea_surface_temperature];

        for (let i = 0; i < OCEAN_SAMPLE_POINTS.length; i++) {
          const wh = waveHeights[i];
          if (wh == null || isNaN(wh)) continue;

          features.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [OCEAN_SAMPLE_POINTS[i].lon, OCEAN_SAMPLE_POINTS[i].lat],
            },
            properties: {
              waveHeight: Math.round(wh * 10) / 10,
              waveHeightStr: wh.toFixed(1),
              windWave: windWaves[i] != null ? Math.round(windWaves[i] * 10) / 10 : null,
              swellWave: swellWaves[i] != null ? Math.round(swellWaves[i] * 10) / 10 : null,
              sst: sst[i] != null ? Math.round(sst[i] * 10) / 10 : null,
              color: wh > 6 ? "#ef4444" : wh > 4 ? "#f97316" : wh > 2 ? "#3b82f6" : "#22d3ee",
            },
          });
        }
      }

      setStatus(handle, "marineWeather", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
        if (!map.getSource("marineWeather")) {
          map.addSource("marineWeather", { type: "geojson", data: geojson });
        } else {
          (map.getSource("marineWeather") as any)?.setData(geojson);
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "marineWeather", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

export function removeMarineWeather(map: maplibregl.Map): void {
  ["marineWeather-labels", "marineWeather-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("marineWeather"); } catch {}
}
