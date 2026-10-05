import type { LayerState } from "../types";

/**
 * Timers registered by globe layer loaders, attributed to the layer that
 * created them. The loaders share one ref array (tab-hide clears it wholesale
 * and resume re-loads every enabled layer), but toggle-off needs per-layer
 * attribution: without the key, disabling a layer left its polling timer
 * running forever and re-enabling stacked a second timer beside it.
 */
export type LayerTimerEntry = {
  key: keyof LayerState;
  id: ReturnType<typeof setInterval>;
};

/**
 * The ref loaders hand their `setInterval` handle to via `pushLayerTimer`.
 * Owned by the globe page as `intervalsRef` and read in three places: the
 * visibility handler clears every entry when the tab hides (resume reloads the
 * enabled layers), viewer unmount clears every entry again, and layer
 * toggle-off filters out only the entries whose key matches — which is the
 * whole reason `LayerTimerEntry` carries a key.
 */
export type LayerTimersRef = React.RefObject<LayerTimerEntry[]>;

/** Register `id` under `key` so toggle-off can clear exactly this layer's timers. */
export function pushLayerTimer(
  ref: LayerTimersRef,
  key: keyof LayerState,
  id: ReturnType<typeof setInterval>,
): void {
  ref.current.push({ key, id });
}
