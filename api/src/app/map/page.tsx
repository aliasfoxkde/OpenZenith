"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { Toolbar } from "@/components/Toolbar";
import { SurveillancePanel, CoordinateReadout, LayerToggle, StatusIndicator } from "@/components/SurveillanceUI";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import { LAYERS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/layers/registry";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MapLoading } from "@/components/MapLoading";
import { addDataLayer, removeDataLayer, MAP_2D_LAYER_IDS, type LayerHandle } from "./lib/layers";
import {
  createMeasureController,
  type MeasureMode,
  pathDistance,
  sphericalPolygonArea,
  formatDistance,
  formatArea,
} from "./lib/measure";
import { exportMapScreenshot } from "@/lib/map-export";
import { getClientElevation } from "@/lib/client-elevation";

/* ─── Types ─── */

interface ElevationPin {
  lat: number;
  lon: number;
  elevation: number | null;
}

interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  basemap: string;
  layers: Record<string, boolean>;
}

/* ─── Constants ─── */

const BASEMAPS: Record<string, { label: string; url: string; attribution: string }> = {
  dark: {
    label: "Dark",
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    attribution: "&copy; CartoDB &copy; OSM",
  },
  voyager: {
    label: "Voyager",
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    attribution: "&copy; CartoDB &copy; OSM",
  },
  light: {
    label: "Light",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    attribution: "&copy; CartoDB &copy; OSM",
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
  },
  topo: {
    label: "Topographic",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap",
  },
};

const BOUNDARIES_URL = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

const DEFAULT_STATE: MapViewState = {
  center: [0, 20],
  zoom: 2,
  bearing: 0,
  pitch: 0,
  basemap: "dark",
  layers: buildDefaultLayers(),
};

function buildDefaultLayers(): Record<string, boolean> {
  const layers: Record<string, boolean> = {
    // Map-specific layers
    hillshade: true,
    contour: false,
    terrain3d: false,
    boundaries: true,
  };
  // Registry defaults for 2D-compatible layers
  for (const layer of LAYERS) {
    if (MAP_2D_LAYER_IDS.has(layer.id)) {
      layers[layer.id] = layer.defaultEnabled;
    }
  }
  return layers;
}

/* ─── Helpers ─── */

function loadMapLibre(): Promise<void> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve();
  if (w._maplibreLoading) return w._maplibreLoading;
  w._maplibreLoading = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[href*="maplibre-gl"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js";
    js.onload = () => resolve();
    js.onerror = () => reject(new Error("MapLibre GL script failed to load"));
    document.head.appendChild(js);
  });
  return w._maplibreLoading;
}

function waitForMapLibre(timeoutMs = 15000): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  return loadMapLibre().then(
    () =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const iv = setInterval(() => {
          if (w.maplibregl) {
            clearInterval(iv);
            resolve(w.maplibregl);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(iv);
            reject(new Error("MapLibre GL failed to load"));
          }
        }, 100);
      }),
  );
}

/* ─── Boundary data ─── */

let topojsonLib: any = null;
let boundariesGeoJSON: any = null;

