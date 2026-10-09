import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { fetchRainViewer, isAbort } from "../data-fetchers";
import { createRetryGuard } from "../helpers";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

/**
 * Animated weather radar using RainViewer tile frames.
 * Cycles through past + forecast frames with configurable interval.
 */
export function loadRadar(
  viewer: CesiumType.Viewer | undefined,
  cesiumRef: typeof CesiumType | undefined,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  toggleImageryOverlay: (name: string, url?: string, opacity?: number) => void,
  intervalsRef: LayerTimersRef,
  stateLayers: { radar: boolean },
  signal?: AbortSignal,
) {
  updateStatus("radar", { error: null });
  const retry = createRetryGuard();

  // RainViewerFrame.path is optional, so the collected frame list keeps the
  // undefined slots; the tile URL interpolates them exactly as before.
  let radarFrames: (string | undefined)[] = [];
  let frameIndex = 0;
  let animInterval: ReturnType<typeof setInterval> | null = null;
  const FRAME_INTERVAL_MS = 2000; // 2s per frame

  const startAnimation = () => {
    if (animInterval) clearInterval(animInterval);
    if (radarFrames.length === 0) return;

    // Show first frame immediately
    const url = `https://tilecache.rainviewer.com${String(radarFrames[frameIndex])}/256/{z}/{x}/{y}/2/1_1.png`;
    toggleImageryOverlay("rainviewer", url, 0.6);

    animInterval = setInterval(() => {
      if (!stateLayers.radar) return;
      frameIndex = (frameIndex + 1) % radarFrames.length;
      const frameUrl = `https://tilecache.rainviewer.com${String(radarFrames[frameIndex])}/256/{z}/{x}/{y}/2/1_1.png`;
      toggleImageryOverlay("rainviewer", frameUrl, 0.6);
    }, FRAME_INTERVAL_MS);
    pushLayerTimer(intervalsRef, "radar", animInterval);
  };

  const doLoad = async () => {
    try {
      const data = await fetchRainViewer(signal);
      if (!viewer || !data.radar) return;

      // Collect all frames: past + forecast
      const pastFrames = (data.radar.past || []).map((f) => f.path);
      const forecastFrames = (data.radar.forecast || []).map((f) => f.path);
      radarFrames = [...pastFrames, ...forecastFrames];

      if (radarFrames.length === 0) return;

      updateStatus("radar", { lastUpdate: Date.now(), count: radarFrames.length });
      startAnimation();

      // Refresh data every 10 minutes
      const iv = setInterval(() => {
        void (async () => {
          if (!stateLayers.radar) return;
          try {
            const d = await fetchRainViewer(signal);
            if (!d.radar) return;
            const past = (d.radar.past || []).map((f) => f.path);
            const forecast = (d.radar.forecast || []).map((f) => f.path);
            radarFrames = [...past, ...forecast];
            frameIndex = 0;
            updateStatus("radar", { lastUpdate: Date.now(), count: radarFrames.length });
          } catch {
            retry.recordFailure();
            updateStatus("radar", {
              error: retry.shouldRetry ? `Retrying (${retry.failureCount}/5)...` : "Radar data unavailable",
            });
          }
        })();
      }, 600000);
      pushLayerTimer(intervalsRef, "radar", iv);
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("radar", err);
      updateStatus("radar", {
        error: "fetch failed",
      });
    }
  };

  void doLoad();
}
