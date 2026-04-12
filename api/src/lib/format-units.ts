/** Format a distance for display. Supports metric and imperial units. */
export function formatDistance(meters: number, imperial = false): string {
  if (imperial) {
    const ft = meters * 3.28084;
    if (ft >= 5280) return `${(ft / 5280).toFixed(2)} mi`;
    return `${ft.toFixed(1)} ft`;
  }
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

/** Format an area for display. Supports metric and imperial units. */
export function formatArea(sqMeters: number, imperial = false): string {
  if (imperial) {
    const sqFt = sqMeters * 10.7639;
    if (sqFt >= 43560 * 640) return `${(sqFt / (43560 * 640)).toFixed(2)} mi\u00B2`;
    if (sqFt >= 43560) return `${(sqFt / 43560).toFixed(2)} ac`;
    return `${sqFt.toFixed(1)} ft\u00B2`;
  }
  if (sqMeters >= 1e6) return `${(sqMeters / 1e6).toFixed(2)} km\u00B2`;
  if (sqMeters >= 1e4) return `${(sqMeters / 1e4).toFixed(2)} ha`;
  return `${sqMeters.toFixed(1)} m\u00B2`;
}
