/* eslint-disable @typescript-eslint/no-explicit-any */
import { switchBasemapOnViewer } from "./helpers";
import { createOZTTerrainProvider } from "./terrain-ozt2";
import { createCSRTerrainProvider } from "./terrain-csr";
import type { DashboardState } from "./types";

const CESIUM_CDNS = [
  "https://unpkg.com/cesium@1.119/Build/Cesium/",
  "https://cdn.jsdelivr.net/npm/cesium@1.119/Build/Cesium/",
];

/**
 * Load CesiumJS from CDN with fallback support.
 * If primary CDN fails, tries secondary. If all fail, throws.
 */
async function loadCesiumWithFallback(baseUrl: string, timeoutMs = 15000): Promise<any> {
  const w = window as any;
  if (w.Cesium) return w.Cesium;

  // Load CSS
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${baseUrl}Widgets/widgets.css`;
  document.head.appendChild(css);

  for (const cdn of CESIUM_CDNS) {
    try {
      await new Promise<void>((resolve, reject) => {
        const js = document.createElement("script");
        js.src = `${cdn}Cesium.js`;
        js.onload = () => resolve();
        js.onerror = () => reject(new Error(`CDN failed: ${cdn}`));
        // Timeout
        const t = setTimeout(() => {
          js.remove();
          reject(new Error("Timeout"));
        }, timeoutMs);
        js.onload = () => {
          clearTimeout(t);
          resolve();
        };
        js.onerror = () => {
          clearTimeout(t);
          reject(new Error(`CDN failed: ${cdn}`));
        };
        document.head.appendChild(js);
      });
      w.CESIUM_BASE_URL = cdn;
      return w.Cesium;
    } catch {
      // Try next CDN
    }
  }
  throw new Error("All Cesium CDN sources failed");
}

/**
 * Load CesiumJS and satellite.js from CDN.
 * Includes timeout and fallback CDN support.
 */
async function loadScripts(): Promise<{ Cesium: any; satJs: any }> {
  const w = window as any;

  // Load both scripts — Cesium with CDN fallback, satellite.js with timeout
  const cesiumPromise = loadCesiumWithFallback(CESIUM_CDNS[0]);

  const satJsPromise = new Promise<void>((resolve) => {
    if (w.satellite) {
      resolve();
      return;
    }
    const sj = document.createElement("script");
    sj.src = "https://cdnjs.cloudflare.com/ajax/libs/satellite.js/5.0.0/satellite.min.js";
    const t = setTimeout(() => {
      // Satellite.js is optional — continue without it if it fails
      resolve();
    }, 10000);
    sj.onload = () => {
      clearTimeout(t);
      resolve();
    };
    sj.onerror = () => {
      clearTimeout(t);
      resolve();
    }; // Don't fail the whole init
    document.head.appendChild(sj);
  });

  const cesium = await cesiumPromise;
  await satJsPromise;
  return { Cesium: cesium, satJs: w.satellite };
}

export interface CesiumInitResult {
  viewer: any;
  Cesium: any;
  destroy: () => void;
  addCloudOverlay: () => void;
}

/**
 * Create and configure the Cesium viewer.
 *
 * Key configuration:
 * - Ion token undefined → no 401 spam from Cesium Ion default assets
 * - logarithmicDepthBuffer → correct rendering at all zoom levels
 * - frustum.far = 500M → Earth visible from space
 * - CSR terrain provider → SRTM from HuggingFace, falls back to server tiles
 * - No default Ion imagery → prevents 401 on api.cesium.com
 */
export async function initCesiumViewer(
  container: HTMLElement,
  initialState: DashboardState,
): Promise<CesiumInitResult> {
  const { Cesium } = await loadScripts();

  // ─── Kill ALL Cesium Ion default asset loading ───
  // Setting only defaultAccessToken is insufficient — CesiumJS 1.119 also
  // fetches default imagery assets from Ion even without a token.
  // These cause 401 errors in the console.
  Cesium.Ion.defaultAccessToken = undefined;
  Cesium.Ion._terrainProvider = undefined;
  // Override the imageryProvider factory so Viewer() never creates Ion defaults
  const origCreateDefaultImageryProvider = Cesium.createDefaultImageryProvider;
  Cesium.createDefaultImageryProvider = () => {
    // Return an empty UrlTemplateImageryProvider pointing to nothing
    // The basemap system replaces this via switchBasemapOnViewer anyway
    return new Cesium.UrlTemplateImageryProvider({ url: "https://example.com/{z}/{x}/{y}.png" });
  };

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
    // logDepthBuffer: true would also work, but logarithmicDepthBuffer is
    // more robust across the full zoom range (surface to deep space)
    logarithmicDepthBuffer: true,
  });

  // Restore factory after Viewer() has been constructed
  Cesium.createDefaultImageryProvider = origCreateDefaultImageryProvider;

  // ─── Scene configuration ───
  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e17");
  scene.backgroundColor = Cesium.Color.fromCssColorString("#000000");
  scene.skyAtmosphere.show = true;
  scene.skyAtmosphere.hueShift = -0.02;
  scene.skyAtmosphere.saturationShift = 0.2;
  scene.skyAtmosphere.brightnessShift = 0.1;
  scene.fog.enabled = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = true;
  scene.globe.lightingFadeInDistance = 0;
  scene.globe.lightingFadeOutDistance = 1e8;
  scene.screenSpaceCameraController.enableCollisionDetection = true;
  scene.postProcessStages.fxaa.enabled = false;
  scene.globe.show = true;

  // ─── Terrain: OZT2-first CesiumJS terrain provider ───
  // OZT2 tiles are pre-generated and stored in R2 (~93% smaller than PNG).
  // Falls back to PNG tiles (on-the-fly from HuggingFace) when OZT2 not in R2.
  // Further falls back to CSR-direct HuggingFace if server is unreachable.
  viewer.terrainProvider = createOZTTerrainProvider(Cesium);
  scene.globe.depthTestAgainstTerrain = true;

  // Remove all default imagery layers (Ion or otherwise)
  // The basemap system adds its own via switchBasemapOnViewer
  viewer.imageryLayers.removeAll();

  // Phase 17 fix: extend frustum far plane to 500M meters
  // This prevents Earth from clipping/disappearing when zoomed out to space
  viewer.camera.frustum.far = 500_000_000;

  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 100_000_000;

  // Gesture / input configuration
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.minimumZoomRate = 5000;
  ssc.maximumZoomRate = 500000;
  ssc.zoomFactor = 3.0;
  ssc.inertiaSpin = 0.92;
  ssc.inertiaTranslate = 0.92;
  ssc.inertiaZoom = 0.92;
  ssc.enableRotate = true;
  ssc.enableTranslate = true;
  ssc.enableZoom = true;
  ssc.enableTilt = true;
  ssc.enableLook = true;
  ssc.minimumCollisionTerrainHeight = 10000;

  if (scene.skyBox) scene.skyBox.show = true;

  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;

  // ─── Initial camera position ───
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(initialState.center[0], initialState.center[1], 15000000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  switchBasemapOnViewer(viewer, initialState.basemap);

  // Cloud overlay (semi-transparent, always on)
  function addCloudOverlay() {
    const d = new Date();
    d.setDate(d.getDate() - 1); // Yesterday's date for MODIS Terra imagery
    const yesterday = d.toISOString().split("T")[0];

    const provider = new Cesium.UrlTemplateImageryProvider({
      url:
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best" +
        `/MODIS_Terra_CorrectedReflectance_TrueColor/default/${yesterday}` +
        "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg",
      credit: "",
      maximumLevel: 9,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.25;
  }

  return {
    viewer,
    Cesium,
    destroy: () => viewer.destroy(),
    addCloudOverlay,
  };
}
