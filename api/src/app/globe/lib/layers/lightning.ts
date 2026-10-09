import { warnLayerError, domEventCause } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { svgIcon } from "../svg-icon";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

const LIGHTNING_ICON = svgIcon(
  `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" fill="#ffff00" opacity="0.9"/></svg>`,
);

const MAX_ACTIVE_STRIKES = 200;

/** Structural view of the billboard surface the 5 s hide flips. */
type StrikeBillboard = { show: boolean };

// Module-level refs so cleanupLightning() can access them on unmount
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const activeStrikeIds = new Set<string>();

/**
 * Tears down the module-level Blitzortung state created by loadLightning:
 * clears any pending reconnect timer, closes the WebSocket with onclose
 * nulled so the 30 s reconnect cannot refire during teardown, and empties
 * the active strike id set. Call on unmount — the socket, timer and strike
 * ids live at module scope, not per viewer. Returns void.
 */
export function cleanupLightning() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // Prevent reconnect timer from firing during close
    ws.close();
    ws = null;
  }
  activeStrikeIds.clear();
}

/**
 * Streams live lightning strikes over a WebSocket to
 * wss://ws.blitzortung.org:443/ and renders each as a `strike-<ts>-<rand>`
 * entity: a yellow flash point, a 30 km glow ellipse, and a bolt billboard
 * that hides after 5 s while the entity itself is removed after 35 s.
 * Concurrent strikes cap at MAX_ACTIVE_STRIKES (200); messages are
 * semicolon-delimited with lat at index 1 and lon at index 2, degrees. On
 * close it schedules a 30 s reconnect while stateLayers.lightning holds, and
 * a 10 s interval registered under "lightning" reports the live strike
 * count. The socket, reconnect timer and strike ids are module-level refs —
 * pair with cleanupLightning() on unmount. Returns void.
 */
export function loadLightning(
  viewer: CesiumType.Viewer | undefined,
  Cesium: typeof CesiumType | undefined,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  _removeEntities: (prefix: string) => void,
  intervalsRef: LayerTimersRef,
  stateLayers: { lightning: boolean },
) {
  updateStatus("lightning", { error: null });

  const addStrike = (lat: number, lon: number) => {
    // Strikes arrive from the socket, so this closure re-verifies the viewer
    // globals rather than trusting the load-time dispatch.
    if (!Cesium || !viewer) return;
    if (activeStrikeIds.size >= MAX_ACTIVE_STRIKES) return;

    const id = `strike-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const flashTime = Date.now();
    activeStrikeIds.add(id);

    viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      // Bright flash point
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString("#ffff00"),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      // Glow ellipse for flash illumination
      ellipse: {
        semiMinorAxis: 30000,
        semiMajorAxis: 30000,
        material: new Cesium.ColorMaterialProperty({
          color: Cesium.Color.fromCssColorString("#ffff00"),
          transparent: true,
          alpha: 0.15,
        }),
        height: 0,
      },
      billboard: {
        image: LIGHTNING_ICON,
        width: 14,
        height: 14,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.3),
        show: true,
      },
      properties: { type: "lightning-strike", timestamp: flashTime },
    });

    // Hide billboard after 5s, remove point after 30s
    const entity = viewer.entities.getById(id);
    setTimeout(() => {
      try {
        // Entity.billboard is typed as an open record; only `show` is mutated.
        const billboard = entity?.billboard as StrikeBillboard | undefined;
        if (billboard) billboard.show = false;
      } catch {
        /* */
      }
    }, 5000);

    // Auto-remove after 30s
    setTimeout(() => {
      activeStrikeIds.delete(id);
      try {
        viewer.entities.removeById(id);
      } catch {
        /* already removed */
      }
    }, 35000);
  };

  const connectWs = () => {
    try {
      ws = new WebSocket("wss://ws.blitzortung.org:443/");

      ws.onmessage = (event) => {
        try {
          const data: unknown = event.data;
          if (typeof data === "string") {
            const parts = data.split(";");
            if (parts.length >= 3) {
              // bounds: the parts.length >= 3 guard above covers indices 0..2
              const lat = parseFloat(parts[1]!);
              const lon = parseFloat(parts[2]!);
              if (!isNaN(lat) && !isNaN(lon)) {
                addStrike(lat, lon);
              }
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = (ev) => {
        warnLayerError("lightning", domEventCause(ev), "websocket");
        updateStatus("lightning", { error: "WebSocket connection failed. Lightning data unavailable." });
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(() => {
          if (stateLayers.lightning) connectWs();
        }, 30000);
      };

      updateStatus("lightning", { lastUpdate: Date.now(), count: 0 });
    } catch (err) {
      warnLayerError("lightning", err);
      updateStatus("lightning", {
        error: "Unable to connect to Blitzortung WebSocket",
      });
    }
  };

  connectWs();

  // Status update using tracked Set instead of scanning all entities
  pushLayerTimer(
    intervalsRef,
    "lightning",
    setInterval(() => {
      updateStatus("lightning", { lastUpdate: Date.now(), count: activeStrikeIds.size });
    }, 10000),
  );
}
