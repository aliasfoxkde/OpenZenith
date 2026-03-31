/**
 * Map export utility.
 *
 * Captures the current MapLibre GL map canvas as a PNG image
 * and triggers a browser download.
 */

export function exportMapScreenshot(map: { getCanvas?: () => HTMLCanvasElement }, filename = "openzenith-map") {
  const canvas = map.getCanvas?.();
  if (!canvas) return;

  const link = document.createElement("a");
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
