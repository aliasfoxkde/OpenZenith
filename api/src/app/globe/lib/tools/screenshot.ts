/**
 * Screenshot capture tool for Cesium viewer.
 */

/**
 * Renders the viewer once and returns its canvas as a PNG data URL. `viewer`
 * stays nullable because the ToolsWidget caller reads the viewer ref without a
 * truthiness guard; absent viewer/canvas — or a render or serialisation
 * failure — yields null instead of throwing.
 */
export function captureScreenshot(viewer: CesiumType.Viewer | null | undefined): string | null {
  const scene = viewer?.scene;
  if (!viewer || !scene?.canvas) return null;
  try {
    viewer.render();
    return scene.canvas.toDataURL("image/png");
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
