/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";
import { EONET_COLORS } from "../constants";
import { fetchEONET } from "../data-fetchers";
import { createRetryGuard } from "../helpers";

interface EonetFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    categories?: { id?: string }[];
    title?: string;
    description?: string;
    updated?: number;
    geometry_lastModified?: number;
    [key: string]: unknown;
  };
}

/** EONET category → SVG billboard icon */
const CATEGORY_ICONS: Record<string, string> = {
  volcanoes: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2L2 20h20L12 2z" fill="#ff4444" opacity="0.8"/><ellipse cx="12" cy="20" rx="8" ry="2" fill="#ff4444" opacity="0.4"/><path d="M12 8v4M12 14v2" stroke="#ffcc00" stroke-width="2" stroke-linecap="round" opacity="0.9"/><circle cx="12" cy="7" r="3" fill="#ff6600" opacity="0.6"/></svg>`,
  wildfires: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2c-1 4-4 6-4 10a4 4 0 008 0c0-4-3-6-4-10z" fill="#ff8800" opacity="0.8"/><path d="M12 8c-.5 2-2 3-2 5a2 2 0 004 0c0-2-1.5-3-2-5z" fill="#ffcc00" opacity="0.9"/></svg>`,
  icesbergs: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 18l4-8 3 4 5-10 4 14H4z" fill="#44aaff" opacity="0.7"/><path d="M4 18h16" stroke="#88ccff" stroke-width="1.5"/></svg>`,
  severeStorms: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" fill="#ff00ff" opacity="0.8"/></svg>`,
  landslides: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 20l4-6 3 3 5-8 4 11H4z" fill="#aa8800" opacity="0.7"/><circle cx="8" cy="10" r="2" fill="#ccaa00" opacity="0.6"/></svg>`,
  seaLakeIce: `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8" fill="none" stroke="#00ccff" stroke-width="1.5" opacity="0.7"/><path d="M8 12l4-4 4 8-4 4z" fill="#00ccff" opacity="0.5"/><line x1="12" y1="4" x2="12" y2="20" stroke="#88eeff" stroke-width="1" opacity="0.5"/><line x1="4" y1="12" x2="20" y2="12" stroke="#88eeff" stroke-width="1" opacity="0.5"/></svg>`,
  flood: `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2c-2 4-6 6-6 10a6 6 0 0012 0c0-4-4-6-6-10z" fill="#0066ff" opacity="0.7"/><path d="M12 10v4M10 12h4" stroke="#88bbff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  drought: `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8" fill="none" stroke="#ccaa00" stroke-width="1.5" opacity="0.7"/><path d="M12 6v12M6 12h12" stroke="#ccaa00" stroke-width="1" opacity="0.4"/><circle cx="12" cy="12" r="3" fill="#ccaa00" opacity="0.5"/></svg>`,
  manmade: `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="6" fill="none" stroke="#888" stroke-width="1.5"/><path d="M12 8v8M8 12h8" stroke="#888" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

/** Category → display label */
const CATEGORY_LABELS: Record<string, string> = {
  volcanoes: "Volcano",
  wildfires: "Wildfire",
  icesbergs: "Iceberg",
  severeStorms: "Severe Storm",
  landslides: "Landslide",
  seaLakeIce: "Sea/Lake Ice",
  flood: "Flood",
  drought: "Drought",
  manmade: "Manmade",
};

export function loadEvents(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { events: boolean },
) {
  updateStatus("events", { error: null });
  const retry = createRetryGuard({ maxFailures: 3 });

  const addEventEntity = (f: EonetFeature, i: number) => {
    const cat = f.properties?.categories?.[0]?.id || "manmade";
    const colorStr = EONET_COLORS[cat] || "#888888";
    const coords = f.geometry?.coordinates;
    if (!coords) return;
    const c = Cesium.Color.fromCssColorString(colorStr);
    const title = f.properties?.title || CATEGORY_LABELS[cat] || cat;
    const icon = CATEGORY_ICONS[cat] || CATEGORY_ICONS.manmade;
    const now = Date.now();

    // Check if event was updated within last 24 hours
    const updated = f.properties?.updated || f.properties?.geometry_lastModified || 0;
    const isRecent = now - updated < 86400000; // 24h
    const iconSize = isRecent ? 24 : 20;

    // Pulsing glow for recent events
    const pulseAlpha = isRecent ? 0.4 : 0.3;

    viewer.entities.add({
      id: `event-${i}`,
      name: title,
      position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
      // Category icon billboard
      billboard: {
        image: icon,
        width: iconSize,
        height: iconSize,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.5, 2e7, 0.4),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e7),
      },
      // Small point underneath
      point: {
        pixelSize: 4,
        color: c,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
        outlineWidth: 1,
      },
      // Title label
      label: {
        text: title,
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
      // Enhanced tooltip
      description: [
        title,
        CATEGORY_LABELS[cat] || cat,
        f.properties?.description || null,
        coords ? `Lat: ${coords[1].toFixed(3)}, Lon: ${coords[0].toFixed(3)}` : null,
        updated ? `Updated: ${new Date(updated).toLocaleDateString()}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      properties: { type: "event", category: cat, ...f.properties },
    });

    // Pulsing ring for recent events
    if (isRecent) {
      viewer.entities.add({
        id: `event-pulse-${i}`,
        position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
        ellipse: {
          semiMinorAxis: 17500,
          semiMajorAxis: 17500,
          material: new Cesium.ColorMaterialProperty({
            color: c,
            transparent: true,
            alpha: pulseAlpha,
          }),
        },
        properties: { type: "event-pulse" },
      });
    }
  };

  const doLoad = async () => {
    try {
      const data = await fetchEONET();
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("events", { lastUpdate: Date.now(), count: features.length });
      features.forEach((f: any, i: number) => addEventEntity(f, i));

      const iv = setInterval(async () => {
        if (!stateLayers.events) return;
        try {
          const d = await fetchEONET();
          const fs = d.features || [];
          removeEntities("event-");
          fs.forEach((f: any, i: number) => addEventEntity(f, i));
          updateStatus("events", { lastUpdate: Date.now(), count: fs.length, error: null });
          retry.recordSuccess();
        } catch {
          retry.recordFailure();
          updateStatus("events", {
            error: retry.shouldRetry ? `Retrying (${retry.failureCount}/3)...` : "Event data unavailable",
          });
        }
      }, 1800000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("events", { error: "fetch failed" });
    }
  };

  doLoad();
}