async function loadTopojsonLib(): Promise<any> {
  if (topojsonLib) return topojsonLib;
  const w = window as any;
  if (w.topojson) return (topojsonLib = w.topojson);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/topojson-client@3/dist/topojson-client.min.js";
    s.onload = () => {
      topojsonLib = w.topojson;
      resolve(topojsonLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function loadBoundariesData(): Promise<any> {
  if (boundariesGeoJSON) return boundariesGeoJSON;
  try {
    const topo = await loadTopojsonLib();
    const res = await fetch(BOUNDARIES_URL);
    if (!res.ok) return null;
    const world = await res.json();
    boundariesGeoJSON = topo.feature(world, world.objects.countries);
    return boundariesGeoJSON;
  } catch {
    return null;
  }
}

function parseHash(hash: string): Partial<MapViewState> {
  try {
    const h = hash.replace(/^#/, "");
    if (!h) return {};
    const params = new URLSearchParams(h);
    // x/y/z = tile coordinates → compute center from tile
    const tx = params.get("x");
    const ty = params.get("y");
    const tz = params.get("z");
    if (tx && ty && tz) {
      const x = Number(tx),
        y = Number(ty),
        z = Number(tz);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z) && z >= 0 && z <= 22) {
        const n = Math.pow(2, z);
        const lng = (x / n) * 360 - 180;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
        const lat = (latRad * 180) / Math.PI;
        return {
          center: [lng, lat],
          zoom: z,
          bearing: params.has("b") ? Number(params.get("b")) : undefined,
          pitch: params.has("p") ? Number(params.get("p")) : undefined,
          basemap: params.get("bm") || undefined,
        };
      }
    }
    // lng/lat/zoom = center coordinates
    const c = params.get("c");
    const lng = params.get("lng");
    const lat = params.get("lat");
    let center: [number, number] | undefined;
    if (c) {
      const parts = c.split(",").map(Number);
      if (parts.length === 2 && parts.every((n) => !isNaN(n))) center = parts as [number, number];
    } else if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }
    const zoomVal = params.get("zoom");
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      bearing: params.has("b") ? Number(params.get("b")) : undefined,
      pitch: params.has("p") ? Number(params.get("p")) : undefined,
      basemap: params.get("bm") || undefined,
    };
  } catch {
    return {};
  }
}

function buildHash(state: MapViewState): string {
  const p = new URLSearchParams();
  p.set("lng", state.center[0].toFixed(4));
  p.set("lat", state.center[1].toFixed(4));
  p.set("zoom", state.zoom.toFixed(1));
  if (state.bearing) p.set("b", state.bearing.toFixed(1));
  if (state.pitch) p.set("p", state.pitch.toFixed(1));
  if (state.basemap !== "dark") p.set("bm", state.basemap);
  return "#" + p.toString();
}

