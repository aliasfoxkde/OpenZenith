/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { fetchFIRMS } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

const FIRE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2c-1 4-4 6-4 10a4 4 0 008 0c0-4-3-6-4-10z" fill="#ff8800" opacity="0.9"/><path d="M12 8c-.5 2-2 3-2 5a2 2 0 004 0c0-2-1.5-3-2-5z" fill="#ffcc00" opacity="1"/></svg>`;

function fireColor(confidence: number): string {
  if (confidence >= 80) return "#ff0000";
  if (confidence >= 50) return "#ff6600";
  if (confidence >= 30) return "#ff8800";
  return "#ffaa00";
}

export function loadWildfires(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { wildfires: boolean },
) {
  updateStatus("wildfires", { error: null });
  const retry = createRetryGuard({ maxFailures: 3 });

  const doLoad = async () => {
    try {
      const csv = await fetchFIRMS();
      if (!Cesium || !viewer) return;

      // FIRMS returns CSV: latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
      const lines = csv.split("\n").slice(1); // skip header
      removeEntities("fire-");

      // Limit to 500 points for performance
      const maxPoints = 500;
      let count = 0;

      for (let i = 0; i < lines.length && count < maxPoints; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 10) continue;

        const lat = parseFloat(cols[0]);
        const lon = parseFloat(cols[1]);
        const confidence = parseFloat(cols[9]);
        const frp = parseFloat(cols[13]) || 0; // Fire Radiative Power
        const brightness = parseFloat(cols[2]) || 0;
        const daynight = cols[14]?.trim() || "D";

        if (isNaN(lat) || isNaN(lon)) continue;

        const colorStr = fireColor(confidence);
        const c = Cesium.Color.fromCssColorString(colorStr);

        viewer.entities.add({
          id: `fire-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          billboard: {
            image: FIRE_ICON,
            width: 14,
            height: 14,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.3),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1e7),
          },
          point: {
            pixelSize: confidence >= 80 ? 5 : 3,
            color: c,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
            outlineWidth: 1,
          },
          description: [
            `Active Fire Detection`,
            `Confidence: ${confidence}%`,
            `Brightness: ${brightness.toFixed(1)} K`,
            frp > 0 ? `Fire Radiative Power: ${frp.toFixed(1)} MW` : null,
            daynight === "N" ? "Night detection" : "Day detection",
            `Lat: ${lat.toFixed(3)}, Lon: ${lon.toFixed(3)}`,
            `Source: NASA FIRMS (VIIRS)`,
          ]
            .filter(Boolean)
            .join("\n"),
          properties: { type: "wildfire", confidence, frp },
        });
        count++;
      }

      updateStatus("wildfires", { lastUpdate: Date.now(), count });

      const iv = setInterval(async () => {
        if (!stateLayers.wildfires) return;
        removeEntities("fire-");
        doLoad();
      }, 21600000); // 6 hours
      intervalsRef.current.push(iv);
    } catch {
      retry.recordFailure();
      updateStatus("wildfires", { error: retry.shouldRetry ? `Retrying (${retry.failureCount}/3)...` : "Data unavailable" });
    }
  };

  doLoad();
}
