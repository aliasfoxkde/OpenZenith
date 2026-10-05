import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── GDACS Disaster Alerts ─── */

/**
 * Add the GDACS disaster-alert layer — currently a deliberate no-op: the
 * public GDACS API/RSS is no longer freely accessible, so the loader marks
 * the handle "gdacs" empty with a count of 0 and schedules itself to repeat
 * that check every 10 minutes (interval pushed onto handle.intervals). No
 * source or layer is created, and the original RSS parsing is kept inline as
 * a comment for reintroduction.
 */
export function addGdacs(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("gdacs")) return;

  const doLoad = () => {
    try {
      // GDACS public API and RSS are no longer freely accessible.
      // Return empty gracefully.
      setStatus(handle, "gdacs", "empty", 0);
      return;

      // --- Original RSS parsing kept for reference if API returns ---
      // const res = await fetch("https://www.gdacs.org/rss.aspx");
      // const text = await res.text();
      // ...
    } catch (err) {
      warnLayerError("gdacs", err);
      setStatus(handle, "gdacs", "error");
      }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

/** Remove the gdacs-glow/gdacs-points layers and the `gdacs` source if a previous build of the layer left them behind. */
export function removeGdacs(map: maplibregl.Map): void {
  ["gdacs-glow", "gdacs-points"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("gdacs");
  } catch {}
}
