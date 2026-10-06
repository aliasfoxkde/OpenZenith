import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Marine Weather (Wave Height via Open-Meteo Marine API) ─── */

// Open-Meteo marine tile endpoint is no longer available.
// Instead, we use their JSON Marine API to fetch wave/sst data
// and display it as grid points on the map.

// Sample grid of ocean points (avoiding land coverage)
// This provides a sparse but useful visualization of marine conditions
const OCEAN_SAMPLE_POINTS: Array<{ lat: number; lon: number }> = [
  // North Atlantic
  { lat: 45, lon: -30 },
  { lat: 40, lon: -40 },
  { lat: 50, lon: -20 },
  { lat: 35, lon: -50 },
  { lat: 55, lon: -15 },
  { lat: 30, lon: -60 },
  // South Atlantic
  { lat: -20, lon: -15 },
  { lat: -30, lon: -10 },
  { lat: -15, lon: -20 },
  { lat: -35, lon: -5 },
  { lat: -25, lon: -25 },
  // North Pacific
  { lat: 40, lon: 160 },
  { lat: 35, lon: 150 },
  { lat: 45, lon: 170 },
  { lat: 30, lon: 170 },
  { lat: 50, lon: 180 },
  // South Pacific
  { lat: -20, lon: -130 },
  { lat: -30, lon: -120 },
  { lat: -15, lon: -140 },
  { lat: -25, lon: -110 },
  { lat: -35, lon: -100 },
  // Indian Ocean
  { lat: -10, lon: 70 },
  { lat: -20, lon: 80 },
  { lat: 0, lon: 60 },
  { lat: -15, lon: 90 },
  { lat: -5, lon: 50 },
  // Mediterranean
  { lat: 36, lon: 15 },
  { lat: 38, lon: 20 },
  { lat: 35, lon: 25 },
  // Arctic
  { lat: 70, lon: 10 },
  { lat: 65, lon: -20 },
  { lat: 75, lon: 0 },
  // Caribbean
  { lat: 15, lon: -60 },
  { lat: 20, lon: -70 },
  { lat: 10, lon: -65 },
];

/**
 * Open-Meteo Marine API `current` block. For a batch multi-coordinate request
 * every variable comes back as a parallel array; the scalar spellings are kept
 * because the API mirrors whatever form it was asked for.
 */
interface OpenMeteoMarineCurrent {
  time?: string | number | Array<string | number>;
  wave_height?: number | number[];
  wind_wave_height?: number | number[];
  swell_wave_height?: number | number[];
  sea_surface_temperature?: number | number[];
}

/** Payload served by marine-api.open-meteo.com/v1/marine. */
interface OpenMeteoMarineResponse {
  current?: OpenMeteoMarineCurrent;
}

/**
 * Add the sea-state layer: one batched request to Open-Meteo's Marine API
 * for 36 fixed open-ocean sample points, rendered as wind-scaled circles
 * (3-12px) coloured by significant wave height in metres — cyan under 2,
 * blue to 4, amber to 6, orange to 9, red above — each labelled with its
 * height. Refreshes every 10 minutes; a non-OK response or a payload without
 * a `current` block marks the handle "empty", a thrown fetch marks it
 * "error".
 */
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
            "interpolate",
            ["linear"],
            ["get", "waveHeight"],
            0,
            "#22d3ee", // calm — cyan
            2,
            "#3b82f6", // moderate — blue
            4,
            "#f59e0b", // rough — amber
            6,
            "#f97316", // very rough — orange
            9,
            "#ef4444", // high — red
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

      const data = (await res.json()) as OpenMeteoMarineResponse;
      const features: GeoJSON.Feature[] = [];

      const current = data.current;
      if (current) {
        // Batch response format
        const _times = Array.isArray(current.time) ? current.time : [current.time];
        const whRaw = current.wave_height;
        const waveHeights = Array.isArray(whRaw) ? whRaw : [whRaw];
        const windRaw = current.wind_wave_height;
        const windWaves = Array.isArray(windRaw) ? windRaw : [windRaw];
        const swellRaw = current.swell_wave_height;
        const swellWaves = Array.isArray(swellRaw) ? swellRaw : [swellRaw];
        const sstRaw = current.sea_surface_temperature;
        const sst = Array.isArray(sstRaw) ? sstRaw : [sstRaw];

        for (let i = 0; i < OCEAN_SAMPLE_POINTS.length; i++) {
          const wh = waveHeights[i];
          if (wh == null || isNaN(wh)) continue;
          const windWave = windWaves[i];
          const swellWave = swellWaves[i];
          const seaSurfaceTemp = sst[i];

          features.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [OCEAN_SAMPLE_POINTS[i].lon, OCEAN_SAMPLE_POINTS[i].lat],
            },
            properties: {
              waveHeight: Math.round(wh * 10) / 10,
              waveHeightStr: wh.toFixed(1),
              windWave: windWave != null ? Math.round(windWave * 10) / 10 : null,
              swellWave: swellWave != null ? Math.round(swellWave * 10) / 10 : null,
              sst: seaSurfaceTemp != null ? Math.round(seaSurfaceTemp * 10) / 10 : null,
              color: wh > 6 ? "#ef4444" : wh > 4 ? "#f97316" : wh > 2 ? "#3b82f6" : "#22d3ee",
            },
          });
        }
      }

      setStatus(handle, "marineWeather", features.length ? "loaded" : "empty", features.length);

      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
        if (!map.getSource("marineWeather")) {
          map.addSource("marineWeather", { type: "geojson", data: geojson });
        } else {
          map.getSource("marineWeather")?.setData(geojson);
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("marineWeather", err);
      setStatus(handle, "marineWeather", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000),
  ); // 10 min
}

/** Remove the marine-weather point and label layers plus the `marineWeather` source, ignoring "not found" errors. */
export function removeMarineWeather(map: maplibregl.Map): void {
  ["marineWeather-labels", "marineWeather-points"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "marineWeather");
}
