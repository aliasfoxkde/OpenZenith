import type { DataStatus } from "../types";
import { ICONS } from "../constants";
import { fetchVessels } from "../data-fetchers";

/**
 * AISstream.io message types
 */
interface AISPositionReport {
  MMSI: number;
  Latitude: number;
  Longitude: number;
  SpeedOverGround: number;
  CourseOverGround: number;
  TrueHeading: number;
  NavigationalStatus: number;
  IMO: string | null;
  Name: string;
  VesselType: number;
  Width: number;
  Length: number;
  Flag: string;
  CallSign: string | null;
  Destination: string | null;
  ETA: string | null;
  Timestamp: string;
}

/** Vessel type color mapping */
function vesselColor(shipType: number, Cesium: any): any {
  if (shipType >= 60 && shipType <= 69) return Cesium.Color.fromCssColorString("#ff4444"); // Passenger
  if (shipType >= 70 && shipType <= 79) return Cesium.Color.fromCssColorString("#ff8800"); // Cargo
  if (shipType >= 80 && shipType <= 89) return Cesium.Color.fromCssColorString("#ffcc00"); // Tanker
  if (shipType >= 30 && shipType <= 39) return Cesium.Color.fromCssColorString("#00ccff"); // Fishing
  if (shipType >= 50 && shipType <= 59) return Cesium.Color.fromCssColorString("#44ff44"); // Towing
  if (shipType >= 20 && shipType <= 29) return Cesium.Color.fromCssColorString("#ff44ff"); // WIG
  return Cesium.Color.fromCssColorString("#aaaaaa"); // Other / unknown
}

/** Vessel type label */
function vesselTypeLabel(shipType: number): string {
  const types: Record<number, string> = {
    30: "Fishing",
    31: "Towing",
    32: "Towing",
    33: "Dredge",
    34: "Dive",
    35: "Military",
    36: "Sailing",
    37: "Pleasure",
    60: "Passenger",
    61: "Passenger",
    62: "Passenger",
    63: "Passenger",
    64: "RoRo",
    65: "RoRo",
    66: "RoRo",
    67: "RoRo",
    68: "Cargo",
    69: "Cargo",
    70: "Cargo",
    71: "Cargo",
    72: "Cargo",
    73: "Cargo",
    74: "Cargo",
    75: "Cargo",
    76: "Cargo",
    77: "Cargo",
    80: "Tanker",
    81: "Tanker",
    82: "Tanker",
    83: "Tanker",
    84: "Tanker",
  };
  return types[shipType] || "Other";
}

