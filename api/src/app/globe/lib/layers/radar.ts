import type { DataStatus } from "../types";
import { fetchRainViewer } from "../data-fetchers";

/**
 * Animated weather radar using RainViewer tile frames.
 * Cycles through past + forecast frames with configurable interval.
 */
export function loadRadar(
  viewer: any,
  cesiumRef: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  toggleImageryOverlay: (name: string, url?: string, opacity?: number) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { radar: boolean },
) {
  updateStatus("radar", { error: null });

  let radarFrames: string[] = [];
  let frameIndex = 0;
  let animInterval: ReturnType<typeof setInterval> | null = null;
  const FRAME_INTERVAL_MS = 2000; // 2s per frame
  const Cesium = cesiumRef;

  const startAnimation = () => {
    if (animInterval) clearInterval(animInterval);
    if (radarFrames.length === 0) return;

    // Show first frame immediately
    const url = `https://tilecache.rainviewer.com${radarFrames[frameIndex]}/256/{z}/{x}/{y}/2/1_1.png`;
    toggleImageryOverlay("rainviewer", url, 0.6);

    animInterval = setInterval(() => {
      if (!stateLayers.radar) return;
      frameIndex = (frameIndex + 1) % radarFrames.length;
      const frameUrl = `https://tilecache.rainviewer.com${radarFrames[frameIndex]}/256/{z}/{x}/{y}/2/1_1.png`;
      toggleImageryOverlay("rainviewer", frameUrl, 0.6);
    }, FRAME_INTERVAL_MS);
    intervalsRef.current.push(animInterval);
  };

  const doLoad = async () => {
    try {
      const data = await fetchRainViewer();
      if (!viewer || !data.radar) return;

      // Collect all frames: past + forecast
      const pastFrames = (data.radar.past || []).map((f: any) => f.path);
      const forecastFrames = (data.radar.forecast || []).map((f: any) => f.path);
      radarFrames = [...pastFrames, ...forecastFrames];

      if (radarFrames.length === 0) return;

      updateStatus("radar", { lastUpdate: Date.now(), count: radarFrames.length });
      startAnimation();

      // Refresh data every 10 minutes
      const iv = setInterval(async () => {
        if (!stateLayers.radar) return;
        try {
          const d = await fetchRainViewer();
          if (!d.radar) return;
          const past = (d.radar.past || []).map((f: any) => f.path);
          const forecast = (d.radar.forecast || []).map((f: any) => f.path);
          radarFrames = [...past, ...forecast];
          frameIndex = 0;
          updateStatus("radar", { lastUpdate: Date.now(), count: radarFrames.length });
        } catch {
          /* retry */
        }
      }, 600000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("radar", { error: "fetch failed" });
    }
  };

  doLoad();
}
