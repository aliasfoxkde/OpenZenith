import type { DataStatus } from "../types";
import { fetchGDACS } from "../data-fetchers";

const GDACS_ICON = `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="#ff4444" stroke-width="2"/><path d="M12 5v7l5 5" fill="none" stroke="#ff4444" stroke-width="2" stroke-linecap="round"/></svg>`;

function severityColor(severity: string): string {
  switch (severity) {
    case "Red":
    case "red":
    case "3":
    case "Extreme":
      return "#ff0000";
    case "Orange":
    case "orange":
    case "2":
    case "Severe":
      return "#ff8800";
    case "Green":
    case "green":
    case "1":
    case "Moderate":
      return "#00cc44";
    default:
      return "#888888";
  }
}

export function loadGDACS(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { gdacs: boolean },
) {
  updateStatus("gdacs", { error: null });

  const doLoad = async () => {
    try {
      const data = await fetchGDACS();
      if (!Cesium || !viewer) return;

      // GDACS ATOM format: parse entries
      const entries = data?.atom?.entry || data?.entries || data?.events || [];
      removeEntities("gdacs-");
      let count = 0;

      const items = Array.isArray(entries) ? entries : [entries];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const lat = parseFloat(item?.lat || item?.latitude || item?.geo?.lat || 0);
        const lon = parseFloat(item?.lon || item?.longitude || item?.geo?.lon || 0);
        if (!lat || !lon) continue;

        const name = item?.title || item?.name || item?.eventname || "Disaster";
        const severity = item?.severitylevel || item?.severity || item?.alertlevel || "Green";
        const eventType = item?.eventtype || item?.type || "Disaster";
        const colorStr = severityColor(severity);
        const c = Cesium.Color.fromCssColorString(colorStr);

        viewer.entities.add({
          id: `gdacs-${i}`,
          name: name,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          billboard: {
            image: GDACS_ICON,
            width: 18,
            height: 18,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
          },
          point: {
            pixelSize: 5,
            color: c,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
            outlineWidth: 1,
          },
          label: {
            text: `${name.substring(0, 20)}`,
            font: "9px 'JetBrains Mono', monospace",
            fillColor: c.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(12, -8),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
            backgroundPadding: new Cesium.Cartesian2(3, 2),
            scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 5e6, 0.0),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
          },
          description: [name, `Type: ${eventType}`, `Severity: ${severity}`, `Source: GDACS`]
            .filter(Boolean)
            .join("\n"),
          properties: { type: "gdacs", severity, eventType },
        });
        count++;
      }

      updateStatus("gdacs", { lastUpdate: Date.now(), count });

      const iv = setInterval(async () => {
        if (!stateLayers.gdacs) return;
        removeEntities("gdacs-");
        doLoad();
      }, 1800000); // 30 min
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("gdacs", { error: "fetch failed" });
    }
  };

  doLoad();
}
