/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { fetchSWPCaurora, fetchSWPCkpForecast } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

const AURORA_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><ellipse cx="12" cy="16" rx="10" ry="6" fill="#00ff88" opacity="0.25"/><ellipse cx="12" cy="14" rx="8" ry="4" fill="#00ff88" opacity="0.4"/><ellipse cx="12" cy="12" rx="6" ry="2.5" fill="#00ffaa" opacity="0.6"/><path d="M12 4v8M8 8l4-4 4 4" stroke="#00ffcc" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/><circle cx="12" cy="3" r="1.5" fill="#00ffcc" opacity="0.9"/></svg>`;

export function loadSpaceWeather(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { spaceWeather: boolean },
) {
  updateStatus("spaceWeather", { error: null });
  const retry = createRetryGuard();

  const addKpIndicator = (kp: number) => {
    const color = kp >= 7 ? "#ff0000" : kp >= 5 ? "#ff8800" : kp >= 4 ? "#ffcc00" : "#00cc88";
    const label = kp >= 7 ? `Kp ${kp} - G${kp - 6} STORM` : kp >= 5 ? `Kp ${kp} - G${kp - 3}` : `Kp ${kp}`;

    viewer.entities.add({
      id: "swpc-kp",
      position: Cesium.Cartesian3.fromDegrees(0, 85, 0),
      label: {
        text: label,
        font: "bold 13px 'JetBrains Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 3e7, 0.6),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
      },
      billboard: {
        image: AURORA_ICON,
        width: 22,
        height: 22,
        pixelOffset: new Cesium.Cartesian2(0, 18),
      },
      description: `NOAA Space Weather Prediction Center\nPlanetary K-index: ${kp}\n${kp >= 5 ? "Geomagnetic storm in progress!" : "Quiet conditions"}`,
      properties: { type: "space-weather-kp" },
    });
  };

  const doLoad = async () => {
    try {
      // Fetch Kp forecast
      const kpData = await fetchSWPCkpForecast();
      const currentKp = kpData?.[0]?.kp_index ?? 0;
      if (Cesium && viewer) {
        removeEntities("swpc-");
        addKpIndicator(currentKp);
      }
      updateStatus("spaceWeather", { lastUpdate: Date.now(), count: 1 });

      // Fetch aurora forecast polygons
      try {
        const auroraData = await fetchSWPCaurora();
        if (!auroraData || !Cesium || !viewer) return;
        removeEntities("aurora-");

        // NOAA returns { coordinates: [[lon, lat, intensity], ...] }
        const coords = auroraData.coordinates || [];
        if (coords.length === 0) return;

        // Group by longitude to create latitude strips
        const byLon = new Map<number, { lat: number; intensity: number }[]>();
        for (const c of coords) {
          const lon = Math.round(c[0]);
          const lat = c[1];
          const intensity = c[2];
          if (intensity > 2) { // threshold: skip low-intensity
            if (!byLon.has(lon)) byLon.set(lon, []);
            byLon.get(lon)!.push({ lat, intensity });
          }
        }

        // Create aurora band as colored ellipses at high-latitude grid points
        let entityCount = 0;
        for (const [lon, points] of byLon) {
          for (const pt of points) {
            if (entityCount > 2000) break; // limit entities
            const prob = Math.min(pt.intensity * 10, 100);
            const color = prob > 70
              ? Cesium.Color.fromCssColorString("#00ff88")
              : prob > 40
                ? Cesium.Color.fromCssColorString("#00cc66")
                : Cesium.Color.fromCssColorString("#008844");

            viewer.entities.add({
              id: `aurora-${entityCount++}`,
              position: Cesium.Cartesian3.fromDegrees(lon, pt.lat, 100000),
              ellipse: {
                semiMinorAxis: 50000,
                semiMajorAxis: 50000,
                material: color.withAlpha(prob / 300),
                height: 100000,
              },
              properties: { type: "aurora", probability: prob },
            });
          }
        }
      } catch {
        /* aurora polygon data is optional */
      }

      const iv = setInterval(async () => {
        if (!stateLayers.spaceWeather) return;
        try {
          const kd = await fetchSWPCkpForecast();
          const kp = kd?.[0]?.kp_index ?? 0;
          removeEntities("swpc-");
          addKpIndicator(kp);
          updateStatus("spaceWeather", { lastUpdate: Date.now(), count: 1 });
        } catch {
          retry.recordFailure();
          updateStatus("spaceWeather", {
            error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Space weather data unavailable",
          });
        }
      }, 300000); // 5 min
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("spaceWeather", { error: "fetch failed" });
    }
  };

  doLoad();
}
