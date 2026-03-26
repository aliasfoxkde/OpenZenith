import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchFlights, fetchFlightsAnonymous } from "../data-fetchers";

/**
 * OpenSky state vector field indices (for the array format returned by the API).
 * See: https://openskynetwork.github.io/opensky-api/rest.html#response-fields
 */
const SV = {
  ICAO24: 0,
  CALLSIGN: 1,
  ORIGIN_COUNTRY: 2,
  TIME_POSITION: 3,
  LAST_CONTACT: 4,
  LON: 5,
  LAT: 6,
  BARO_ALTITUDE: 7,
  ON_GROUND: 8,
  VELOCITY: 9,
  TRUE_TRACK: 10,
  VERTICAL_RATE: 11,
  SENSORS: 12,
  GEO_ALTITUDE: 13,
  SQUAWK: 14,
  SPI: 15,
  POSITION_SOURCE: 16,
  CATEGORY: 17,
} as const;

/** Map OpenSky aircraft category codes to human-readable labels */
const CATEGORY_LABELS: Record<string, string> = {
  "0": "No info", "1": "Light", "2": "Small", "3": "Large",
  "4": "High Vortex", "5": "Heavy", "6": "High Perf",
  "7": "Rotorcraft", "8": "Glider", "9": "Lighter-than-air",
  "A": "Parachute", "B": "UAV/Drone", "C": "Space",
  "D": "Emergency Surf.", "E": "Service", "F": "Point Obstacle",
};

/** Altitude-based color bands */
function altColor(alt: number, Cesium: any): any {
  if (alt < 3000) return Cesium.Color.LIME;
  if (alt < 10000) return Cesium.Color.YELLOW;
  if (alt < 15000) return Cesium.Color.CYAN;
  return Cesium.Color.RED;
}

