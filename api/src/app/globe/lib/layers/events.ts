import type { DataStatus } from "../types";
import { EONET_COLORS } from "../constants";
import { fetchEONET } from "../data-fetchers";

export function loadEvents(
  viewer: any, Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { events: boolean },
) {
  updateStatus("events", { error: null });

  const doLoad = async () => {
    try {
      const data = await fetchEONET();
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("events", { lastUpdate: Date.now(), count: features.length });
      features.forEach((f: any, i: number) => {
        const cat = f.properties?.categories?.[0]?.id || "manmade";
        const colorStr = EONET_COLORS[cat] || "#888888";
        const coords = f.geometry?.coordinates;
        if (!coords) return;
        const c = Cesium.Color.fromCssColorString(colorStr);
        viewer.entities.add({
          id: `event-${i}`,
          position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
          point: { pixelSize: 6, color: c, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
          label: { text: f.properties?.title || cat, font: "10px sans-serif", fillColor: c.withAlpha(0.9), style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) },
          properties: { type: "event" },
        });
      });

      const iv = setInterval(async () => {
        if (!stateLayers.events) return;
        try {
          const d = await fetchEONET();
          const fs = d.features || [];
          removeEntities("event-");
          fs.forEach((f: any, i: number) => {
            const cat = f.properties?.categories?.[0]?.id || "manmade";
            const c = Cesium.Color.fromCssColorString(EONET_COLORS[cat] || "#888888");
            const co = f.geometry?.coordinates;
            if (!co) return;
            viewer.entities.add({ id: `event-${i}`, position: Cesium.Cartesian3.fromDegrees(co[0], co[1], 0), point: { pixelSize: 6, color: c }, label: { text: f.properties?.title || cat, font: "10px sans-serif", fillColor: c.withAlpha(0.9), style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) } });
          });
          updateStatus("events", { lastUpdate: Date.now(), count: fs.length });
        } catch { /* retry */ }
      }, 1800000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("events", { error: "fetch failed" }); }
  };

  doLoad();
}