/* ─── Component ─── */

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapState, setMapState] = useState<MapViewState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...parseHash(window.location.hash) };
  });
  const [pins, setPins] = useState<ElevationPin[]>([]);
  const [activePin, setActivePin] = useState<ElevationPin | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fetchingElevation, setFetchingElevation] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>(null);
  const mlglRef = useRef<any>(null);
  const pinsRef = useRef<any[]>([]);
  const updateHashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const layerHandleRef = useRef<LayerHandle>({ intervals: [] });
  const measureRef = useRef(createMeasureController());
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const measureModeRef = useRef<MeasureMode>("none");
  const measurePointsRef = useRef<[number, number][]>([]);

  // Sync hash on state change
  useEffect(() => {
    clearTimeout(updateHashTimeout.current);
    updateHashTimeout.current = setTimeout(() => {
      window.history.replaceState(null, "", buildHash(mapState));
    }, 300);
  }, [mapState]);

  // Measure mode handlers
  const clearMeasure = useCallback(() => {
    setMeasureMode("none");
    setMeasurePoints([]);
    const map = mapRef.current;
    if (map) measureRef.current.removeLayers(map);
  }, []);

  const toggleMeasureMode = useCallback(
    (mode: MeasureMode) => {
      if (measureMode === mode) {
        clearMeasure();
        measureModeRef.current = "none";
        return;
      }
      measureModeRef.current = mode;
      setMeasureMode(mode);
      setMeasurePoints([]);
      measurePointsRef.current = [];
      const map = mapRef.current;
      if (map) {
        measureRef.current.removeLayers(map);
        measureRef.current.addLayers(map);
      }
    },
    [measureMode, clearMeasure],
  );

  // Update measure layers when points change
  useEffect(() => {
    if (measureMode === "none") return;
    const map = mapRef.current;
    if (map) measureRef.current.updateMap(map, measurePoints, measureMode);
  }, [measurePoints, measureMode]);

  // Keyboard shortcut: Escape to cancel measure
  useEffect(() => {
    if (measureMode === "none") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearMeasure();
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setMeasurePoints((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [measureMode, clearMeasure]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled) return;
        mlglRef.current = mlgl;

        const basemap = BASEMAPS[mapState.basemap] || BASEMAPS.dark;

        const map = new mlgl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              basemap: { type: "raster", tiles: [basemap.url], tileSize: 256, attribution: basemap.attribution },
            },
            layers: [{ id: "basemap", type: "raster", source: "basemap" }],
            ...(mapState.basemap === "dark"
              ? { glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" }
              : {}),
          },
          center: mapState.center,
          zoom: mapState.zoom,
          bearing: mapState.bearing || 0,
          pitch: mapState.pitch || 0,
          maxZoom: 15,
          antialias: true,
        });

        // Add elevation protocol and source
        map.on("load", () => {
          if (cancelled) return;
          addElevationSource(map, mlgl);
          if (mapState.layers.boundaries) addBoundaryLayers(map);
          // Load initially-enabled data layers from registry
          for (const layer of LAYERS) {
            if (MAP_2D_LAYER_IDS.has(layer.id) && mapState.layers[layer.id]) {
              addDataLayer(map, layerHandleRef.current, layer.id);
            }
          }
          setLoading(false);
        });

        map.on("click", async (e: any) => {
          const { lat, lng } = e.lngLat;

          // Measure mode: add point instead of elevation pin
          if (measureModeRef.current !== "none") {
            const pt: [number, number] = [lng, lat];
            measurePointsRef.current = [...measurePointsRef.current, pt];
            setMeasurePoints([...measurePointsRef.current]);
            return;
          }
          setFetchingElevation(true);
          setCtxMenu(null);

          try {
            const data = await getClientElevation(lat, lng);
            const pin: ElevationPin = { lat, lon: lng, elevation: data?.elevation ?? null };
            setPins((prev) => [...prev.slice(-49), pin]);
            setActivePin(pin);
            addPinMarker(map, mlgl, pin, pinsRef);
          } catch {
            const pin: ElevationPin = { lat, lon: lng, elevation: null };
            setPins((prev) => [...prev.slice(-49), pin]);
            setActivePin(pin);
            addPinMarker(map, mlgl, pin, pinsRef);
          } finally {
            setFetchingElevation(false);
          }
        });

        map.on("moveend", () => {
          if (cancelled) return;
          const c = map.getCenter();
          setMapState((prev) => ({
            ...prev,
            center: [c.lng, c.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch(),
          }));
        });

        map.on("mousemove", (e: any) => {
          setCursorPos({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        });
        map.on("mouseout", () => setCursorPos(null));

        map.addControl(new mlgl.NavigationControl(), "top-right");
        map.addControl(new mlgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

        // Right-click context menu
        map.getCanvas().addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          const rect = map.getCanvas().getBoundingClientRect();
          const point = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
          setCtxMenu({ x: e.clientX, y: e.clientY, lng: point.lng, lat: point.lat });
        });
        map.getCanvas().addEventListener("click", () => setCtxMenu(null), true);
        document.addEventListener(
          "click",
          (e) => {
            if (!(e.target as HTMLElement).closest(".map-ctx-menu")) setCtxMenu(null);
          },
          true,
        );

        mapRef.current = map;
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      // Clear data layer refresh intervals
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const handle = layerHandleRef.current;
      handle.intervals.forEach(clearInterval);
      handle.intervals = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch basemap
  const switchBasemap = useCallback(
    (key: string) => {
      const map = mapRef.current;
      const mlgl = mlglRef.current;
      if (!map || !mlgl) return;
      const bm = BASEMAPS[key];
      if (!bm) return;

      map.setStyle({
        version: 8,
        sources: { basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attribution } },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
        ...(key === "dark" ? { glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" } : {}),
      });

      map.once("styledata", () => {
        addElevationSource(map, mlgl);
        // Re-add hillshade/terrain/boundaries if enabled
        if (mapState.layers.hillshade) addDataLayer(map, layerHandleRef.current, "hillshade");
        if (mapState.layers.terrain3d) enable3DTerrain(map);
        if (mapState.layers.boundaries) addBoundaryLayers(map);
      });

      setMapState((prev) => ({ ...prev, basemap: key }));
    },
    [mapState.layers],
  );

  // Toggle layer
  const toggleLayer = useCallback((layerName: string, enabled: boolean) => {
    const map = mapRef.current;
    const mlgl = mlglRef.current;
    if (!map || !mlgl) return;

    setMapState((prev) => {
      const layers = { ...prev.layers, [layerName]: enabled };

      if (layerName === "terrain3d") {
        if (enabled) enable3DTerrain(map);
        else disable3DTerrain(map);
      }

      if (layerName === "contour") {
        // Contour is a visual hint — actual contour generation would need server-side
      }

      if (layerName === "boundaries") {
        if (enabled) addBoundaryLayers(map);
        else removeBoundaryLayers(map);
      }

      // Data layers from shared registry
      if (MAP_2D_LAYER_IDS.has(layerName)) {
        if (enabled) addDataLayer(map, layerHandleRef.current, layerName);
        else removeDataLayer(map, layerName);
      }

      return { ...prev, layers };
    });
  }, []);

  // Reset view
  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [0, 20], zoom: 2, bearing: 0, pitch: 0, duration: 1500 });
  }, []);

  // Clear pins
  const clearPins = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      pinsRef.current.forEach((m) => m.remove());
      pinsRef.current = [];
    }
    setPins([]);
    setActivePin(null);
  }, []);

  // Search via geocode API
  const handleSearch = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      if (data.results?.length > 0) {
        const r = data.results[0];
        const map = mapRef.current;
        if (map) map.flyTo({ center: [Number(r.lon), Number(r.lat)], zoom: 12, duration: 1500 });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Jump to coordinates
  const handleJumpTo = useCallback((lat: number, lon: number) => {
    const map = mapRef.current;
    if (map) map.flyTo({ center: [lon, lat], zoom: 10, duration: 1500 });
  }, []);

  // Screenshot
  const handleScreenshot = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    const link = document.createElement("a");
    link.download = `openzenith-map-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg }}>
      {/* Top bar */}
      <Navbar
        dark
        breadcrumb="Map"
        extra={
          <>
            {/* Elevation result */}
            {activePin && (
              <div
                style={{
                  background: T.panel,
                  border: `1px solid ${T.border}`,
                  borderRadius: 4,
                  padding: "0.2rem 0.6rem",
                  fontFamily: T.fontMono,
                  fontSize: "0.78rem",
                  color: T.text,
                  boxShadow: T.glowSubtle,
                }}
              >
                {activePin.elevation !== null ? (
                  <span>
                    <span
                      style={{
                        color: T.green,
                        fontWeight: 600,
                        letterSpacing: "0.03em",
                        textShadow: "0 0 8px rgba(34, 197, 94, 0.4)",
                      }}
                    >
                      {activePin.elevation.toLocaleString()}m
                    </span>
                    <span style={{ color: T.textMuted, marginLeft: "0.5rem", letterSpacing: "0.02em" }}>
                      {activePin.lat.toFixed(4)}, {activePin.lon.toFixed(4)}
                    </span>
                  </span>
                ) : (
                  <span style={{ color: T.textMuted }}>No data</span>
                )}
              </div>
            )}

            {fetchingElevation && (
              <span style={{ color: T.accent, fontSize: "0.75rem", fontFamily: T.fontMono }}>querying...</span>
            )}

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 4,
                color: sidebarOpen ? T.accent : T.textMuted,
                padding: "0.2rem 0.5rem",
                cursor: "pointer",
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
              }}
            >
              Layers
            </button>
          </>
        }
      />

      {/* Map */}
      <div style={{ flex: 1, position: "relative" }}>
        {/* Toolbar overlay */}
        <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
          <Toolbar onSearch={handleSearch} onJumpTo={handleJumpTo} onScreenshot={handleScreenshot} />
        </div>

        {/* Measure tools */}
        <div style={{ position: "absolute", top: 52, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
          <button
            onClick={() => toggleMeasureMode("distance")}
            title="Measure distance (Esc to cancel)"
            style={{
              background: measureMode === "distance" ? T.accent : T.panel,
              border: `1px solid ${measureMode === "distance" ? T.accent : T.border}`,
              borderRadius: 4,
              color: measureMode === "distance" ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            RULER
          </button>
          <button
            onClick={() => toggleMeasureMode("area")}
            title="Measure area (Esc to cancel)"
            style={{
              background: measureMode === "area" ? T.accent : T.panel,
              border: `1px solid ${measureMode === "area" ? T.accent : T.border}`,
              borderRadius: 4,
              color: measureMode === "area" ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            AREA
          </button>
          {measureMode !== "none" && (
            <button
              onClick={clearMeasure}
              title="Clear measurement"
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 4,
                color: T.red,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: T.fontMono,
              }}
            >
              CLR
            </button>
          )}
        </div>

        {/* Measure result */}
        {measureMode !== "none" && measurePoints.length >= 2 && (
          <div
            style={{
              position: "absolute",
              top: 86,
              left: 8,
              zIndex: 10,
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              padding: "6px 10px",
              fontFamily: T.fontMono,
              fontSize: "0.75rem",
              color: T.accent,
              backdropFilter: "blur(8px)",
              boxShadow: T.glowSubtle,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div>
              {measureMode === "distance"
                ? `Distance: ${formatDistance(pathDistance(measurePoints))}`
                : `Area: ${formatArea(sphericalPolygonArea(measurePoints))}`}
            </div>
            {measureMode === "distance" && measurePoints.length >= 2 && (
              <div style={{ fontSize: "0.65rem", color: T.textMuted }}>Segments: {measurePoints.length - 1}</div>
            )}
            <div style={{ fontSize: "0.65rem", color: T.textMuted }}>
              {measurePoints.length} point{measurePoints.length > 1 ? "s" : ""} | Esc to cancel | Ctrl+Z undo
            </div>
          </div>
        )}

        {/* Coordinate readout */}
        <div style={{ position: "absolute", bottom: 8, left: 8, zIndex: 10 }}>
          <SurveillancePanel style={{ padding: "0.3rem 0.6rem" }}>
            {cursorPos ? (
              <CoordinateReadout lat={cursorPos.lat} lon={cursorPos.lon} zoom={mapState.zoom} />
            ) : (
              <span
                style={{ fontFamily: T.fontMono, fontSize: "0.75rem", color: T.textMuted, letterSpacing: "0.05em" }}
              >
                LAT ----.----- | LON ----.-----
              </span>
            )}
          </SurveillancePanel>
        </div>

        {/* Status indicators */}
        <div style={{ position: "absolute", bottom: 8, right: 8, zIndex: 10 }}>
          <SurveillancePanel style={{ padding: "0.3rem 0.6rem", display: "flex", gap: 12, alignItems: "center" }}>
            <StatusIndicator
              color={loading ? T.amber : T.green}
              label={loading ? "LOADING" : "READY"}
              pulse={loading}
            />
            {pins.length > 0 && <StatusIndicator color={T.accent} label={`${pins.length} PINS`} />}
            <button
              onClick={() => exportMapScreenshot(mapRef.current!, "openzenith-map")}
              title="Export screenshot"
              aria-label="Export map screenshot as PNG"
              style={{
                background: "none",
                border: `1px solid ${T.border}`,
                color: T.textMuted,
                padding: "2px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: T.fontMono,
                letterSpacing: "0.05em",
              }}
            >
              EXPORT
            </button>
          </SurveillancePanel>
        </div>

        {ctxMenu && (
          <div
            className="map-ctx-menu"
            style={{
              position: "absolute",
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 30,
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: "4px 0",
              minWidth: 180,
              boxShadow: T.glow,
              backdropFilter: "blur(8px)",
            }}
          >
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`);
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.text,
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy coordinates
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`);
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.text,
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy compact
            </button>
            <button
              onClick={() => {
                const toDms = (d: number, pos: string, neg: string) => {
                  const dir = d >= 0 ? pos : neg;
                  const a = Math.abs(d);
                  const deg = Math.floor(a);
                  const min = Math.floor((a - deg) * 60);
                  const sec = ((a - deg - min / 60) * 3600).toFixed(2);
                  return `${deg}\u00b0${min}'${sec}"${dir}`;
                };
                navigator.clipboard.writeText(`${toDms(ctxMenu.lat, "N", "S")} ${toDms(ctxMenu.lng, "E", "W")}`);
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.text,
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy DMS
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${ctxMenu.lng.toFixed(6)},${ctxMenu.lat.toFixed(6)}`);
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.text,
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy lng,lat
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${ctxMenu.lng.toFixed(6)}, ${ctxMenu.lat.toFixed(6)}`);
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.text,
                fontSize: "0.78rem",
                fontFamily: T.fontMono,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy lat,lng
            </button>
            <button
              onClick={() => {
                window.open(
                  `https://www.openstreetmap.org/?mlat=${ctxMenu.lat}&mlon=${ctxMenu.lng}#map=17/${ctxMenu.lat}/${ctxMenu.lng}`,
                  "_blank",
                );
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.accent,
                fontSize: "0.8rem",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Open in OSM
            </button>
            <button
              onClick={async () => {
                try {
                  const d = await getClientElevation(ctxMenu.lat, ctxMenu.lng);
                  navigator.clipboard.writeText(
                    `${d?.elevation !== null && d?.elevation !== undefined ? d.elevation + "m" : "No data"} @ ${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`,
                  );
                } catch {
                  /* ignore */
                }
                setCtxMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                color: T.green,
                fontSize: "0.8rem",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Copy elevation
            </button>
          </div>
        )}
        <ErrorBoundary>
          <div
            ref={containerRef}
            style={{
              width: "100%",
              height: "100%",
              cursor: measureMode !== "none" ? "cell" : "crosshair",
            }}
          />
        </ErrorBoundary>

        {/* Loading */}
        {!loading && loadError && <MapLoading error dark message="Failed to load MapLibre GL" />}
        {loading && !loadError && <MapLoading dark message="Initializing map..." />}

        {/* Sidebar */}
        {sidebarOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 280,
              height: "100%",
              background: T.panel,
              backdropFilter: "blur(12px)",
              borderLeft: `1px solid ${T.border}`,
              boxShadow: T.glow,
              padding: "0.75rem",
              overflowY: "auto",
              zIndex: 50,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: T.text,
                  fontSize: "0.85rem",
                  fontFamily: T.fontMono,
                  letterSpacing: "0.05em",
                }}
              >
                MAP CONTROLS
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: T.textMuted,
                  cursor: "pointer",
                  fontSize: "1.2rem",
                }}
              >
                &times;
              </button>
            </div>

            {/* Basemap selector */}
            <SurveillancePanel title="Basemap" style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {Object.entries(BASEMAPS).map(([key, bm]) => (
                  <button
                    key={key}
                    onClick={() => switchBasemap(key)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: 3,
                      border: mapState.basemap === key ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
                      background: mapState.basemap === key ? `${T.accent}22` : "transparent",
                      color: mapState.basemap === key ? T.accent : T.textMuted,
                      cursor: "pointer",
                      fontSize: "0.72rem",
                      fontFamily: T.fontMono,
                      boxShadow: mapState.basemap === key ? `0 0 6px ${T.accent}33` : "none",
                    }}
                  >
                    {bm.label}
                  </button>
                ))}
              </div>
            </SurveillancePanel>

            {/* Layer toggles — registry-driven */}
            {CATEGORY_ORDER.filter((cat) => cat !== "space" && cat !== "imagery").map((cat) => {
              const layers = LAYERS.filter(
                (l) =>
                  l.category === cat &&
                  (MAP_2D_LAYER_IDS.has(l.id) || ["hillshade", "terrain3d", "boundaries", "contour"].includes(l.id)),
              );
              if (layers.length === 0) return null;
              return (
                <SurveillancePanel key={cat} title={CATEGORY_LABELS[cat] || cat} style={{ marginBottom: "0.75rem" }}>
                  {layers.map((layer) => (
                    <div
                      key={layer.id}
                      style={{
                        padding: "0.35rem 0",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      <LayerToggle
                        label={layer.name}
                        checked={!!mapState.layers[layer.id]}
                        onChange={(checked) => toggleLayer(layer.id, checked)}
                        color={layer.accent}
                      />
                      <div style={{ color: T.textMuted, fontSize: "0.65rem", marginLeft: 18, marginTop: -2 }}>
                        {layer.description}
                      </div>
                    </div>
                  ))}
                </SurveillancePanel>
              );
            })}

            {/* View controls */}
            <SurveillancePanel title="View" style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <button onClick={resetView} style={{ ...btnStyle, flex: 1 }}>
                  Reset View
                </button>
                <button onClick={clearPins} style={{ ...btnStyle, flex: 1 }}>
                  Clear Pins
                </button>
              </div>
            </SurveillancePanel>

            {/* Coordinate info */}
            <SurveillancePanel title="Position" style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: T.fontMono, fontSize: "0.72rem", color: T.textMuted, lineHeight: 1.8 }}>
                <div>
                  Center:{" "}
                  <span style={{ color: T.accent }}>
                    {mapState.center[0].toFixed(4)}, {mapState.center[1].toFixed(4)}
                  </span>
                </div>
                <div>
                  Zoom: <span style={{ color: T.accent }}>{mapState.zoom.toFixed(1)}</span>
                  {" | Bearing: "}
                  <span style={{ color: T.accent }}>{(mapState.bearing || 0).toFixed(0)}</span>&deg;
                  {" | Pitch: "}
                  <span style={{ color: T.accent }}>{(mapState.pitch || 0).toFixed(0)}</span>&deg;
                </div>
              </div>
            </SurveillancePanel>

            {/* Pin history */}
            {pins.length > 0 && (
              <SurveillancePanel title={`Pins (${pins.length})`} style={{ marginBottom: "0.75rem" }}>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {[...pins]
                    .reverse()
                    .slice(0, 20)
                    .map((p, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          const map = mapRef.current;
                          if (map) map.flyTo({ center: [p.lon, p.lat], zoom: 12, duration: 1000 });
                          setActivePin(p);
                        }}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "0.25rem 0",
                          borderBottom: `1px solid ${T.border}`,
                          cursor: "pointer",
                          fontSize: "0.72rem",
                          fontFamily: T.fontMono,
                        }}
                      >
                        <span style={{ color: T.green }}>{p.elevation !== null ? `${p.elevation}m` : "---"}</span>
                        <span style={{ color: T.textMuted }}>
                          {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                        </span>
                      </div>
                    ))}
                </div>
              </SurveillancePanel>
            )}

            {/* Share URL */}
            <SurveillancePanel title="Share">
              <div
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${T.border}`,
                  borderRadius: 3,
                  padding: "0.35rem 0.5rem",
                  fontSize: "0.65rem",
                  color: T.textMuted,
                  wordBreak: "break-all",
                  fontFamily: T.fontMono,
                }}
              >
                {window.location.origin + buildHash(mapState)}
              </div>
            </SurveillancePanel>
          </div>
        )}

        {/* Click hint */}
        {mapState.layers.terrain3d && (
          <div
            style={{
              position: "absolute",
              bottom: "2rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: T.panel,
              border: `1px solid ${T.border}`,
              color: T.textMuted,
              padding: "0.35rem 0.75rem",
              borderRadius: 4,
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              pointerEvents: "none",
              zIndex: 5,
              boxShadow: T.glowSubtle,
            }}
          >
            Right-click + drag to rotate terrain &middot; Scroll to zoom &middot; Click to query elevation
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Map helpers ─── */

function addElevationSource(map: any, _mlgl: any) {
  // Only add if not already present
  if (map.getSource("elevation")) return;

  map.addSource("elevation", {
    type: "raster-dem",
    tiles: ["/api/dem-tile/{z}/{x}/{y}"],
    tileSize: 256,
    maxzoom: 10,
    encoding: "terrarium",
  });
}

function addBoundaryLayers(map: any) {
  if (map.getLayer("boundaries-glow")) return;
  loadBoundariesData().then((data) => {
    if (!data || !map.getSource) return;
    try {
      if (!map.getSource("boundaries")) {
        map.addSource("boundaries", { type: "geojson", data });
      }
      if (!map.getLayer("boundaries-glow")) {
        map.addLayer({
          id: "boundaries-glow",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "rgba(0, 229, 255, 0.12)", "line-width": 8, "line-blur": 5 },
        });
      }
      if (!map.getLayer("boundaries-glow-inner")) {
        map.addLayer({
          id: "boundaries-glow-inner",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "rgba(0, 229, 255, 0.4)", "line-width": 2.5, "line-blur": 1.5 },
        });
      }
      if (!map.getLayer("boundaries-core")) {
        map.addLayer({
          id: "boundaries-core",
          type: "line",
          source: "boundaries",
          paint: { "line-color": "#00e5ff", "line-width": 1, "line-opacity": 0.8 },
        });
      }
    } catch {
      /* map may have been removed */
    }
  });
}

function removeBoundaryLayers(map: any) {
  ["boundaries-core", "boundaries-glow-inner", "boundaries-glow"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("boundaries");
  } catch {}
}

function enable3DTerrain(map: any) {
  if (!map.getSource("elevation")) return;
  try {
    map.setTerrain({ source: "elevation", exaggeration: 1.5 });
  } catch {}
}

function disable3DTerrain(map: any) {
  try {
    map.setTerrain(undefined as any);
  } catch {}
}

function addPinMarker(map: any, mlgl: any, pin: ElevationPin, pinsStore: React.MutableRefObject<any[]>) {
  const el = document.createElement("div");
  el.style.cssText = `
    display: flex; flex-direction: column; align-items: center; cursor: pointer;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
  `;
  el.innerHTML = `
    <div style="
      background: rgba(10,15,26,0.9); color: ${T.green}; padding: 2px 8px; border-radius: 4px;
      font-size: 11px; font-weight: 600; font-family: ${T.fontMono}; white-space: nowrap;
      border: 1px solid ${T.border}; box-shadow: 0 0 8px rgba(34,197,94,0.3);
      letter-spacing: 0.03em;
      text-shadow: 0 0 8px rgba(34,197,94,0.4);
    ">${pin.elevation !== null ? pin.elevation.toLocaleString() + "m" : "No data"}</div>
    <div style="
      color: #94a3b8; font-size: 9px; font-family: ${T.fontMono}; white-space: nowrap;
      letter-spacing: 0.02em; margin-top: -1px;
    ">${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}</div>
    <svg width="12" height="8" viewBox="0 0 12 8"><path d="M6 8L0 0h12z" fill="rgba(10,15,26,0.9)"/></svg>
    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${T.green}; border: 2px solid ${T.bg}; margin-top: -2px; box-shadow: 0 0 6px ${T.green};"></div>
  `;

  const marker = new mlgl.Marker({ element: el, anchor: "bottom" }).setLngLat([pin.lon, pin.lat]).addTo(map);

  pinsStore.current.push(marker);
  // Keep only last 50 markers
  while (pinsStore.current.length > 50) {
    pinsStore.current.shift().remove();
  }
}

/* ─── Styles ─── */

const btnStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 3,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.textMuted,
  cursor: "pointer",
  fontSize: "0.72rem",
  fontFamily: T.fontMono,
};