export function loadFlights(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { flights: boolean },
  _entitiesRef?: React.MutableRefObject<Record<string, any>>,
) {
  updateStatus("flights", { error: null });

  // Cache last bbox to avoid redundant requests
  let lastBboxKey = "";
  const BBOX_CACHE_MS = 12000;

  const addFlightEntity = (s: any[], idx: number) => {
    const callsign = (s[SV.CALLSIGN] || "").trim();
    const alt = s[SV.BARO_ALTITUDE] || s[SV.GEO_ALTITUDE] || 0;
    const spd = s[SV.VELOCITY] || 0;
    const hdg = s[SV.TRUE_TRACK] || 0;
    const cat = s[SV.CATEGORY] || 0;
    const country = s[SV.ORIGIN_COUNTRY] || "";
    const vRate = s[SV.VERTICAL_RATE] || 0;
    const onGround = s[SV.ON_GROUND];
    const color = onGround ? Cesium.Color.GRAY : altColor(alt, Cesium);

    viewer.entities.add({
      id: `flight-${idx}`,
      name: callsign || `ICAO:${s[SV.ICAO24]}`,
      position: Cesium.Cartesian3.fromDegrees(s[SV.LON], s[SV.LAT], Math.max(alt, 0)),
      billboard: {
        image: ICONS.flight,
        width: 20,
        height: 20,
        rotation: Cesium.Math.toRadians(-hdg),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        color: color.withAlpha(0.9),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 2e6, 0.4),
      },
      label: callsign ? {
        text: callsign, font: "10px sans-serif", fillColor: Cesium.Color.WHITE.withAlpha(0.8),
        outlineColor: Cesium.Color.BLACK, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -8), verticalOrigin: Cesium.VerticalOrigin.CENTER,
        showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        backgroundPadding: new Cesium.Cartesian2(3, 2),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e5, 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
      } : undefined,
      properties: {
        type: "flight",
        callsign,
        altitude: alt,
        speed: spd,
        heading: hdg,
        country,
        category: cat,
        categoryLabel: CATEGORY_LABELS[String(cat)] || "Unknown",
        verticalRate: vRate,
      },
    });

    // Velocity vector for moving aircraft
    if (spd > 100 && hdg > 0 && !onGround) {
      const vecLen = Math.min(spd * 0.15, 8000);
      const hdgRad = Cesium.Math.toRadians(hdg);
      const dLat = vecLen * Math.cos(hdgRad) / 111320;
      const dLon = vecLen * Math.sin(hdgRad) / (111320 * Math.cos(Cesium.Math.toRadians(s[SV.LAT])));
      viewer.entities.add({
        id: `flight-vec-${idx}`,
        position: Cesium.Cartesian3.fromDegrees(s[SV.LON], s[SV.LAT], Math.max(alt, 0)),
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([s[SV.LON], s[SV.LAT], s[SV.LON] + dLon, s[SV.LAT] + dLat], Math.max(alt, 0), Math.max(alt, 0)),
          width: 1.5,
          material: color.withAlpha(0.4),
          clampToGround: false,
        },
        properties: { type: "flight-vec" },
      });
    }
  };

  const doLoad = async () => {
    try {
      // First load: try authenticated API with current camera view bbox
      let data: any;
      let authenticated = false;

      if (viewer) {
        const cam = viewer.camera.positionCartographic;
        if (cam) {
          const camH = cam.height;
          // Calculate bounding box based on camera altitude
          // At higher altitudes, show wider area; at lower, narrower
          const span = Math.min(camH * 0.8, 20);
          const spanDeg = span / 111320;
          const camLng = Cesium.Math.toDegrees(cam.longitude);
          const camLat = Cesium.Math.toDegrees(cam.latitude);
          const bbox = {
            lamin: +(camLat - spanDeg / 2).toFixed(2),
            lamax: +(camLat + spanDeg / 2).toFixed(2),
            lomin: +(camLng - spanDeg / 2).toFixed(2),
            lomax: +(camLng + spanDeg / 2).toFixed(2),
          };
          lastBboxKey = `${bbox.lamin},${bbox.lamax},${bbox.lomin},${bbox.lomax}`;

          try {
            data = await fetchFlights(bbox);
            authenticated = !data.error;
          } catch {
            // Fall back to anonymous
          }
        }
      }

      // Fallback to anonymous API
      if (!data || data.error) {
        data = await fetchFlightsAnonymous();
      }

      if (!Cesium || !viewer || !data.states) return;

      const states = data.states.filter((s: any[]) =>
        s[SV.LON] != null && s[SV.LAT] != null && !s[SV.ON_GROUND],
      );
      updateStatus("flights", { lastUpdate: Date.now(), count: states.length });
      states.forEach((s: any[], i: number) => addFlightEntity(s, i));

      // Refresh interval
      const iv = setInterval(async () => {
        if (!stateLayers.flights) return;

        try {
          // Recalculate bbox from current camera
          let newData: any;
          if (viewer) {
            const cam = viewer.camera.positionCartographic;
            if (cam) {
              const camH = cam.height;
              const span = Math.min(camH * 0.8, 20);
              const spanDeg = span / 111320;
              const camLng = Cesium.Math.toDegrees(cam.longitude);
              const camLat = Cesium.Math.toDegrees(cam.latitude);
              const bboxKey = `${(camLat - spanDeg / 2).toFixed(2)},${(camLat + spanDeg / 2).toFixed(2)},${(camLng - spanDeg / 2).toFixed(2)},${(camLng + spanDeg / 2).toFixed(2)}`;

              // Only re-fetch if camera moved significantly or cache expired
              if (bboxKey !== lastBboxKey || authenticated) {
                const bbox = {
                  lamin: +(camLat - spanDeg / 2).toFixed(2),
                  lamax: +(camLat + spanDeg / 2).toFixed(2),
                  lomin: +(camLng - spanDeg / 2).toFixed(2),
                  lomax: +(camLng + spanDeg / 2).toFixed(2),
                };
                lastBboxKey = bboxKey;

                try {
                  newData = await fetchFlights(bbox);
                } catch {
                  // Fall through to anonymous
                }
              }
            }
          }

          // Fall back to anonymous if auth failed
          if (!newData || newData.error) {
            newData = await fetchFlightsAnonymous();
          }

          if (newData.states) {
            removeEntities("flight-");
            newData.states
              .filter((s: any[]) => s[SV.LON] != null && s[SV.LAT] != null && !s[SV.ON_GROUND])
              .forEach((s: any[], i: number) => addFlightEntity(s, i));
            updateStatus("flights", {
              lastUpdate: Date.now(),
              count: newData.states.filter((s: any[]) => s[SV.LON] != null).length,
            });
          }
        } catch { /* retry next interval */ }
      }, 15000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("flights", { error: "fetch failed" });
    }
  };

  doLoad();
}
