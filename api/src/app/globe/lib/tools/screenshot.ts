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

export function downloadScreenshot(dataUrl: string, filename?: string) {
  const link = document.createElement("a");
  link.download = filename || `openzenith-${Date.now()}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
