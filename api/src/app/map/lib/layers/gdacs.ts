import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── GDACS Disaster Alerts ─── */

export function addGdacs(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("gdacs")) return;

  const doLoad = async () => {
    try {
      // GDACS public API and RSS are no longer freely accessible.
      // Return empty gracefully.
      setStatus(handle, "gdacs", "empty", 0);
      return;

      // --- Original RSS parsing kept for reference if API returns ---
      // const res = await fetch("https://www.gdacs.org/rss.aspx");
      // const text = await res.text();
      // ...
    } catch {
      setStatus(handle, "gdacs", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

export function removeGdacs(map: maplibregl.Map): void {
  ["gdacs-glow", "gdacs-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("gdacs"); } catch {}
}
