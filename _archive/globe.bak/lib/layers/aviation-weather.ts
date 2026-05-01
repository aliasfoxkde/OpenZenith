/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { fetchSigmets, fetchAirmets } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

const SIGMET_COLOR = "#ff0000";
const AIRMET_COLOR = "#ff8800";

const AVIATION_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2L2 20h20L12 2z" fill="none" stroke="#ff4444" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="#ff4444">!</text></svg>`;

function parseCoordinates(raw: string): [number, number][] {
  if (!raw) return [];
  const points: [number, number][] = [];
  // Handle various coordinate formats from aviation weather
  const parts = raw.split(/\s+/);
  for (const part of parts) {
    // Try DD-MM.N format
    const latMatch = part.match(/(\d{4,6})([NS])/);
    const lonMatch = part.match(/(\d{5,7})([EW])/);
    if (latMatch && lonMatch) {
      const lat = parseInt(latMatch[1]) / 100;
      const lon = parseInt(lonMatch[1]) / 100;
      points.push([latMatch[2] === "S" ? -lat : lat, lonMatch[2] === "W" ? -lon : lon]);
    }
  }
  return points;
}

interface SigmetFeature {
  raw_text?: string;
  hazard?: string;
  hazard_type?: string;
  start_time?: string;
  end_time?: string;
  valid_time_from?: string;
  valid_time_to?: string;
}

export function loadAviationWeather(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { aviationWeather: boolean },
) {
  updateStatus("aviationWeather", { error: null });
  const retry = createRetryGuard();

  const addSigmet = (s: SigmetFeature, i: number) => {
    const raw = s.raw_text || s.hazard || "";
    const coords = parseCoordinates(raw);
    if (coords.length === 0) return;

    const c = Cesium.Color.fromCssColorString(SIGMET_COLOR);
    const hazard = s.hazard_type || s.hazard || "SIGMET";
    const startTime = s.start_time || s.valid_time_from || "";
    const endTime = s.end_time || s.valid_time_to || "";

    // If we have polygon coords, draw polygon; otherwise point
    if (coords.length >= 3) {
      viewer.entities.add({
        id: `sigmet-${i}`,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(coords.flat()),
          material: c.withAlpha(0.15),
          outline: true,
          outlineColor: c.withAlpha(0.5),
          height: 0,
        },
        properties: { type: "sigmet-polygon" },
      });
    }

    // Center point with label
    const centerLat = coords.reduce((s, p) => s + p[0], 0) / coords.length;
    const centerLon = coords.reduce((s, p) => s + p[1], 0) / coords.length;

    viewer.entities.add({
      id: `sigmet-pt-${i}`,
      name: `${hazard}`,
      position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0),
      billboard: {
        image: AVIATION_ICON,
        width: 18,
        height: 18,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.2, 1e7, 0.3),
      },
      label: {
        text: hazard.replace(/_/g, " ").substring(0, 20),
        font: "9px 'JetBrains Mono', monospace",
        fillColor: c.withAlpha(0.9),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(12, -8),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
        backgroundPadding: new Cesium.Cartesian2(3, 2),
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
      },
      description: [
        `SIGMET — ${hazard}`,
        raw.substring(0, 300),
        startTime ? `From: ${startTime}` : null,
        endTime ? `To: ${endTime}` : null,
        `Source: NOAA Aviation Weather Center`,
      ]
        .filter(Boolean)
        .join("\n"),
      properties: { type: "sigmet" },
    });
  };

  const addAirmet = (a: SigmetFeature, i: number) => {
    const raw = a.raw_text || a.hazard || "";
    const coords = parseCoordinates(raw);
    if (coords.length === 0) return;

    const c = Cesium.Color.fromCssColorString(AIRMET_COLOR);
    const hazard = a.hazard_type || a.hazard || "AIRMET";

    if (coords.length >= 3) {
      viewer.entities.add({
        id: `airmet-${i}`,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(coords.flat()),
          material: c.withAlpha(0.1),
          outline: true,
          outlineColor: c.withAlpha(0.3),
          height: 0,
        },
        properties: { type: "airmet-polygon" },
      });
    }

    const centerLat = coords.reduce((s, p) => s + p[0], 0) / coords.length;
    const centerLon = coords.reduce((s, p) => s + p[1], 0) / coords.length;

    viewer.entities.add({
      id: `airmet-pt-${i}`,
      name: `${hazard}`,
      position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0),
      point: {
        pixelSize: 5,
        color: c,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
        outlineWidth: 1,
      },
      label: {
        text: hazard.replace(/_/g, " ").substring(0, 20),
        font: "9px 'JetBrains Mono', monospace",
        fillColor: c.withAlpha(0.9),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -8),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
        backgroundPadding: new Cesium.Cartesian2(3, 2),
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
      },
      description: [`AIRMET — ${hazard}`, raw.substring(0, 300), `Source: NOAA Aviation Weather Center`]
        .filter(Boolean)
        .join("\n"),
      properties: { type: "airmet" },
    });
  };

  const doLoad = async () => {
    try {
      removeEntities("sigmet-");
      removeEntities("airmet-");
      if (!Cesium || !viewer) return;

      let total = 0;

      // Fetch SIGMETs
      try {
        const sigmetData = await fetchSigmets();
        const sigmets = Array.isArray(sigmetData) ? sigmetData : sigmetData?.features || sigmetData?.data || [];
        (Array.isArray(sigmets) ? sigmets : []).forEach((s: any, i: number) => addSigmet(s, i));
        total += (Array.isArray(sigmets) ? sigmets : []).length;
      } catch {
        /* sigmets optional */
      }

      // Fetch AIRMETs
      try {
        const airmetData = await fetchAirmets();
        const airmets = Array.isArray(airmetData) ? airmetData : airmetData?.features || airmetData?.data || [];
        (Array.isArray(airmets) ? airmets : []).forEach((a: any, i: number) => addAirmet(a, i));
        total += (Array.isArray(airmets) ? airmets : []).length;
      } catch {
        /* airmets optional */
      }

      updateStatus("aviationWeather", { lastUpdate: Date.now(), count: total });

      const iv = setInterval(async () => {
        if (!stateLayers.aviationWeather) return;
        try {
          removeEntities("sigmet-");
          removeEntities("airmet-");
          if (!Cesium || !viewer) return;
          const sd = await fetchSigmets();
          const ad = await fetchAirmets();
          let t = 0;
          (Array.isArray(sd) ? sd : []).forEach((s: any, i: number) => {
            addSigmet(s, i);
            t++;
          });
          (Array.isArray(ad) ? ad : []).forEach((a: any, i: number) => {
            addAirmet(a, i);
            t++;
          });
          updateStatus("aviationWeather", { lastUpdate: Date.now(), count: t });
        } catch {
          retry.recordFailure();
          updateStatus("aviationWeather", {
            error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Aviation weather unavailable",
          });
        }
      }, 300000); // 5 min
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("aviationWeather", { error: "fetch failed" });
    }
  };

  doLoad();
}
