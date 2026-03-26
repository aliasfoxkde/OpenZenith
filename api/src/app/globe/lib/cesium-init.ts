import { switchBasemapOnViewer } from "./helpers";
import type { DashboardState } from "./types";

/**
 * Load CesiumJS and satellite.js from CDN if not already present.
 */
async function loadScripts(): Promise<{ Cesium: any; satJs: any }> {
  const w = window as any;

  if (!w.Cesium) {
    w.CESIUM_BASE_URL = "https://unpkg.com/cesium@1.119/Build/Cesium/";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/cesium@1.119/Build/Cesium/Widgets/widgets.css";
    document.head.appendChild(css);

    const js = document.createElement("script");
    js.src = "https://unpkg.com/cesium@1.119/Build/Cesium/Cesium.js";
    document.head.appendChild(js);
    await new Promise<void>((res, rej) => {
      js.onload = () => res();
      js.onerror = rej;
    });
  }

  if (!w.satellite) {
    const sj = document.createElement("script");
    sj.src = "https://cdnjs.cloudflare.com/ajax/libs/satellite.js/5.0.0/satellite.min.js";
    document.head.appendChild(sj);
    await new Promise<void>((res) => {
      sj.onload = () => res();
    });
  }

  return { Cesium: w.Cesium, satJs: w.satellite };
}

export interface CesiumInitResult {
  viewer: any;
  Cesium: any;
  destroy: () => void;
}

/**
 * Create and configure the Cesium viewer.
 *
 * Fixes applied in Phase 17:
 * - `logarithmicDepthBuffer = true` for depth precision at all zoom levels
 * - `frustum.far = 500_000_000` (5x max zoom distance) so Earth stays visible
 */
export async function initCesiumViewer(
  container: HTMLElement,
  initialState: DashboardState,
): Promise<CesiumInitResult> {
  const { Cesium } = await loadScripts();

  const viewer = new Cesium.Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    vrButton: false,
    infoBox: false,
    selectionIndicator: false,
    sceneMode: Cesium.SceneMode.SCENE3D,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    // Phase 17 fix: enable logarithmic depth buffer for correct rendering
    // at extreme zoom ranges (close terrain + far Earth visibility)
    logarithmicDepthBuffer: true,
  });

  // ─── Scene configuration ───
  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e17");
  scene.backgroundColor = Cesium.Color.BLACK;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = true;
  scene.screenSpaceCameraController.enableCollisionDetection = true;

  // Phase 17 fix: extend frustum far plane to 500M meters (5x max zoom distance)
  // Previously 50M which caused Earth to clip/disappear when zoomed out
  viewer.camera.frustum.far = 500_000_000;

  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 100_000_000;

  // Gesture / input configuration
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.minimumZoomRate = 5000;          // slow down zoom near surface
  ssc.maximumZoomRate = 500000;        // fast zoom from orbit
  ssc.zoomFactor = 3.0;                // scroll wheel zoom multiplier
  ssc.inertiaSpin = 0.92;              // reduce rotation drift
  ssc.inertiaTranslate = 0.92;         // reduce pan drift
  ssc.inertiaZoom = 0.92;              // reduce zoom drift
  ssc.enableRotate = true;
  ssc.enableTranslate = true;
  ssc.enableZoom = true;
  ssc.enableTilt = true;
  ssc.enableLook = true;
  // Smooth zoom with momentum
  ssc.minimumCollisionTerrainHeight = 10000;

  if (scene.skyBox) scene.skyBox.show = true;

  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;

  // ─── Initial camera position ───
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      initialState.center[0],
      initialState.center[1],
      15000000,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  switchBasemapOnViewer(viewer, initialState.basemap);

  return {
    viewer,
    Cesium,
    destroy: () => viewer.destroy(),
  };
}
