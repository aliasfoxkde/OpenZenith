import type { DataStatus } from "../types";
import { fetchVolcanoAlerts } from "../data-fetchers";

const VOLCANO_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2L2 20h20L12 2z" fill="#ff4444" opacity="0.8"/><ellipse cx="12" cy="20" rx="8" ry="2" fill="#ff4444" opacity="0.4"/><path d="M12 8v4M12 14v2" stroke="#ffcc00" stroke-width="2" stroke-linecap="round" opacity="0.9"/><circle cx="12" cy="7" r="3" fill="#ff6600" opacity="0.6"/></svg>`;

function alertColor(alert: string): string {
  switch (alert) {
    case "warning":
      return "#ff0000";
    case "watch":
      return "#ff8800";
    case "advisory":
      return "#ffcc00";
    default:
      return "#00cc44";
  }
}

function alertLabel(alert: string): string {
  switch (alert) {
    case "warning":
      return "WARNING";
    case "watch":
      return "WATCH";
    case "advisory":
      return "ADVISORY";
    default:
      return "NORMAL";
  }
}

export function loadVolcanoes(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { volcanoes: boolean },
) {
  updateStatus("volcanoes", { error: null });

  const doLoad = async () => {
    try {
      const data = await fetchVolcanoAlerts();
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      removeEntities("vol-");
      let count = 0;

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const props = f.properties || {};
        const coords = f.geometry?.coordinates;
        if (!coords) continue;

        const alert = props.alertLevel || props.alert_level || "normal";
        const colorStr = alertColor(alert);
        const c = Cesium.Color.fromCssColorString(colorStr);
        const name = props.title || props.name || "Unknown Volcano";

        // Skip normal/unknown status unless notable
        if (alert === "normal" || alert === "unknown") continue;

        viewer.entities.add({
          id: `vol-${i}`,
          name: name,
          position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
          billboard: {
            image: VOLCANO_ICON,
            width: 22,
            height: 22,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e7),
          },
          point: {
            pixelSize: 6,
            color: c,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
            outlineWidth: 1,
          },
          label: {
            text: name.substring(0, 25),
            font: "10px 'JetBrains Mono', monospace",
            fillColor: c.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(14, -10),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
          },
          description: [
            name,
            `Alert: ${alertLabel(alert)}`,
            props.url || null,
            coords ? `Lat: ${coords[1].toFixed(3)}, Lon: ${coords[0].toFixed(3)}` : null,
            `Source: USGS Volcano Hazards Program`,
          ]
            .filter(Boolean)
            .join("\n"),
          properties: { type: "volcano", alert, ...props },
        });

        // Pulsing ring for warning/watch
        if (alert === "warning" || alert === "watch") {
          viewer.entities.add({
            id: `vol-pulse-${i}`,
            position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
            ellipse: {
              semiMinorAxis: new Cesium.CallbackProperty(() => 15000 + 5000 * Math.sin(Date.now() / 800), false),
              semiMajorAxis: new Cesium.CallbackProperty(() => 15000 + 5000 * Math.sin(Date.now() / 800), false),
              material: new Cesium.ColorMaterialProperty({ color: c, transparent: true, alpha: 0.25 }),
            },
            properties: { type: "volcano-pulse" },
          });
        }
        count++;
      }

      updateStatus("volcanoes", { lastUpdate: Date.now(), count });

      const iv = setInterval(async () => {
        if (!stateLayers.volcanoes) return;
        try {
          const d = await fetchVolcanoAlerts();
          const fs = d.features || [];
          removeEntities("vol-");
          let c = 0;
          for (let j = 0; j < fs.length; j++) {
            const p = fs[j].properties || {};
            const a = p.alertLevel || p.alert_level || "normal";
            if (a === "normal" || a === "unknown") continue;
            c++;
          }
          // Re-add entities (simplified — full reload)
          const data2 = await fetchVolcanoAlerts();
          const feats = data2.features || [];
          removeEntities("vol-");
          let c2 = 0;
          for (let j = 0; j < feats.length; j++) {
            const f = feats[j];
            const pr = f.properties || {};
            const co = f.geometry?.coordinates;
            if (!co) continue;
            const al = pr.alertLevel || pr.alert_level || "normal";
            if (al === "normal" || al === "unknown") continue;
            const cs = alertColor(al);
            const cc = Cesium.Color.fromCssColorString(cs);
            const nm = pr.title || pr.name || "Unknown";
            viewer.entities.add({
              id: `vol-${j}`,
              name: nm,
              position: Cesium.Cartesian3.fromDegrees(co[0], co[1], 0),
              billboard: {
                image: VOLCANO_ICON,
                width: 22,
                height: 22,
                scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
              },
              point: { pixelSize: 6, color: cc, outlineColor: Cesium.Color.WHITE.withAlpha(0.4), outlineWidth: 1 },
              label: {
                text: nm.substring(0, 25),
                font: "10px 'JetBrains Mono', monospace",
                fillColor: cc.withAlpha(0.9),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(14, -10),
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
                backgroundPadding: new Cesium.Cartesian2(4, 2),
                scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
              },
              properties: { type: "volcano", alert: al },
            });
            c2++;
          }
          updateStatus("volcanoes", { lastUpdate: Date.now(), count: c2 });
        } catch {
          /* retry */
        }
      }, 1800000); // 30 min
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("volcanoes", { error: "fetch failed" });
    }
  };

  doLoad();
}
