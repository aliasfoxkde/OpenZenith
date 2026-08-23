import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Hurricane Tracks ─── */

export function addHurricaneTracks(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("hurricanes")) return;

  const doLoad = async () => {
    try {
      setStatus(handle, "hurricaneTracks", "loading");

      // Fetch active storms (points) and full tracks (polylines) in parallel
      const [pointRes, trackRes] = await Promise.allSettled([
        fetch("/api/hurricanes?active=true"),
        fetch("/api/hurricanes?track=full"),
      ]);

      if (!map.getSource) return;

      // Build combined GeoJSON
      const features: GeoJSON.Feature[] = [];

      // Parse point data (active storms)
      if (pointRes.status === "fulfilled" && pointRes.value.ok) {
        const data = await pointRes.value.json();
        if (data?.features) features.push(...data.features);
      }

      // Parse track data (polylines)
      let _trackCount = 0;
      if (trackRes.status === "fulfilled" && trackRes.value.ok) {
        const trackData = await trackRes.value.json();
        if (trackData?.features) {
          for (const f of trackData.features) {
            if (f.geometry?.type === "MultiLineString") {
              _trackCount++;
              features.push(f);
            }
          }
        }
      }

      if (features.length === 0) {
        setStatus(handle, "hurricaneTracks", "empty");
        return;
      }

      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("hurricanes")) {
          map.addSource("hurricanes", { type: "geojson", data: geojson });
        } else {
          (map.getSource("hurricanes") as any).setData(geojson);
        }

        // Track lines (MultiLineString features)
        if (!map.getLayer("hurricane-tracks")) {
          map.addLayer({
            id: "hurricane-tracks",
            type: "line",
            source: "hurricanes",
            filter: ["==", ["geometry-type"], "MultiLineString"],
            paint: {
              "line-color": [
                "interpolate",
                ["linear"],
                ["get", "wind"],
                0,
                "#fbbf24",
                34,
                "#f97316",
                64,
                "#ef4444",
                96,
                "#dc2626",
                130,
                "#991b1b",
              ],
              "line-width": 2,
              "line-opacity": 0.6,
              "line-dasharray": [3, 1],
            },
          });
        }

        // Storm position points (Point features)
        if (!map.getLayer("hurricanes-points")) {
          map.addLayer({
            id: "hurricanes-points",
            type: "circle",
            source: "hurricanes",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "wind"], 0, 4, 34, 5, 64, 6, 96, 7, 130, 9],
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
              "circle-opacity": 0.9,
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
              filter: ["==", ["geometry-type"], "Point"],
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "wind"], 0, 8, 64, 14, 130, 22],
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
              filter: ["==", ["geometry-type"], "Point"],
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

        setStatus(handle, "hurricaneTracks", "loaded", features.length);
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "hurricaneTracks", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeHurricaneTracks(map: maplibregl.Map): void {
  ["hurricanes-labels", "hurricanes-glow", "hurricanes-points", "hurricane-tracks"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("hurricanes");
  } catch {}
}

/* ─── Hurricane Animation ─── */

export function startHurricaneAnimation(
  map: maplibregl.Map,
  handle: LayerHandle,
  callback: (progress: number) => void,
): void {
  const source = map.getSource("hurricanes");
  if (!source?._data?.features) return;

  // Collect timestamps from track data (MultiLineString features with times/winds arrays)
  const trackFeatures = source._data.features.filter(
    (f: GeoJSON.Feature) => f.geometry?.type === "MultiLineString" && (f.properties as Record<string, unknown>)?.times,
  );

  if (trackFeatures.length === 0) return;

  // Find the time range across all storms
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const f of trackFeatures) {
    const times = (f.properties as Record<string, unknown>).times as string[];
    for (const t of times) {
      const ms = new Date(t).getTime();
      if (!isNaN(ms)) {
        if (ms < minTime) minTime = ms;
        if (ms > maxTime) maxTime = ms;
      }
    }
  }

  if (minTime === Infinity || maxTime === -Infinity || maxTime - minTime < 1000) return;

  const duration = 20000;
  const startTime = Date.now();

  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = (elapsed % duration) / duration;
    const currentTime = minTime + progress * (maxTime - minTime);
    callback(progress);

    // Filter track coordinates to show only points up to currentTime
    try {
      for (const f of trackFeatures) {
        const times = (f.properties as Record<string, unknown>).times as string[];
        const _winds = (f.properties as Record<string, unknown>).winds as number[];
        const coords = (f.geometry as GeoJSON.MultiLineString).coordinates[0];

        // Find how many track points are before currentTime
        let visibleCount = 0;
        for (let i = 0; i < times.length; i++) {
          const ms = new Date(times[i]).getTime();
          if (!isNaN(ms) && ms <= currentTime) visibleCount = i + 1;
          else break;
        }

        // Truncate the line to visibleCount points
        if (visibleCount < coords.length) {
          (f.geometry as GeoJSON.MultiLineString).coordinates = [coords.slice(0, visibleCount)];
        } else {
          (f.geometry as GeoJSON.MultiLineString).coordinates = [coords];
        }
      }
      (source as any).setData({ type: "FeatureCollection", features: source._data?.features || [] });
    } catch {}
  };

  animate();
  handle.intervals.push(setInterval(animate, 100));
}

export function stopHurricaneAnimation(map: maplibregl.Map, handle: LayerHandle): void {
  while (handle.intervals.length > 0) {
    clearInterval(handle.intervals.pop()!);
  }
  // Re-fetch to restore full tracks
  if (map.getSource("hurricanes")) {
    fetch("/api/hurricanes?track=full")
      .then((r) => r.json())
      .then((data) => {
        if (data?.features) {
          try {
            (map.getSource("hurricanes") as any).setData(data);
          } catch {}
        }
      })
      .catch(() => {});
  }
}
