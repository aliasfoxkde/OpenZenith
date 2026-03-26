import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchEarthquakes } from "../data-fetchers";

export function loadEarthquakes(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { earthquakes: boolean },
) {
  updateStatus("earthquakes", { error: null });

  const addQuakeEntity = (f: any, i: number) => {
    const coords = f.geometry?.coordinates;
    if (!coords) return;
    const props = f.properties || {};
    const mag = props.mag || 0;
    const depth = props.depth || 0;
    const time = props.time || 0;
    const place = props.place || "";
    const felt = props.felt || 0;
    const mmi = props.mmi || 0;
    const alert = props.alert || "green";
    const tsunami = props.tsunami || 0;
    const sig = props.sig || 0;
    const type = props.type || "earthquake";

    const now = Date.now();
    const ageHours = (now - time) / 3600000;

    // Color by depth (shallow = more dangerous)
    const depthColor = depth < 10 ? Cesium.Color.RED : depth < 70 ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
    // Color by magnitude
    const magColor = mag >= 7 ? Cesium.Color.RED : mag >= 5 ? Cesium.Color.ORANGE : mag >= 3 ? Cesium.Color.YELLOW : Cesium.Color.LIME;
    const color = depth < 10 ? depthColor : magColor;

    // Alert-based outline emphasis
    const alertOutline = alert === "red" ? Cesium.Color.RED
      : alert === "orange" ? Cesium.Color.ORANGE
      : alert === "yellow" ? Cesium.Color.YELLOW
      : Cesium.Color.WHITE.withAlpha(0.3);

    const baseSize = Math.max(3000, mag * 8000);

    // ─── Main ellipse ───
    viewer.entities.add({
      id: `eq-${i}`,
      name: `${type === "earthquake" ? "EQ" : type.toUpperCase()} ${mag.toFixed(1)}`,
      position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          const pulse = ageHours < 2 ? 1 + 0.15 * Math.sin(Date.now() / 600) : 1;
          return baseSize * pulse;
        }, false),
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          const pulse = ageHours < 2 ? 1 + 0.15 * Math.sin(Date.now() / 600) : 1;
          return baseSize * pulse;
        }, false),
        material: new Cesium.ColorMaterialProperty({
          color,
          transparent: true,
          alpha: ageHours < 2 ? 0.5 : 0.35,
        }),
        outline: alert !== "green",
        outlineColor: alertOutline.withAlpha(0.8),
        outlineWidth: alert !== "green" ? 2 : 0,
      },
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const base = Math.max(4, mag * 1.5);
          return ageHours < 2 ? base * (1 + 0.2 * Math.sin(Date.now() / 400)) : base;
        }, false),
        color,
        outlineColor: alertOutline,
        outlineWidth: alert !== "green" ? 2 : 1,
      },
      // ─── Magnitude label for M4+ ───
      label: mag >= 4 ? {
        text: `M${mag.toFixed(1)}`,
        font: `${mag >= 6 ? "bold 14px" : mag >= 5 ? "bold 12px" : "11px"} 'JetBrains Mono', monospace`,
        fillColor: color.withAlpha(0.95),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1e7, 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1e7),
      } : undefined,
      // ─── Enhanced tooltip ───
      description: [
        `${type === "earthquake" ? "Earthquake" : type} — M${mag.toFixed(1)}`,
        place,
        `Depth: ${depth.toFixed(1)} km`,
        mmi > 0 ? `MMI: ${mmi} (${mmiToLabel(mmi)})` : null,
        felt > 0 ? `Felt by ${felt} people` : null,
        tsunami ? "TSUNAMI ALERT" : null,
        alert !== "green" ? `Alert: ${alert.toUpperCase()}` : null,
        `Significance: ${sig}`,
      ].filter(Boolean).join("\n"),
      properties: { type: "earthquake", ...props },
    });

    // ─── Expanding ring for M5+ ───
    if (mag >= 5.0) {
      viewer.entities.add({
        id: `eq-ring-${i}`,
        position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty(() => {
            return baseSize * 1.8 + 3000 * Math.sin(Date.now() / 1200);
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty(() => {
            return baseSize * 1.8 + 3000 * Math.sin(Date.now() / 1200);
          }, false),
          material: new Cesium.ColorMaterialProperty({ color: Cesium.Color.WHITE, transparent: true, alpha: 0.12 }),
          outline: true,
          outlineColor: color.withAlpha(0.3),
          outlineWidth: 1,
        },
        properties: { type: "earthquake-ring" },
      });
    }

    // ─── Felt radius for widely felt quakes (felt > 10) ───
    if (felt > 10) {
      const feltRadius = Math.min(felt * 2000, 300000); // Scale felt count to meters, cap at 300km
      viewer.entities.add({
        id: `eq-felt-${i}`,
        position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
        ellipse: {
          semiMinorAxis: feltRadius,
          semiMajorAxis: feltRadius,
          material: Cesium.Color.fromCssColorString("#4488ff").withAlpha(0.08),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#4488ff").withAlpha(0.25),
          outlineWidth: 1,
        },
        properties: { type: "earthquake-felt" },
      });
    }
  };

  const doLoad = async () => {
    try {
      const data = await fetchEarthquakes();
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("earthquakes", { lastUpdate: Date.now(), count: features.length });
      features.forEach((f: any, i: number) => addQuakeEntity(f, i));

      const iv = setInterval(async () => {
        if (!stateLayers.earthquakes) return;
        try {
          const d = await fetchEarthquakes();
          removeEntities("eq-");
          const fs = d.features || [];
          fs.forEach((f: any, i: number) => addQuakeEntity(f, i));
          updateStatus("earthquakes", { lastUpdate: Date.now(), count: fs.length });
        } catch { /* retry */ }
      }, 60000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("earthquakes", { error: "fetch failed" }); }
  };

  doLoad();
}

/** Convert MMI intensity to human-readable label */
function mmiToLabel(mmi: number): string {
  if (mmi <= 1) return "Not felt";
  if (mmi <= 2) return "Weak";
  if (mmi <= 3) return "Weak";
  if (mmi <= 4) return "Light";
  if (mmi <= 5) return "Moderate";
  if (mmi <= 6) return "Strong";
  if (mmi <= 7) return "Very Strong";
  if (mmi <= 8) return "Severe";
  if (mmi <= 9) return "Violent";
  return "Extreme";
}
