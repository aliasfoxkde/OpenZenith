import type { DataStatus } from "../types";
import { fetchWarnings } from "../data-fetchers";

export function loadWarnings(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { warnings: boolean },
) {
  updateStatus("warnings", { error: null });

  const addWarningEntity = (f: any, i: number) => {
    const et = (f.properties?.Event || "").toLowerCase();
    const severity = et.includes("tornado") || et.includes("extreme") ? "extreme"
      : et.includes("severe") || et.includes("warning") ? "warning"
      : "watch";
    const color = severity === "extreme" ? Cesium.Color.RED
      : severity === "warning" ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
    const outlineAlpha = severity === "extreme" ? 0.9 : severity === "warning" ? 0.6 : 0.3;
    const fillAlpha = severity === "extreme" ? 0.2 : 0.1;
    const outlineWidth = severity === "extreme" ? 2 : 1;

    if (f.geometry?.type === "Polygon") {
      const flat = f.geometry.coordinates.flat(10) as number[];
      const hierarchy = Cesium.Cartesian3.fromDegreesArray(flat);

      viewer.entities.add({
        id: `warn-${i}`,
        polygon: { hierarchy, material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: fillAlpha }), outline: false },
        properties: { type: "warning" },
      });

      viewer.entities.add({
        id: `warn-border-${i}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: outlineWidth,
          material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(outlineAlpha), dashLength: severity === "extreme" ? 8 : 16 }),
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
            outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(4, 3),
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 2e6, 0.3),
          },
          properties: { type: "warning-label" },
        });
      }
    }
  };

  const doLoad = async () => {
    try {
      const data = await fetchWarnings();
      if (!Cesium || !viewer || !data.features) return;
      updateStatus("warnings", { lastUpdate: Date.now(), count: data.features.length });
      data.features.forEach(addWarningEntity);

      const iv = setInterval(async () => {
        if (!stateLayers.warnings) return;
        try {
          const d = await fetchWarnings();
          if (d.features) { removeEntities("warn-"); d.features.forEach(addWarningEntity); updateStatus("warnings", { lastUpdate: Date.now(), count: d.features.length }); }
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("warnings", { error: "fetch failed" }); }
  };

  doLoad();
}
