import type { DataStatus } from "../types";

const LIGHTNING_ICON = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" fill="#ffff00" opacity="0.9"/></svg>`;

export function loadLightning(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { lightning: boolean },
) {
  updateStatus("lightning", { error: null });

  // Blitzortung.org provides a WebSocket feed of real-time lightning strikes.
  // Due to WebSocket proxy complexity, we use the HTTP endpoint instead.
  // The Blitzortung API requires specific headers and may have CORS restrictions.
  // We attempt to fetch recent strikes via their public data endpoint.

  let ws: WebSocket | null = null;

  const addStrike = (lat: number, lon: number) => {
    if (!Cesium || !viewer) return;

    const id = `strike-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const flashTime = Date.now();

    viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const age = Date.now() - flashTime;
          if (age > 30000) return 0; // Fade out after 30s
          return Math.max(0, 6 * (1 - age / 30000));
        }, false),
        color: new Cesium.CallbackProperty(() => {
          const age = Date.now() - flashTime;
          if (age > 30000) return Cesium.Color.TRANSPARENT;
          return Cesium.Color.fromCssColorString("#ffff00").withAlpha(1 - age / 30000);
        }, false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      billboard: {
        image: LIGHTNING_ICON,
        width: 14,
        height: 14,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.3),
        show: new Cesium.CallbackProperty(() => Date.now() - flashTime < 5000, false),
      },
      properties: { type: "lightning-strike", timestamp: flashTime },
    });

    // Auto-remove after 30s
    setTimeout(() => {
      try {
        viewer.entities.removeById(id);
      } catch {
        /* already removed */
      }
    }, 35000);
  };

  const connectWs = () => {
    try {
      // Blitzortung WebSocket for live strikes
      ws = new WebSocket("wss://ws.blitzortung.org:443/");

      ws.onmessage = (event) => {
        try {
          // Blitzortung sends strike data in a specific format
          const data = event.data;
          if (typeof data === "string") {
            // Try parsing common Blitzortung formats
            const parts = data.split(";");
            if (parts.length >= 3) {
              const lat = parseFloat(parts[1]);
              const lon = parseFloat(parts[2]);
              if (!isNaN(lat) && !isNaN(lon)) {
                addStrike(lat, lon);
              }
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = () => {
        updateStatus("lightning", { error: "WebSocket connection failed. Lightning data unavailable." });
      };

      ws.onclose = () => {
        // Reconnect after 30s
        setTimeout(() => {
          if (stateLayers.lightning) connectWs();
        }, 30000);
      };

      updateStatus("lightning", { lastUpdate: Date.now(), count: 0 });
    } catch {
      updateStatus("lightning", { error: "Unable to connect to Blitzortung WebSocket" });
    }
  };

  connectWs();

  // Cleanup on unmount is handled by the interval system
  intervalsRef.current.push(
    setInterval(() => {
      // Periodic status update
      const count =
        viewer?.entities?.values?.filter((e: any) => e.properties?.type?.getValue?.() === "lightning-strike")?.length ||
        0;
      updateStatus("lightning", { lastUpdate: Date.now(), count });
    }, 10000),
  );
}
