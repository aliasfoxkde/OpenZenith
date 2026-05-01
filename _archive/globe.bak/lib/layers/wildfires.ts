/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { fetchFIRMS } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

/**
 * Fire icon SVG — used for billboard markers at close range.
 */
const FIRE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2c-1 4-4 6-4 10a4 4 0 008 0c0-4-3-6-4-10z" fill="#ff8800" opacity="0.9"/><path d="M12 8c-.5 2-2 3-2 5a2 2 0 004 0c0-2-1.5-3-2-5z" fill="#ffcc00" opacity="1"/></svg>`;

/**
 * Confidence-based color mapping.
 * Higher confidence = more intense red.
 */
function fireColor(confidence: number): string {
  if (confidence >= 80) return "#ff0000";
  if (confidence >= 50) return "#ff6600";
  if (confidence >= 30) return "#ff8800";
  return "#ffaa00";
}

/**
 * Fire Radiative Power → glow radius scaling.
 * FRP (MW) ranges from ~0 to ~3000+ for extreme fires.
 */
function frpToRadius(frp: number): number {
  // Log scale: 10MW → 25km, 100MW → 60km, 1000MW → 100km
  const base = 25000;
  const scale = 35000;
  return base + scale * Math.log10(Math.max(frp, 1) + 1);
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
      const maxPoints = 400;
      let count = 0;

      for (let i = 0; i < lines.length && count < maxPoints; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 10) continue;

        const lat = parseFloat(cols[0]);
        const lon = parseFloat(cols[1]);
        const confidence = parseFloat(cols[9]);
        const frp = parseFloat(cols[13]) || 0; // Fire Radiative Power (MW)
        const brightness = parseFloat(cols[2]) || 0;
        const daynight = cols[14]?.trim() || "D";

        if (isNaN(lat) || isNaN(lon)) continue;

        const colorStr = fireColor(confidence);
        const c = Cesium.Color.fromCssColorString(colorStr);
        const isHighConfidence = confidence >= 80;
        const glowRadius = frpToRadius(frp);

        // ─── Glow ellipse (thermal radiation visualization) ───
        viewer.entities.add({
          id: `fire-glow-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          ellipse: {
            semiMinorAxis: glowRadius,
            semiMajorAxis: glowRadius,
            material: new Cesium.ColorMaterialProperty({
              color: c.withAlpha(0.08),
            }),
            height: 0,
          },
          properties: { type: "wildfire-glow", confidence, frp },
        });

        // ─── Outer glow ring for high-confidence fires ───
        if (isHighConfidence) {
          viewer.entities.add({
            id: `fire-ring-${count}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            ellipse: {
              semiMinorAxis: glowRadius * 1.3,
              semiMajorAxis: glowRadius * 1.3,
              material: Cesium.Color.TRANSPARENT,
              outline: true,
              outlineColor: c.withAlpha(0.25),
              outlineWidth: 1,
              height: 0,
            },
            properties: { type: "wildfire-ring", confidence, frp },
          });
        }

        // ─── Billboard icon (close range) ───
        viewer.entities.add({
          id: `fire-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          billboard: {
            image: FIRE_ICON,
            width: isHighConfidence ? 16 : 12,
            height: isHighConfidence ? 16 : 12,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.3),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1e7),
          },
          // Bright center point
          point: {
            pixelSize: isHighConfidence ? 6 : 4,
            color: c,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
            outlineWidth: 1,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e7, 0.2),
          },
          description: [
            `🔥 Active Fire Detection`,
            `Confidence: ${confidence}%${isHighConfidence ? " ⚠️ HIGH" : ""}`,
            `Brightness: ${brightness.toFixed(1)} K`,
            frp > 0 ? `Fire Radiative Power: ${frp.toFixed(1)} MW` : null,
            `Glow Radius: ~${(glowRadius / 1000).toFixed(0)} km`,
            daynight === "N" ? "🌙 Night detection" : "☀️ Day detection",
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
      updateStatus("wildfires", {
        error: retry.shouldRetry ? `Retrying (${retry.failureCount}/3)...` : "Data unavailable",
      });
    }
  };

  doLoad();
}