export function loadVessels(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { vessels: boolean },
) {
  updateStatus("vessels", { error: null });

  /** Store active WebSocket for cleanup */
  let ws: WebSocket | null = null;
  /** Position cache keyed by MMSI */
  const positionCache = new Map<number, AISPositionReport>();
  /** Batch update timer to avoid per-message entity churn */
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const addVesselEntity = (v: AISPositionReport, i: number) => {
    const color = vesselColor(v.VesselType, Cesium);
    const hdg = v.TrueHeading || v.CourseOverGround || 0;
    const spd = v.SpeedOverGround || 0;
    const name = (v.Name || "").trim() || `MMSI:${v.MMSI}`;
    const typeLabel = vesselTypeLabel(v.VesselType);

    viewer.entities.add({
      id: `vessel-${i}`,
      name: name,
      position: Cesium.Cartesian3.fromDegrees(v.Longitude, v.Latitude),
      billboard: {
        image: ICONS.vessel,
        width: 16,
        height: 16,
        rotation: Cesium.Math.toRadians(-hdg),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        color: color.withAlpha(0.9),
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 2e6, 0.3),
      },
      label:
        name.length > 0
          ? {
              text: name,
              font: "9px sans-serif",
              fillColor: Cesium.Color.WHITE.withAlpha(0.7),
              outlineColor: Cesium.Color.BLACK,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(10, -8),
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
              backgroundPadding: new Cesium.Cartesian2(3, 2),
              scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e5, 0.0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 400000),
            }
          : undefined,
      properties: {
        type: "vessel",
        mmsi: v.MMSI,
        name,
        shipType: typeLabel,
        speed: spd,
        heading: hdg,
        cog: v.CourseOverGround,
        flag: v.Flag,
        imo: v.IMO,
        destination: v.Destination,
      },
    });

    // Heading vector for moving vessels
    if (spd > 0.5 && hdg > 0) {
      const vecLen = Math.min(spd * 15, 5000);
      const hdgRad = Cesium.Math.toRadians(hdg);
      const dLat = (vecLen * Math.cos(hdgRad)) / 111320;
      const dLon = (vecLen * Math.sin(hdgRad)) / (111320 * Math.cos(Cesium.Math.toRadians(v.Latitude)));
      viewer.entities.add({
        id: `vessel-vec-${i}`,
        position: Cesium.Cartesian3.fromDegrees(v.Longitude, v.Latitude),
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            v.Longitude,
            v.Latitude,
            v.Longitude + dLon,
            v.Latitude + dLat,
          ]),
          width: 1.5,
          material: color.withAlpha(0.35),
          clampToGround: true,
        },
        properties: { type: "vessel-vec" },
      });
    }
  };

  /** Rebuild all vessel entities from the position cache */
  const rebuildEntities = () => {
    removeEntities("vessel-");
    const positions = Array.from(positionCache.values());
    positions.forEach((v, i) => addVesselEntity(v, i));
    updateStatus("vessels", {
      lastUpdate: Date.now(),
      count: positions.length,
    });
  };

  /** Batch position updates to avoid excessive entity churn */
  const scheduleRebuild = () => {
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      rebuildEntities();
    }, 2000);
  };

  /** Connect to AISstream.io WebSocket */
  const connectWebSocket = async () => {
    try {
      const config = await fetchVessels();
      if (config.error) {
        updateStatus("vessels", { error: config.message || config.error });
        return;
      }

      ws = new WebSocket(config.wsUrl);

      ws.onopen = () => {
        // Subscribe to global vessel positions
        ws?.send(
          JSON.stringify({
            Apikey: config.apiKey,
            BoundingBoxes: [
              [-90, -180],
              [90, 180],
            ],
            FilterMessageTypes: ["PositionReport"],
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.MessageType === "PositionReport") {
            const meta = msg.MetaData;
            const pos = (msg as any).PositionReport || {};
            const report: AISPositionReport = {
              MMSI: meta.mmsi,
              Latitude: pos.Latitude ?? 0,
              Longitude: pos.Longitude ?? 0,
              SpeedOverGround: pos.SpeedOverGround ?? 0,
              CourseOverGround: pos.CourseOverGround ?? 0,
              TrueHeading: pos.TrueHeading ?? 0,
              NavigationalStatus: pos.NavigationalStatus ?? 0,
              IMO: meta.imo,
              Name: meta.shipname || "",
              VesselType: meta.shiptype ?? 0,
              Width: meta.width ?? 0,
              Length: meta.length ?? 0,
              Flag: meta.flag || "",
              CallSign: meta.callsign || null,
              Destination: meta.destination || null,
              ETA: null,
              Timestamp: meta.time_utc,
            };
            positionCache.set(report.MMSI, report);
            scheduleRebuild();
          }
        } catch {
          // Malformed message, skip
        }
      };

      ws.onerror = () => {
        updateStatus("vessels", { error: "WebSocket connection failed" });
      };

      ws.onclose = () => {
        // Reconnect after 30s if layer is still active
        if (stateLayers.vessels) {
          setTimeout(() => {
            if (stateLayers.vessels) connectWebSocket();
          }, 30000);
        }
      };
    } catch {
      updateStatus("vessels", { error: "Failed to connect to vessel feed" });
    }
  };

  // Start WebSocket connection
  connectWebSocket();

  // Periodic cleanup of stale positions (vessels not seen in 10 minutes)
  const cleanupIv = setInterval(() => {
    const cutoff = Date.now() - 600000; // 10 minutes
    let removed = 0;
    for (const [mmsi, report] of positionCache) {
      const ts = new Date(report.Timestamp).getTime();
      if (ts < cutoff) {
        positionCache.delete(mmsi);
        removed++;
      }
    }
    if (removed > 0) scheduleRebuild();
  }, 60000);
  intervalsRef.current.push(cleanupIv);

  // Store cleanup function on window for layer toggle
  (window as any).__ozCleanupVessels = () => {
    if (batchTimer) clearTimeout(batchTimer);
    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }
    positionCache.clear();
  };
}

/** Cleanup vessel WebSocket on layer disable */
export function cleanupVessels() {
  (window as any).__ozCleanupVessels?.();
}
