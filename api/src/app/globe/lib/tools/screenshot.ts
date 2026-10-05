/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Screenshot capture tool for Cesium viewer.
 */

export function captureScreenshot(viewer: any): string | null {
  if (!viewer?.scene?.canvas) return null;
  try {
    viewer.render();
    return viewer.scene.canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Triggers a browser download of a PNG data URL (typically the string returned
 * by captureScreenshot). Inserts a temporary anchor into document.body with
 * `download` set to `filename` or `openzenith-<epoch ms>.png`, clicks it, and
 * removes the node — a DOM side effect, no network request.
 */
export function downloadScreenshot(dataUrl: string, filename?: string) {
  const link = document.createElement("a");
  link.download = filename || `openzenith-${Date.now()}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
