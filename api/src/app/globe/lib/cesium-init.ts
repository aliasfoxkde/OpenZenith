import { switchBasemapOnViewer } from "./helpers";
import { createOZTTerrainProvider } from "./terrain-ozt2";
import type { DashboardState } from "./types";

// First-party assets copied by scripts/copy-vendor-assets.mjs (predev /
// prepages:build). Loaded first so the globe never depends on a third-party
// CDN for its render-critical path: CESIUM_BASE_URL pins where Cesium
// dynamically imports its Workers from, and a mid-session worker-fetch
// failure on a CDN stops the whole render loop. The CDNs remain as
// explicit fallback (partial deploy, stripped install).
const CESIUM_LOCAL = "/cesium/";
const CESIUM_CDNS = [
  "https://cdn.jsdelivr.net/npm/cesium@1.119/Build/Cesium/",
  "https://unpkg.com/cesium@1.119/Build/Cesium/",
];
const SATELLITE_LOCAL = "/vendor/satellite.min.js";
const SATELLITE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/satellite.js/5.0.0/satellite.min.js";

/**
 * Load CesiumJS from the first source that answers, local assets first.
 * If the local copy fails, tries the CDNs in order. If all fail, throws.
 */
async function loadCesiumWithFallback(timeoutMs = 15000): Promise<typeof CesiumType | undefined> {
  const w = window;
  if (w.Cesium) return w.Cesium;

  // Load CSS from the local copy — widget styling is cosmetic, and unlike
  // the Workers below it is not version-pinned per source at runtime.
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${CESIUM_LOCAL}Widgets/widgets.css`;
  document.head.appendChild(css);

  for (const source of [CESIUM_LOCAL, ...CESIUM_CDNS]) {
    try {
      await new Promise<void>((resolve, reject) => {
        const js = document.createElement("script");
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
          reject(new Error(`Cesium source failed: ${source}`));
        };
        js.src = `${source}Cesium.js`;
        document.head.appendChild(js);
      });
      w.CESIUM_BASE_URL = source;
      return w.Cesium;
    } catch {
      // Try next source
    }
  }
  throw new Error("All Cesium sources failed (local + CDN)");
}

/**
 * Load CesiumJS and satellite.js from CDN.
 * Includes timeout and fallback CDN support.
 */
async function loadScripts(): Promise<{
  Cesium: typeof CesiumType | undefined;
  satJs: Window["satellite"];
}> {
  const w = window;

  // Load both scripts — Cesium local-first with CDN fallback, satellite.js
  // local-first with the same non-fatal timeout.
  const cesiumPromise = loadCesiumWithFallback();

  const satJsPromise = new Promise<void>((resolve) => {
    if (w.satellite) {
      resolve();
      return;
    }
    const sj = document.createElement("script");
    const finish = () => {
      clearTimeout(t);
      resolve();
    };
    // Satellite.js is optional — continue without it if every source fails.
    const t = setTimeout(finish, 10000);
    sj.onload = finish;
    sj.onerror = () => {
      if (sj.src.endsWith(SATELLITE_LOCAL)) {
        sj.src = SATELLITE_CDN; // fall back to the CDN copy
      } else {
        finish(); // Don't fail the whole init
      }
    };
    sj.src = SATELLITE_LOCAL;
    document.head.appendChild(sj);
  });

  const cesium = await cesiumPromise;
  await satJsPromise;
  return { Cesium: cesium, satJs: w.satellite };
}

/**
 * What initCesiumViewer hands back once the CDN scripts and the viewer are
 * up. `viewer` is the configured Cesium.Viewer — created with
 * requestRenderMode, so callers must call scene.requestRender() after mutating
 * entities or imagery — and `Cesium` is the narrowed, non-undefined namespace
 * it was built from. `destroy()` is a thin wrapper over viewer.destroy()
 * (drops the canvas and its listeners; it does not clear page refs). The
 * optional-effect addCloudOverlay() appends one more imagery layer each call,
 * never toggling: yesterday's NASA GIBS MODIS Terra true color, level 9 max,
 * at alpha 0.25.
 */
export interface CesiumInitResult {
  viewer: CesiumType.Viewer;
  Cesium: typeof CesiumType;
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
  // loadCesiumWithFallback can hand back undefined if the script tag loaded
  // but the global never appeared — fail with a clear message (the original
  // code hit the same catch via a TypeError on `Cesium.Ion`).
  if (!Cesium) throw new Error("Cesium failed to load from all CDN sources");

  // ─── Kill ALL Cesium Ion default asset loading ───
  // Without a token every Ion request 401s on api.cesium.com. CesiumJS 1.119
  // builds its default base layer via createWorldImageryAsync() →
  // IonImageryProvider.fromAssetId(2) unless `baseLayer` is passed — the old
  // createDefaultImageryProvider factory is never called, so the only
  // effective kill switch is `baseLayer: false` below. The basemap system
  // installs its own imagery via switchBasemapOnViewer().
  Cesium.Ion.defaultAccessToken = undefined;

  const viewer = new Cesium.Viewer(container, {
    // No Ion default imagery — the basemap system owns all layers.
    baseLayer: false,
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
  // Arrow (not a function declaration) so TS carries the non-undefined
  // narrowing of `Cesium` from the guard above into the closure.
  const addCloudOverlay = () => {
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
  };

  return {
    viewer,
    Cesium,
    destroy: () => {
      viewer.destroy();
    },
    addCloudOverlay,
  };
}
