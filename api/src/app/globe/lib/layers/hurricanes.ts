import type { DataStatus } from "../types";
import { fetchHurricaneTracks } from "../data-fetchers";

export function loadHurricanes(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
) {
  updateStatus("hurricaneTracks", { error: null });

  const doLoad = async () => {
    try {
      const csv = await fetchHurricaneTracks();
      if (!Cesium || !viewer) return;
      const lines = csv.split("\n").slice(1);
      const storms: Record<string, any[]> = {};
      const CAT_COLORS: Record<string, string> = { TS: "#00aaff", Cat1: "#ffff00", Cat2: "#ffcc00", Cat3: "#ff8800", Cat4: "#ff4400", Cat5: "#ff0000", SD: "#666", SS: "#888", TD: "#aaa", EX: "#ccc" };

      for (const line of lines) {
        const p = line.split(",");
        if (p.length < 10) continue;
        const sid = p[0]?.trim();
        const name = p[8]?.trim();
        const lat = parseFloat(p[6]);
        const lon = parseFloat(p[7]);
        const cat = p[10]?.trim() || "TS";
        if (isNaN(lat) || isNaN(lon)) continue;
        if (!storms[sid]) storms[sid] = [];
        storms[sid].push({ coordinates: [lon, lat], cat, name, color: CAT_COLORS[cat] || "#aaa" });
      }

      let count = 0;
      for (const [, track] of Object.entries(storms)) {
        if (track.length < 2) continue;
        const positions = track.map((pt: any) => Cesium.Cartesian3.fromDegrees(pt.coordinates[0], pt.coordinates[1]));
        const lastPt = track[track.length - 1];
        const color = Cesium.Color.fromCssColorString(lastPt.color);
        const stormName = lastPt.name || "Unnamed";

        viewer.entities.add({
          id: `storm-${count}`,
          polyline: { positions, width: 3, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.15, color }) },
          properties: { type: "storm" },
        });

        viewer.entities.add({
          id: `storm-label-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lastPt.coordinates[0], lastPt.coordinates[1]),
          label: {
            text: stormName, font: "bold 12px 'JetBrains Mono', monospace",
            fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.3),
          },
          point: { pixelSize: 8, color, outlineColor: Cesium.Color.WHITE.withAlpha(0.5), outlineWidth: 2 },
          properties: { type: "storm-marker" },
        });

        // Animated spiral arms
        const spiralCount = 3;
        for (let arm = 0; arm < spiralCount; arm++) {
          const armOffset = (arm * 2 * Math.PI) / spiralCount;
          const spiralPositions: any[] = [];
          const steps = 30;
          for (let s = 0; s < steps; s++) {
            const angle = armOffset + (s / steps) * Math.PI * 2;
            const radius = (s / steps) * 200000;
            const lat = lastPt.coordinates[1] + (radius * Math.cos(angle)) / 111320;
            const lon = lastPt.coordinates[0] + (radius * Math.sin(angle)) / (111320 * Math.cos(Cesium.Math.toRadians(lastPt.coordinates[1])));
            spiralPositions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
          }
          viewer.entities.add({
            id: `storm-spiral-${count}-${arm}`,
            polyline: {
              positions: spiralPositions, width: 2,
              material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: color.withAlpha(0.4) }),
            },
            properties: { type: "storm-spiral" },
          });
        }

        // Wind extent ring
        viewer.entities.add({
          id: `storm-ring-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lastPt.coordinates[0], lastPt.coordinates[1]),
          ellipse: {
            semiMinorAxis: 300000, semiMajorAxis: 300000,
            material: Cesium.Color.TRANSPARENT,
            outline: true, outlineColor: color.withAlpha(0.3), outlineWidth: 1,
          },
          properties: { type: "storm-ring" },
        });

        count++;
      }
      updateStatus("hurricaneTracks", { lastUpdate: Date.now(), count });
    } catch { updateStatus("hurricaneTracks", { error: "fetch failed" }); }
  };

  doLoad();
}
