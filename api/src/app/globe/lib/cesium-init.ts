import { switchBasemapOnViewer } from "./helpers";
import type { DashboardState } from "./types";

/**
 * Create an elevation color map canvas for the globe material.
 * Maps elevation values to colors:
 *   Deep ocean (-8000m): dark navy
 *   Shallow ocean (-500m): medium blue
 *   Coastline (0m): sandy/light
 *   Low land (0-500m): green
 *   Mid elevation (500-2000m): yellow-brown
 *   High elevation (2000-5000m): orange-brown
 *   Peaks (5000m+): white/snow
 */
function createElevationColorMap(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0.0, "#0a1628");   // Deep ocean
  gradient.addColorStop(0.15, "#0d2847");   // Mid ocean
  gradient.addColorStop(0.35, "#1a5276");   // Shallow ocean
  gradient.addColorStop(0.44, "#2980b9");   // Coastal water
  gradient.addColorStop(0.48, "#5dade2");   // Near shore
  gradient.addColorStop(0.50, "#aed6f1");   // Shoreline
  gradient.addColorStop(0.52, "#f9e79f");   // Beach
  gradient.addColorStop(0.55, "#82e0aa");   // Lowland green
  gradient.addColorStop(0.62, "#27ae60");   // Mid elevation
  gradient.addColorStop(0.72, "#f4d03f");   // Highland yellow
  gradient.addColorStop(0.82, "#e67e22");   // Mountain orange
  gradient.addColorStop(0.90, "#a04000");   // High mountain
  gradient.addColorStop(0.96, "#d35400");   // Alpine
  gradient.addColorStop(1.0, "#f0f0f0");   // Snow/peak

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  return canvas;
}

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
    maximumRenderTimeChange: 2.0,
    // Phase 17 fix: enable logarithmic depth buffer for correct rendering
    // at extreme zoom ranges (close terrain + far Earth visibility)
    logarithmicDepthBuffer: true,
  });

  // ─── Scene configuration ───
  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e17");
  scene.backgroundColor = Cesium.Color.fromCssColorString("#000000");
  scene.skyAtmosphere.show = true;
  scene.skyAtmosphere.hueShift = 0.0;
  scene.skyAtmosphere.saturationShift = 0.0;
  scene.skyAtmosphere.brightnessShift = 0.0;
  scene.fog.enabled = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = true;
  scene.globe.lightingFadeInDistance = 0;
  scene.globe.lightingFadeOutDistance = 1e8;
  scene.screenSpaceCameraController.enableCollisionDetection = true;

  // Improve rendering quality
  scene.postProcessStages.fxaa.enabled = true;
  scene.globe.show = true;

  // ─── Terrain: Cesium World Terrain (includes GEBCO bathymetry) ───
  try {
    const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
      requestVertexNormals: true,
    });
    viewer.terrainProvider = terrainProvider;
    scene.globe.depthTestAgainstTerrain = false; // Don't depth-test entities against terrain
  } catch {
    // Cesium Ion not available — continue without terrain
  }

  // ─── Custom globe material: depth-based coloring ───
  // Shows bathymetry (ocean depth) in blue gradients and land in green/brown
  try {
    const elevationColorMaterial = new Cesium.Material({
      fabric: {
        type: "ElevationColorMap",
        uniforms: {
          image: createElevationColorMap(),
          minimumHeight: -8000,
          maximumHeight: 9000,
        },
      },
    });
    scene.globe.material = elevationColorMaterial;
  } catch {
    // Material not supported — continue with default
  }

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
