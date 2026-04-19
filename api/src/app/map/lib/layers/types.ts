export type LayerStatus = "idle" | "loading" | "loaded" | "error" | "empty";

export interface LayerHandle {
  intervals: ReturnType<typeof setInterval>[];
  cleanup?: () => void;
  status: Record<string, LayerStatus>;
  featureCount: Record<string, number>;
  onStatusChange?: (layerId: string, status: LayerStatus, count?: number) => void;
}

export function createLayerHandle(
  onStatusChange?: (layerId: string, status: LayerStatus, count?: number) => void,
): LayerHandle {
  return { intervals: [], status: {}, featureCount: {}, onStatusChange };
}

export function setStatus(handle: LayerHandle, layerId: string, status: LayerStatus, count?: number): void {
  handle.status[layerId] = status;
  if (count !== undefined) handle.featureCount[layerId] = count;
  handle.onStatusChange?.(layerId, status, count);
}

/** Web Mercator tile coordinate conversion. */
export function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}
