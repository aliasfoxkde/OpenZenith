/* eslint-disable @typescript-eslint/no-explicit-any */
import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { fetchWarnings, isAbort } from "../data-fetchers";;
import { createRetryGuard } from "../helpers";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

/**
 * Draws active US National Weather Service alerts: a live fetch of
 * `GET /api/weather/warnings`, which proxies
 * `https://api.weather.gov/alerts/active` as a GeoJSON FeatureCollection. Each
 * Polygon feature (other geometry types are ignored) yields up to three
 * entities in `viewer.entities` — a filled polygon (`warn-<i>`), a
 * ground-clamped dashed outline (`warn-border-<i>`) and a centroid label with a
 * severity glyph (`warn-label-<i>`). Severity comes from the event name:
 * tornado or "extreme" renders red with a tight dash, "severe"/"warning" orange,
 * and anything else yellow as a watch. Coordinates are degrees. A 300000 ms
 * (5 min) interval, registered through `pushLayerTimer` and gated on
 * `stateLayers.warnings`, refetches and rebuilds after clearing ids prefixed
 * `warn-`; failures pass through a five-failure retry guard into
 * `updateStatus("warnings")`.
 */
export function loadWarnings(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: LayerTimersRef,
  stateLayers: { warnings: boolean },
  signal?: AbortSignal,
) {
  updateStatus("warnings", { error: null });
  const retry = createRetryGuard();

  const addWarningEntity = (f: any, i: number) => {
    const et = (f.properties?.Event || "").toLowerCase();
    const severity =
      et.includes("tornado") || et.includes("extreme")
        ? "extreme"
        : et.includes("severe") || et.includes("warning")
          ? "warning"
          : "watch";
    const color =
      severity === "extreme" ? Cesium.Color.RED : severity === "warning" ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
    const outlineAlpha = severity === "extreme" ? 0.9 : severity === "warning" ? 0.6 : 0.3;
    const fillAlpha = severity === "extreme" ? 0.2 : 0.1;
    const outlineWidth = severity === "extreme" ? 2 : 1;

    if (f.geometry?.type === "Polygon") {
      const flat = f.geometry.coordinates.flat(10) as number[];
      const hierarchy = Cesium.Cartesian3.fromDegreesArray(flat);

      viewer.entities.add({
        id: `warn-${i}`,
        polygon: {
          hierarchy,
          material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: fillAlpha }),
          outline: false,
        },
        properties: { type: "warning" },
      });

      viewer.entities.add({
        id: `warn-border-${i}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: outlineWidth,
          material: new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(outlineAlpha),
            dashLength: severity === "extreme" ? 8 : 16,
          }),
          clampToGround: true,
        },
        properties: { type: "warning-border" },
      });

      if (flat.length >= 4) {
        const avgLon = flat.filter((_, idx) => idx % 2 === 0).reduce((a, b) => a + b, 0) / (flat.length / 2);
        const avgLat = flat.filter((_, idx) => idx % 2 === 1).reduce((a, b) => a + b, 0) / (flat.length / 2);
        const icon = severity === "extreme" ? "\u26A0" : severity === "warning" ? "\u25B2" : "\u25CB";
        viewer.entities.add({
          id: `warn-label-${i}`,
          position: Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 0),
          label: {
            text: `${icon} ${f.properties?.Event || ""}`,
            font: "bold 11px 'JetBrains Mono', monospace",
            fillColor: color.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(4, 3),
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 2e6, 0.3),
          },
          properties: { type: "warning-label" },
        });
      }
    }
  };

  const refresh = async () => {
    if (!stateLayers.warnings) return;
    try {
      const d = await fetchWarnings(signal);
      if (d.features) {
        removeEntities("warn-");
        d.features.forEach(addWarningEntity);
        updateStatus("warnings", { lastUpdate: Date.now(), count: d.features.length });
      }
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("warnings", err, "entity build");
      retry.recordFailure();
      updateStatus("warnings", {
        error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Warning data unavailable",
      });
    }
  };

  const doLoad = async () => {
    try {
      const data = await fetchWarnings(signal);
      if (!Cesium || !viewer || !data.features) return;
      updateStatus("warnings", { lastUpdate: Date.now(), count: data.features.length });
      data.features.forEach(addWarningEntity);

      const iv = setInterval(() => {
        void refresh();
      }, 300000);
      pushLayerTimer(intervalsRef, "warnings", iv);
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("warnings", err);
      updateStatus("warnings", {
        error: "fetch failed" });
    }
  };

  void doLoad();
}
