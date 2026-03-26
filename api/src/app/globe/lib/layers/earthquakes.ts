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

  const doLoad = async () => {
    try {
      const data = await fetchEarthquakes();
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("earthquakes", { lastUpdate: Date.now(), count: features.length });
      const now = Date.now();

      features.forEach((f: any, i: number) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return;
        const mag = f.properties?.mag || 0;
        const depth = f.properties?.depth || 0;
        const time = f.properties?.time || 0;
        const ageHours = (now - time) / 3600000;

        const depthColor = depth < 10 ? Cesium.Color.RED : depth < 70 ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
        const magColor = mag >= 7 ? Cesium.Color.RED : mag >= 5 ? Cesium.Color.ORANGE : mag >= 3 ? Cesium.Color.YELLOW : Cesium.Color.LIME;
        const color = depth < 10 ? depthColor : magColor;

        viewer.entities.add({
          id: `eq-${i}`,
          name: `EQ ${mag.toFixed(1)}`,
          position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
          ellipse: {
            semiMinorAxis: new Cesium.CallbackProperty(() => {
              const base = Math.max(3000, mag * 8000);
              const pulse = ageHours < 2 ? 1 + 0.15 * Math.sin(Date.now() / 600) : 1;
              return base * pulse;
            }, false),
            semiMajorAxis: new Cesium.CallbackProperty(() => {
              const base = Math.max(3000, mag * 8000);
              const pulse = ageHours < 2 ? 1 + 0.15 * Math.sin(Date.now() / 600) : 1;
              return base * pulse;
            }, false),
            material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: ageHours < 2 ? 0.5 : 0.35 }),
          },
          point: {
            pixelSize: new Cesium.CallbackProperty(() => {
              const base = Math.max(4, mag * 1.5);
              return ageHours < 2 ? base * (1 + 0.2 * Math.sin(Date.now() / 400)) : base;
            }, false),
            color, outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
          },
          properties: { type: "earthquake", ...f.properties },
        });

        if (mag >= 5.0) {
          viewer.entities.add({
            id: `eq-ring-${i}`,
            position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
            ellipse: {
              semiMinorAxis: new Cesium.CallbackProperty(() => {
                const base = Math.max(3000, mag * 8000) * 1.8;
                return base + 3000 * Math.sin(Date.now() / 1200);
              }, false),
              semiMajorAxis: new Cesium.CallbackProperty(() => {
                const base = Math.max(3000, mag * 8000) * 1.8;
                return base + 3000 * Math.sin(Date.now() / 1200);
              }, false),
              material: new Cesium.ColorMaterialProperty({ color: Cesium.Color.WHITE, transparent: true, alpha: 0.12 }),
              outline: true,
              outlineColor: color.withAlpha(0.3),
              outlineWidth: 1,
            },
            properties: { type: "earthquake-ring" },
          });
        }
      });

      const iv = setInterval(async () => {
        if (!stateLayers.earthquakes) return;
        try {
          const d = await fetchEarthquakes();
          removeEntities("eq-");
          const refreshNow = Date.now();
          (d.features || []).forEach((f: any, i: number) => {
            const c = f.geometry?.coordinates;
            if (!c) return;
            const m = f.properties?.mag || 0;
            const dp = f.properties?.depth || 0;
            const tm = f.properties?.time || 0;
            const age = (refreshNow - tm) / 3600000;
            const dc = dp < 10 ? Cesium.Color.RED : dp < 70 ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
            const mc = m >= 7 ? Cesium.Color.RED : m >= 5 ? Cesium.Color.ORANGE : Cesium.Color.YELLOW;
            const col = dp < 10 ? dc : mc;
            viewer.entities.add({ id: `eq-${i}`, position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0), ellipse: { semiMinorAxis: Math.max(3000, m * 8000), semiMajorAxis: Math.max(3000, m * 8000), material: new Cesium.ColorMaterialProperty({ color: col, transparent: true, alpha: age < 2 ? 0.5 : 0.35 }) }, properties: { type: "earthquake" } });
            if (m >= 5.0) {
              viewer.entities.add({ id: `eq-ring-${i}`, position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0), ellipse: { semiMinorAxis: Math.max(3000, m * 8000) * 1.8, semiMajorAxis: Math.max(3000, m * 8000) * 1.8, material: new Cesium.ColorMaterialProperty({ color: Cesium.Color.WHITE, transparent: true, alpha: 0.12 }), outline: true, outlineColor: col.withAlpha(0.3) }, properties: { type: "earthquake-ring" } });
            }
          });
          updateStatus("earthquakes", { lastUpdate: Date.now(), count: (d.features || []).length });
        } catch { /* retry */ }
      }, 60000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("earthquakes", { error: "fetch failed" }); }
  };

  doLoad();
}
