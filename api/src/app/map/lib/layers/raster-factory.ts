import type { LayerHandle } from "./types";
import { setStatus } from "./types";
import { warnLayerError } from "@/lib/diagnostics";

/**
 * Declarative description of a plain raster-tile overlay (one raster source
 * + one raster layer fed from tile URL templates). Every add/remove pair in
 * this directory that is exactly that shape delegates here instead of
 * repeating the guarded-add/try-catch/status/remove boilerplate.
 */
export interface RasterLayerSpec {
  /** MapLibre source id. Also the default for `layerId` and `statusId`. */
  sourceId: string;
  /** Tile URL templates (`{z}/{x}/{y}` or a WMS `{bbox-epsg-3857}`). */
  tiles: string[];
  /** `raster-opacity` for the layer. */
  opacity: number;
  /** Minimum zoom the source requests tiles at (default 0). */
  minzoom?: number;
  /** Maximum zoom the source requests tiles at (default 22 — MapLibre's own default). */
  maxzoom?: number;
  /** Tile size in px (default 256). */
  tileSize?: number;
  /** Layer id (default `${sourceId}-raster`). */
  layerId?: string;
  /**
   * Extra raster paint properties merged after `raster-opacity` (so a
   * `raster-opacity` here wins). Use for saturation/contrast/brightness.
   */
  paint?: Record<string, unknown>;
  /** Id statuses are reported under (default `sourceId`). */
  statusId?: string;
  /** Set `false` for silent overlays that report no handle status (default true). */
  reportStatus?: boolean;
  /** Source attribution string. */
  attribution?: string;
}

/**
 * Add a raster overlay described by `spec`, reporting "loaded"/"error" on
 * the handle under the spec's status id.
 *
 * Adds are guarded per part (source, then layer), so the loader is
 * idempotent and self-healing: calling it twice is a no-op, and a previous
 * partial failure (source added, layer add threw) is repaired on the next
 * call instead of bricking the toggle. `reportStatus: false` keeps the
 * handle untouched but still routes failures through `warnLayerError` —
 * the same "user sees nothing, developer sees why" contract as the
 * status-reporting loaders.
 */
export function addRasterLayer(map: maplibregl.Map, handle: LayerHandle, spec: RasterLayerSpec): void {
  const layerId = spec.layerId ?? `${spec.sourceId}-raster`;
  const statusId = spec.statusId ?? spec.sourceId;
  try {
    if (!map.getSource(spec.sourceId)) {
      map.addSource(spec.sourceId, {
        type: "raster",
        tiles: spec.tiles,
        tileSize: spec.tileSize ?? 256,
        minzoom: spec.minzoom ?? 0,
        maxzoom: spec.maxzoom ?? 22,
        ...(spec.attribution ? { attribution: spec.attribution } : {}),
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "raster",
        source: spec.sourceId,
        paint: { "raster-opacity": spec.opacity, ...spec.paint },
      });
    }
    if (spec.reportStatus !== false) setStatus(handle, statusId, "loaded");
  } catch (err) {
    warnLayerError(statusId, err);
    if (spec.reportStatus !== false) setStatus(handle, statusId, "error");
  }
}

/** Remove a raster overlay's layer then source, ignoring "not found" errors. */
export function removeRasterLayer(map: maplibregl.Map, sourceId: string, layerId?: string): void {
  try {
    map.removeLayer(layerId ?? `${sourceId}-raster`);
  } catch {}
  try {
    map.removeSource(sourceId);
  } catch {}
}
