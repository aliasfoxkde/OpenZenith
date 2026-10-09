import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { fetchAirmets, fetchSigmets, isAbort } from "../data-fetchers";
import { createRetryGuard } from "../helpers";
import { svgIcon } from "../svg-icon";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

const SIGMET_COLOR = "#ff0000";
const AIRMET_COLOR = "#ff8800";

const AVIATION_ICON = svgIcon(
  `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2L2 20h20L12 2z" fill="none" stroke="#ff4444" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="#ff4444">!</text></svg>`,
);

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
      // bounds: both regexes have capture groups 1-2, which always exist on a
      // successful match
      const lat = parseInt(latMatch[1]!) / 100;
      const lon = parseInt(lonMatch[1]!) / 100;
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

/** Normalize the aviationweather.gov response — a bare array today, but the
 * shape has varied ({features}, {data}) — to a list of feature objects. */
function asSigmetList(data: unknown): SigmetFeature[] {
  let list: unknown = data;
  if (!Array.isArray(data) && typeof data === "object" && data !== null) {
    const wrapper = data as { features?: unknown; data?: unknown };
    list = wrapper.features ?? wrapper.data;
  }
  return Array.isArray(list) ? list.filter((x): x is SigmetFeature => typeof x === "object" && x !== null) : [];
}

/**
 * Renders active SIGMETs and AIRMETs from aviationweather.gov, fetched live
 * through /api/proxy via fetchSigmets/fetchAirmets. Coordinates are parsed
 * out of each bulletin's raw text (DDMM.N N/S, DDDMM.N E/W, degrees); three
 * or more points draw a translucent hazard polygon (SIGMET #ff0000 at 0.15
 * alpha, AIRMET #ff8800 at 0.1) plus a centered entity with the hazard label
 * and the raw bulletin (truncated to 300 chars) in the tooltip. Adds
 * `sigmet-`/`sigmet-pt-` and `airmet-`/`airmet-pt-` entities to
 * viewer.entities and returns void. The two feeds fail independently;
 * refresh runs every 5 min (300000 ms) under "aviationWeather" while
 * stateLayers.aviationWeather holds, with a 5-attempt retry guard surfacing
 * progress in the status message.
 */
export function loadAviationWeather(
  viewer: CesiumType.Viewer | undefined,
  Cesium: typeof CesiumType | undefined,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: LayerTimersRef,
  stateLayers: { aviationWeather: boolean },
  signal?: AbortSignal,
) {
  updateStatus("aviationWeather", { error: null });
  const retry = createRetryGuard();

  const addSigmet = (s: SigmetFeature, i: number) => {
    if (!viewer || !Cesium) return;
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
      name: hazard,
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
    if (!viewer || !Cesium) return;
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
      name: hazard,
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
        const sigmets = asSigmetList(await fetchSigmets(signal));
        sigmets.forEach((s, i) => {
          addSigmet(s, i);
        });
        total += sigmets.length;
      } catch {
        /* sigmets optional */
      }

      // Fetch AIRMETs
      try {
        const airmets = asSigmetList(await fetchAirmets(signal));
        airmets.forEach((a, i) => {
          addAirmet(a, i);
        });
        total += airmets.length;
      } catch {
        /* airmets optional */
      }

      updateStatus("aviationWeather", { lastUpdate: Date.now(), count: total });

      const iv = setInterval(() => {
        void (async () => {
          if (!stateLayers.aviationWeather) return;
          try {
            removeEntities("sigmet-");
            removeEntities("airmet-");
            // viewer/Cesium are narrowed by doLoad's guard before this
            // closure is created (both are load-time captures, never re-read).
            const sigmets = asSigmetList(await fetchSigmets(signal));
            const airmets = asSigmetList(await fetchAirmets(signal));
            let t = 0;
            sigmets.forEach((s, i) => {
              addSigmet(s, i);
              t++;
            });
            airmets.forEach((a, i) => {
              addAirmet(a, i);
              t++;
            });
            updateStatus("aviationWeather", { lastUpdate: Date.now(), count: t });
          } catch (err) {
            if (isAbort(err)) return; // teardown, not a failure
            warnLayerError("aviationWeather", err, "entity build");
            retry.recordFailure();
            updateStatus("aviationWeather", {
              error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Aviation weather unavailable",
            });
          }
        })();
      }, 300000); // 5 min
      pushLayerTimer(intervalsRef, "aviationWeather", iv);
    } catch {
      updateStatus("aviationWeather", { error: "fetch failed" });
    }
  };

  void doLoad();
}
