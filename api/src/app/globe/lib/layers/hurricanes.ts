import type { DataStatus } from "../types";
import { fetchHurricaneTracks } from "../data-fetchers";

/**
 * Saffir-Simpson Hurricane Wind Scale colors.
 * Full category set from Tropical Depression to Category 5.
 */
const SS_COLORS: Record<string, string> = {
  TD: "#888888",  // Tropical Depression
  TS: "#00aaff",  // Tropical Storm
  STS: "#00aaff", // Sub-Tropical Storm
  Cat1: "#ffff00", // Category 1
  Cat2: "#ffcc00", // Category 2
  Cat3: "#ff8800", // Category 3
  Cat4: "#ff4400", // Category 4
  Cat5: "#ff0000", // Category 5
  SD: "#666666",  // Subtropical Depression
  SS: "#888888",  // Subtropical Storm
  EX: "#aaaaaa",  // Extratropical
  HU: "#ff6600",  // Hurricane (generic)
};

/** Category order for determining max intensity */
const CAT_ORDER: Record<string, number> = {
  TD: 0, SD: 1, TS: 2, STS: 2, SS: 2, Cat1: 3, Cat2: 4, Cat3: 5, Cat4: 6, Cat5: 7, HU: 5, EX: 0,
};

/** Storm intensity classification from category code */
function stormIntensity(cat: string): string {
  if (cat.startsWith("Cat")) return cat;
  return cat;
}

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

      for (const line of lines) {
        const p = line.split(",");
        if (p.length < 10) continue;
        const sid = p[0]?.trim();
        const name = p[8]?.trim();
        const lat = parseFloat(p[6]);
        const lon = parseFloat(p[7]);
        const cat = p[10]?.trim() || "TS";
        const season = p[1]?.trim();
        if (isNaN(lat) || isNaN(lon)) continue;
        if (!storms[sid]) storms[sid] = [];
        storms[sid].push({
          coordinates: [lon, lat],
          cat,
          name: name || "Unnamed",
          color: SS_COLORS[cat] || "#aaa",
          season,
        });
      }

      let count = 0;

      for (const [, track] of Object.entries(storms)) {
        if (track.length < 2) continue;
        const positions = track.map((pt: any) =>
          Cesium.Cartesian3.fromDegrees(pt.coordinates[0], pt.coordinates[1]),
        );
        const lastPt = track[track.length - 1];
        const maxCat = track.reduce((best: string, pt: any) =>
          (CAT_ORDER[pt.cat] || 0) > (CAT_ORDER[best] || 0) ? pt.cat : best,
        );
        const color = Cesium.Color.fromCssColorString(SS_COLORS[maxCat] || lastPt.color);
        const stormName = lastPt.name || "Unnamed";
        const isCat3Plus = CAT_ORDER[maxCat] >= 5;

        // ─── Track history dots (color-coded by category) ───
        // Place dots at 6-hour intervals (IBTrACS is ~6h resolution)
        const dotInterval = Math.max(1, Math.floor(track.length / 40));
        for (let i = 0; i < track.length; i += dotInterval) {
          const pt = track[i];
          const ptColor = Cesium.Color.fromCssColorString(SS_COLORS[pt.cat] || "#aaa");
          viewer.entities.add({
            id: `storm-dot-${count}-${i}`,
            position: Cesium.Cartesian3.fromDegrees(pt.coordinates[0], pt.coordinates[1]),
            point: {
              pixelSize: 5,
              color: ptColor.withAlpha(0.7),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
              outlineWidth: 1,
              scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 5e7, 0.3),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
            },
            properties: { type: "storm-dot", cat: pt.cat },
          });
        }

        // ─── Track line with glow ───
        viewer.entities.add({
          id: `storm-${count}`,
          polyline: {
            positions,
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color,
            }),
          },
          properties: { type: "storm" },
        });

        // ─── Storm label at latest position ───
        viewer.entities.add({
          id: `storm-label-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lastPt.coordinates[0], lastPt.coordinates[1]),
          label: {
            text: `${stormName} [${maxCat}]`,
            font: "bold 12px 'JetBrains Mono', monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.3),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
          },
          point: {
            pixelSize: 8,
            color,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
            outlineWidth: 2,
          },
          properties: { type: "storm-marker" },
        });

        // ─── Animated spiral arms (rotating via CallbackProperty) ───
        const spiralCount = 3;
        const spiralArmRefs: any[] = [];
        for (let arm = 0; arm < spiralCount; arm++) {
          const armOffset = (arm * 2 * Math.PI) / spiralCount;
          const steps = 40;
          const maxRadius = isCat3Plus ? 350000 : 200000;

          const spiralPositions = new Cesium.CallbackProperty((time: any) => {
            const rotation = Cesium.JulianDate.secondsDifference(time, Cesium.JulianDate.now());
            const rotAngle = rotation * 0.3; // ~0.3 rad/sec rotation speed

            const pts: any[] = [];
            for (let s = 0; s < steps; s++) {
              const angle = armOffset + (s / steps) * Math.PI * 2 + rotAngle;
              const radius = (s / steps) * maxRadius;
              const lat = lastPt.coordinates[1] + (radius * Math.cos(angle)) / 111320;
              const lon = lastPt.coordinates[0] + (radius * Math.sin(angle)) / (111320 * Math.cos(Cesium.Math.toRadians(lastPt.coordinates[1])));
              pts.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
            }
            return pts;
          });

          const entity = viewer.entities.add({
            id: `storm-spiral-${count}-${arm}`,
            polyline: {
              positions: spiralPositions,
              width: 2,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: color.withAlpha(0.4),
              }),
            },
            properties: { type: "storm-spiral" },
          });
          spiralArmRefs.push(entity);
        }

        // ─── Eye wall for Cat3+ storms ───
        if (isCat3Plus) {
          viewer.entities.add({
            id: `storm-eye-${count}`,
            position: Cesium.Cartesian3.fromDegrees(lastPt.coordinates[0], lastPt.coordinates[1]),
            ellipse: {
              semiMinorAxis: 40000,
              semiMajorAxis: 40000,
              material: Cesium.Color.fromCssColorString("#000000").withAlpha(0.6),
              outline: true,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
              outlineWidth: 2,
              height: 0,
            },
            properties: { type: "storm-eye" },
          });
        }

        // ─── Wind extent ring ───
        viewer.entities.add({
          id: `storm-ring-${count}`,
          position: Cesium.Cartesian3.fromDegrees(lastPt.coordinates[0], lastPt.coordinates[1]),
          ellipse: {
            semiMinorAxis: 300000,
            semiMajorAxis: 300000,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: color.withAlpha(0.3),
            outlineWidth: 1,
          },
          properties: { type: "storm-ring" },
        });

        count++;
      }

      updateStatus("hurricaneTracks", { lastUpdate: Date.now(), count });
    } catch {
      updateStatus("hurricaneTracks", { error: "fetch failed" });
    }
  };

  doLoad();
}
