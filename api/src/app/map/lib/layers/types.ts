/**
 * Lifecycle state of one data layer. `empty` means the upstream responded
 * fine but carried no features (e.g. no wildfires in view); `error` means the
 * fetch or MapLibre mutation threw.
 */
export type LayerStatus = "idle" | "loading" | "loaded" | "error" | "empty";

/**
 * Per-layer bookkeeping passed to every add* loader. `intervals` accumulates
 * the refresh `setInterval` ids a layer creates (the page clears them all on
 * tab-hide/unmount), `cleanup` is an optional destructor for non-interval
 * resources (event listeners, WebSockets), and `status`/`featureCount` hold
 * the last reported state per layer id.
 */
export interface LayerHandle {
  intervals: ReturnType<typeof setInterval>[];
  cleanup?: () => void;
  status: Record<string, LayerStatus>;
  featureCount: Record<string, number>;
  onStatusChange?: (layerId: string, status: LayerStatus, count?: number) => void;
}

/**
 * Allocate an empty LayerHandle. `onStatusChange`, when given, is invoked by
 * every subsequent setStatus so the UI can reflect layer state; it receives
 * the layer id, the new status, and the feature count when one was reported.
 */
export function createLayerHandle(
  onStatusChange?: (layerId: string, status: LayerStatus, count?: number) => void,
): LayerHandle {
  return { intervals: [], status: {}, featureCount: {}, onStatusChange };
}

/**
 * Record a layer's current status (and feature count, when known) on the
 * handle and forward both to the handle's onStatusChange callback. Fire-and-
 * forget: loaders call it from their fetch paths instead of returning values.
 */
export function setStatus(handle: LayerHandle, layerId: string, status: LayerStatus, count?: number): void {
  handle.status[layerId] = status;
  if (count !== undefined) handle.featureCount[layerId] = count;
  handle.onStatusChange?.(layerId, status, count);
}

/**
 * Tear-down helpers for layer removers. MapLibre fires a console-visible
 * ErrorEvent for "cannot remove non-existing layer/source" even when the
 * call sits in a try/catch, so removers check existence first — an add that
 * early-returned or failed validation must not log noise on toggle-off.
 */
export function removeLayerIfPresent(map: maplibregl.Map, layerId: string): void {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
}

export function removeSourceIfPresent(map: maplibregl.Map, sourceId: string): void {
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

// Lives in the shared lib so the globe's data fetchers use the same helpers.
export { warnLayerError, domEventCause } from "@/lib/diagnostics";

/**
 * Web Mercator tile coordinate conversion. Returns the integer `{x, y}` tile
 * indices containing (lat, lon) in decimal degrees at the given zoom, using
 * the standard slippy-map scheme (x counts east from the antimeridian, y
 * counts south from ~85.05°N; latitudes beyond that clamp through the
 * Mercator formula rather than being rejected).
 */
export function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}
