import type { DataStatus } from "../types";
import { fetchRainViewer } from "../data-fetchers";

export function loadRadar(
  viewer: any,
  _cesiumRef: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  toggleImageryOverlay: (name: string, url?: string, opacity?: number) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { radar: boolean },
) {
  updateStatus("radar", { error: null });

  const doLoad = async () => {
    try {
      const data = await fetchRainViewer();
      if (!viewer || !data.radar?.past?.length) return;
      const latest = data.radar.past[data.radar.past.length - 1];
      updateStatus("radar", { lastUpdate: Date.now(), count: 1 });
      toggleImageryOverlay("rainviewer", `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, 0.6);

      const iv = setInterval(async () => {
        if (!stateLayers.radar) return;
        try {
          const d = await fetchRainViewer();
          const lt = d.radar?.past?.[d.radar.past.length - 1];
          if (lt) { toggleImageryOverlay("rainviewer", `https://tilecache.rainviewer.com${lt.path}/256/{z}/{x}/{y}/2/1_1.png`, 0.6); updateStatus("radar", { lastUpdate: Date.now(), count: 1 }); }
        } catch { /* retry */ }
      }, 600000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("radar", { error: "fetch failed" }); }
  };

  doLoad();
}
