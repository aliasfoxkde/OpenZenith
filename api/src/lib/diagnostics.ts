/**
 * Shared client-side diagnostics helpers.
 *
 * Layer code on both the 2D map (MapLibre) and 3D globe (CesiumJS) degrades
 * gracefully when a data source fails — the UI keeps working. These helpers
 * make sure the underlying cause still reaches the console instead of
 * vanishing into a bare catch.
 */

/**
 * Log a layer failure with its exception before flagging "error" status —
 * the status badge tells users THAT the layer failed, this tells developers
 * WHY. Benign teardown catches (removeLayer idempotence) don't use this.
 */
export function warnLayerError(layerId: string, err: unknown, scope = "fetch"): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[layer:${layerId}] ${scope} failed: ${message}`);
}

/**
 * Extract the cause from a DOM error event (WebSocket onerror payloads are
 * typed as plain Event, losing ErrorEvent's error/message fields).
 */
export function domEventCause(ev: Event): unknown {
  const detailed = ev as ErrorEvent;
  return detailed.error ?? detailed.message ?? ev;
}
