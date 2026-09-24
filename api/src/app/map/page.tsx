"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { Toolbar } from "@/components/Toolbar";
import { SurveillancePanel, CoordinateReadout, LayerToggle, StatusIndicator } from "@/components/SurveillanceUI";
import {
  AnnotationsListPanel,
  EarthquakeTimelinePanel,
  HurricaneAnimationPanel,
  MapLegend,
  PinHistoryPanel,
  ShareUrlPanel,
  btnStyle,
} from "./panels";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import { LAYERS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/layers/registry";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MapLoading } from "@/components/MapLoading";
import { waitForMapLibre } from "@/app/landing/maplibre-loader";
import {
  addDataLayer,
  removeDataLayer,
  MAP_2D_LAYER_IDS,
  createLayerHandle,
  type LayerHandle,
  setEarthquakeFeed,
  setEarthquakeTimeFilter,
  getEarthquakeTimeRange,
  refreshEarthquakeFilter,
  startHurricaneAnimation,
  stopHurricaneAnimation,
} from "./lib/layers";
import {
  renderAnnotations,
  loadAnnotations,
  saveAnnotations,
  randomColor,
  uid,
} from "./lib/layers/annotations";
import {
  createMeasureController,
  type MeasureMode,
  pathDistance,
  sphericalPolygonArea,
  formatDistance,
  formatArea,
} from "./lib/measure";
import {
  addElevationSource,
  addPinMarker,
  addBoundaryLayers,
  addLabelLayer,
  disable3DTerrain,
  enable3DTerrain,
  removeBoundaryLayers,
  reorderMapLayers,
} from "./lib/map-setup";
import {
  BOOKMARKS_KEY,
  DEFAULT_STATE,
  LAYER_STATE_KEY,
  buildHash,
  parseHash,
  type ElevationPin,
  type MapViewState,
} from "./lib/view-state";
import { exportMapScreenshot } from "@/lib/map-export";
import { getClientElevation } from "@/lib/client-elevation";
import { BASEMAPS, BASEMAP_ORDER, getBasemap } from "@/lib/basemaps";

/* ─── Component ─── */

/** Per-layer load report recorded by the layer handle callback. */
interface LayerStatusEntry {
  status: string;
  count?: number;
}

const RASTER_LAYERS = new Set([
  "hillshade",
  "elevationColor",
  "elevationAccuracy",
  "contours",
  "bathymetry",
  "radar",
  "sentinel2",
  "nightLights",
  "marineWeather",
  "populationDensity",
  "landCover",
  "seaIce",
  "satellite",
  "floods",
  "fireTemperature",
  "sarBackscatter",
]);

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapState, setMapState] = useState<MapViewState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...parseHash(window.location.hash) };
  });
  const [pins, setPins] = useState<ElevationPin[]>([]);
  const [activePin, setActivePin] = useState<ElevationPin | null>(null);

  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("openzenith-map-opacity");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const setOpacity = useCallback((layerId: string, value: number) => {
    setLayerOpacity((prev) => {
      const next = { ...prev, [layerId]: value };
      try {
        localStorage.setItem("openzenith-map-opacity", JSON.stringify(next));
      } catch {}
      return next;
    });
    const map = mapRef.current;
    if (!map) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style = (map as any).getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        if (layer.id.startsWith(layerId) && layer.type === "raster") {
          map.setPaintProperty(layer.id, "raster-opacity", value / 100);
        }
        if (layer.id.startsWith(layerId) && layer.type === "hillshade") {
          map.setPaintProperty(layer.id, "hillshade-opacity", value / 100);
        }
        if (layer.id.startsWith(layerId) && layer.type === "symbol") {
          map.setPaintProperty(layer.id, "text-opacity", value / 100);
        }
      }
    } catch {
      /* getStyle may not be available */
    }
  }, []);

  // Toast notifications for layer errors
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: "error" | "info" }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((msg: string, type: "error" | "info" = "error") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, msg, type }]);
    setTimeout(() => { setToasts((prev) => prev.filter((t) => t.id !== id)); }, 6000);
  }, []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [fetchingElevation, setFetchingElevation] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>(null);
  const mlglRef = useRef<MapLibreGL | null>(null);
  const pinsRef = useRef<maplibregl.Marker[]>([]);
  const updateHashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [layerStatus, setLayerStatus] = useState<Record<string, LayerStatusEntry | undefined>>({});

  // Derived map health status from load error and layer statuses
  const mapHealth = useMemo(() => {
    if (loadError) return "error";
    if (loading) return "loading";
    const hasError = Object.values(layerStatus).some((s) => s?.status === "error");
    if (hasError) return "degraded";
    return "ok";
  }, [loadError, loading, layerStatus]);
  const layerHandleRef = useRef<LayerHandle>(
    createLayerHandle((layerId, status, count) => {
      setLayerStatus((prev) => ({ ...prev, [layerId]: { status, count } }));
      if (status === "error") {
        showToast(`${layerId}: failed to load`, "error");
      }
    }),
  );
  const measureRef = useRef(createMeasureController());
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const measureModeRef = useRef<MeasureMode>("none");
  const measurePointsRef = useRef<[number, number][]>([]);

  const [coordFormat, setCoordFormat] = useState<"dd" | "dms">("dd");

  // Earthquake time filter
  const [eqFeed, setEqFeed] = useState("7d");
  const [eqTimeSlider, setEqTimeSlider] = useState<number | null>(null); // null = all
  const [eqRange, setEqRange] = useState<{ min: number; max: number }>({
    min: Date.now() - 604800000,
    max: Date.now(),
  });
  const [eqPlaying, setEqPlaying] = useState(false);
  const eqPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleEqFeedChange = useCallback((feed: string) => {
    setEqFeed(feed);
    setEarthquakeFeed(feed);
    setEqTimeSlider(null);
    setEarthquakeTimeFilter(null);
  }, []);

  const handleEqTimeChange = useCallback((val: number) => {
    setEqTimeSlider(val);
    setEarthquakeTimeFilter(val);
    const map = mapRef.current;
    if (map) refreshEarthquakeFilter(map);
  }, []);

  const handleEqPlay = useCallback(() => {
    if (eqPlaying) {
      if (eqPlayRef.current) clearInterval(eqPlayRef.current);
      setEqPlaying(false);
      return;
    }
    const range = getEarthquakeTimeRange();
    setEqRange(range);
    if (range.max - range.min < 1000) return;
    setEqPlaying(true);
    let t = range.min;
    eqPlayRef.current = setInterval(() => {
      t += (range.max - range.min) / 100;
      if (t >= range.max) {
        t = range.max;
        if (eqPlayRef.current) clearInterval(eqPlayRef.current);
        setEqPlaying(false);
      }
      setEqTimeSlider(t);
      setEarthquakeTimeFilter(t);
      const map = mapRef.current;
      if (map) refreshEarthquakeFilter(map);
    }, 100);
    // eqRange is intentionally absent: the range is re-read from the feed
    // (getEarthquakeTimeRange) on every play, not from the last-rendered state.
  }, [eqPlaying]);

  const handleEqShowAll = useCallback(() => {
    setEqTimeSlider(null);
    setEarthquakeTimeFilter(null);
    const map = mapRef.current;
    if (map) refreshEarthquakeFilter(map);
  }, []);

  /* Hurricane animation */
  const [hurricaneAnimating, setHurricaneAnimating] = useState(false);
  const [hurricaneProgress, setHurricaneProgress] = useState(0);

  const toggleHurricaneAnimation = useCallback(() => {
    const map = mapRef.current;
    const handle = layerHandleRef.current;
    if (!map) return;
    if (hurricaneAnimating) {
      stopHurricaneAnimation(map, handle);
      setHurricaneAnimating(false);
      setHurricaneProgress(0);
    } else {
      setHurricaneAnimating(true);
      startHurricaneAnimation(map, handle, setHurricaneProgress);
    }
  }, [hurricaneAnimating]);

  // Stop hurricane animation when layer is toggled off
  useEffect(() => {
    if (!mapState.layers.hurricaneTracks && hurricaneAnimating) {
      const map = mapRef.current;
      const handle = layerHandleRef.current;
      if (map) stopHurricaneAnimation(map, handle);
      setHurricaneAnimating(false);
      setHurricaneProgress(0);
    }
  }, [mapState.layers.hurricaneTracks, hurricaneAnimating]);

  const formatCoord = useCallback(
    (lat: number, lon: number) => {
      if (coordFormat === "dms") {
        const toDms = (v: number, pos: string, neg: string) => {
          const a = Math.abs(v);
          const d = Math.floor(a);
          const m = Math.floor((a - d) * 60);
          const s = ((a - d - m / 60) * 3600).toFixed(1);
          return `${d}°${m}'${s}"${v >= 0 ? pos : neg}`;
        };
        return `${toDms(lat, "N", "S")} ${toDms(lon, "E", "W")}`;
      }
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    },
    [coordFormat],
  );

  // Elevation profile state
  const [profileData, setProfileData] = useState<{ distance: number; elevation: number }[] | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Annotation drawing state
  type DrawMode = "none" | "point" | "line" | "polygon";
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const drawModeRef = useRef<DrawMode>("none");
  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [annotations, setAnnotations] = useState<import("./lib/layers/annotations").Annotation[]>(() =>
    loadAnnotations(),
  );
  const drawPointsRef = useRef<[number, number][]>([]);
  const drawVertexRef = useRef<maplibregl.Marker[]>([]);
  const [annotationName, setAnnotationName] = useState("");

  const renderAnnotationsOnMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    renderAnnotations(map, annotations);
  }, [annotations]);

  // Re-render annotations when they change
  useEffect(() => {
    renderAnnotationsOnMap();
  }, [renderAnnotationsOnMap]);

  const finishDrawing = useCallback(() => {
    const pts = drawPointsRef.current;
    const mode = drawModeRef.current;
    if (mode === "none" || pts.length === 0) return;

    let ann: import("./lib/layers/annotations").Annotation;
    if (mode === "point" && pts.length >= 1) {
      ann = {
        id: uid(),
        type: "point",
        coordinates: [pts[0]],
        color: randomColor(),
        name: annotationName || `Pin ${annotations.length + 1}`,
        timestamp: Date.now(),
      };
    } else if (mode === "line" && pts.length >= 2) {
      ann = {
        id: uid(),
        type: "line",
        coordinates: pts,
        color: randomColor(),
        name: annotationName || `Line ${annotations.length + 1}`,
        timestamp: Date.now(),
      };
    } else if (mode === "polygon" && pts.length >= 3) {
      ann = {
        id: uid(),
        type: "polygon",
        coordinates: pts,
        color: randomColor(),
        name: annotationName || `Area ${annotations.length + 1}`,
        timestamp: Date.now(),
      };
    } else {
      return; // Not enough points
    }

    const next = [...annotations, ann];
    setAnnotations(next);
    saveAnnotations(next);
    setAnnotationName("");

    // Clear draw state
    drawPointsRef.current = [];
    drawVertexRef.current.forEach((m) => m.remove());
    drawVertexRef.current = [];
    setDrawMode("none");
    drawModeRef.current = "none";

    // Remove draw source
    const map = mapRef.current;
    if (map) {
      try {
        map.removeLayer("draw-preview-line");
      } catch {}
      try {
        map.removeLayer("draw-preview-fill");
      } catch {}
      try {
        map.removeSource("draw-preview");
      } catch {}
    }
    // drawMode state is intentionally absent — the mode is read from
    // drawModeRef.current so the callback stays valid between renders.
  }, [annotations, annotationName]);

  const cancelDrawing = useCallback(() => {
    drawPointsRef.current = [];
    drawVertexRef.current.forEach((m) => m.remove());
    drawVertexRef.current = [];
    setDrawMode("none");
    drawModeRef.current = "none";
    setAnnotationName("");
    const map = mapRef.current;
    if (map) {
      try {
        map.removeLayer("draw-preview-line");
      } catch {}
      try {
        map.removeLayer("draw-preview-fill");
      } catch {}
      try {
        map.removeSource("draw-preview");
      } catch {}
    }
  }, []);

  const deleteAnnotation = useCallback(
    (id: string) => {
      const next = annotations.filter((a) => a.id !== id);
      setAnnotations(next);
      saveAnnotations(next);
    },
    [annotations],
  );

  const clearAnnotations = useCallback(() => {
    setAnnotations([]);
    saveAnnotations([]);
  }, []);

  const fetchElevationProfile = useCallback(async (points: [number, number][]) => {
    if (points.length < 2) {
      setProfileData(null);
      return;
    }
    setProfileLoading(true);
    try {
      const [start, end] = points;
      const steps = Math.min(
        50,
        Math.max(10, Math.round((Math.sqrt((start[0] - end[0]) ** 2 + (start[1] - end[1]) ** 2) * 111) / 5)),
      );
      const lats: number[] = [];
      const lons: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        lats.push(start[0] + (end[0] - start[0]) * t);
        lons.push(start[1] + (end[1] - start[1]) * t);
      }
      const res = await fetch(`/api/elevation/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: lats.map((lat, i) => [lat, lons[i]]) }),
      });
      const data = await res.json();
      const elevations = data?.elevations || data?.results || [];
      let dist = 0;
      const profile = [{ distance: 0, elevation: elevations[0] ?? 0 }];
      for (let i = 1; i <= steps; i++) {
        const dlat = (lats[i] - lats[i - 1]) * 111320;
        const dlon = (lons[i] - lons[i - 1]) * 111320 * Math.cos((lats[i] * Math.PI) / 180);
        dist += Math.sqrt(dlat * dlat + dlon * dlon);
        profile.push({ distance: Math.round(dist), elevation: elevations[i] ?? 0 });
      }
      setProfileData(profile);
    } catch {
      setProfileData(null);
    }
    setProfileLoading(false);
  }, []);

  // Bookmarks system
  type Bookmark = {
    name: string;
    center: [number, number];
    zoom: number;
    layers: Record<string, boolean>;
    timestamp: number;
  };
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      const saved = localStorage.getItem(BOOKMARKS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [bookmarkName, setBookmarkName] = useState("");
  const [showBookmarks, setShowBookmarks] = useState(false);

  const saveBookmark = useCallback(() => {
    const name = bookmarkName.trim() || `View ${bookmarks.length + 1}`;
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const currentLayers = mapState.layers;
    const bm: Bookmark = {
      name,
      center: [center.lng, center.lat],
      zoom,
      layers: { ...currentLayers },
      timestamp: Date.now(),
    };
    const next = [...bookmarks, bm];
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    setBookmarkName("");
  }, [bookmarkName, bookmarks, mapState.layers]);

  const loadBookmark = useCallback((bm: Bookmark) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: bm.center, zoom: bm.zoom, duration: 1500 });
    setMapState((prev) => ({ ...prev, layers: bm.layers }));
    localStorage.setItem(LAYER_STATE_KEY, JSON.stringify(bm.layers));
  }, []);

  const deleteBookmark = useCallback(
    (idx: number) => {
      const next = bookmarks.filter((_, i) => i !== idx);
      setBookmarks(next);
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    },
    [bookmarks],
  );

  // Keep mapStateRef current for localStorage persistence
  useEffect(() => {
    mapStateRef.current = mapState;
  }, [mapState]);

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
    setProfileData(null);
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
    // Fetch elevation profile when 2+ points in distance mode
    if (measureMode === "distance" && measurePoints.length >= 2) {
      void fetchElevationProfile(measurePoints);
    }
  }, [measurePoints, measureMode, fetchElevationProfile]);

  // Detect mobile viewport
  useEffect(() => {
    const check = () => { setIsMobile(window.innerWidth < 768); };
    check();
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("resize", check); };
  }, []);

  // Touch swipe to close sidebar on mobile
  useEffect(() => {
    if (!sidebarOpen || !isMobile) return;
    let startX = 0;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (dx > 60) setSidebarOpen(false); // swipe right to close
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [sidebarOpen, isMobile]);

  // Close sidebar on outside click (mobile)
  useEffect(() => {
    if (!sidebarOpen || !isMobile) return;
    const handler = (_e: Event) => { setSidebarOpen(false); };
    document.addEventListener("backbutton", handler);
    return () => { document.removeEventListener("backbutton", handler); };
  }, [sidebarOpen, isMobile]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
      if (e.key === "?" || e.key === "/") {
        e.preventDefault();
        setSidebarOpen(true);
      }
      if (e.key === "Escape") {
        setSidebarOpen(false);
      }
      // H toggles hillshade
      if (e.key === "h" || e.key === "H") {
        setMapState((prev) => ({
          ...prev,
          layers: { ...prev.layers, hillshade: !prev.layers.hillshade },
        }));
      }
      // R toggles radar
      if (e.key === "r" || e.key === "R") {
        setMapState((prev) => ({
          ...prev,
          layers: { ...prev.layers, radar: !prev.layers.radar },
        }));
      }
      // G toggles earthquakes
      if (e.key === "g" || e.key === "G") {
        setMapState((prev) => ({
          ...prev,
          layers: { ...prev.layers, earthquakes: !prev.layers.earthquakes },
        }));
      }
      // 3 toggles satellite imagery
      if (e.key === "3") {
        setMapState((prev) => ({
          ...prev,
          layers: { ...prev.layers, satellite: !prev.layers.satellite },
        }));
      }
      // P toggles measure mode
      if (e.key === "p" || e.key === "P") {
        if (measureMode === "none") setMeasureMode("distance");
        else setMeasureMode("none");
      }
      // B toggles boundaries
      if (e.key === "b" || e.key === "B") {
        setMapState((prev) => ({
          ...prev,
          layers: { ...prev.layers, boundaries: !prev.layers.boundaries },
        }));
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
    // measureMode must be live: with it missing this handler kept its mount-time
    // value and P could enter but never exit measure mode.
  }, [measureMode]);

  // Keyboard shortcuts for measure and draw modes
  useEffect(() => {
    if (measureMode === "none" && drawMode === "none") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawMode !== "none") cancelDrawing();
        else clearMeasure();
      }
      if (e.key === "Enter" && drawMode !== "none") {
        e.preventDefault();
        finishDrawing();
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (measureMode !== "none") setMeasurePoints((prev) => prev.slice(0, -1));
        if (drawMode !== "none") {
          drawPointsRef.current = drawPointsRef.current.slice(0, -1);
          const m = drawVertexRef.current.pop();
          m?.remove();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [measureMode, drawMode, clearMeasure, cancelDrawing, finishDrawing]);

  // Pause/resume layer polling when tab is hidden/visible
  useEffect(() => {
    const handle = layerHandleRef.current;

    const onVisibility = () => {
      if (document.hidden) {
        // Pause all intervals
        handle.intervals.forEach(clearInterval);
        handle.intervals = [];
      } else {
        // Resume: re-add layers (which will restart their intervals)
        const map = mapRef.current;
        if (!map) return;
        for (const layerId of MAP_2D_LAYER_IDS) {
          if (mapState.layers[layerId]) {
            addDataLayer(map, handle, layerId);
          }
        }
        // Restore hillshade if enabled
        if (mapState.layers.hillshade) addDataLayer(map, handle, "hillshade");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mapState.layers]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    const initMap = async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled) return;
        mlglRef.current = mlgl;

        const basemap = getBasemap(mapState.basemap);

        const isDark = basemap.isDark;

        const map = new mlgl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              basemap: { type: "raster", tiles: [basemap.url], tileSize: 256, attribution: basemap.attribution },
              ...(isDark
                ? {
                    land: {
                      type: "geojson",
                      data: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson`,
                    },
                  }
                : {}),
            },
            layers: [
              { id: "basemap", type: "raster", source: "basemap" },
              ...(isDark
                ? [
                    {
                      id: "land-contrast",
                      type: "fill" as const,
                      source: "land",
                      paint: {
                        "fill-color": "#1e3040",
                        "fill-opacity": 0.65,
                      },
                    },
                  ]
                : []),
            ],
            ...(isDark ? { glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" } : {}),
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
          try {
            addElevationSource(map, mlgl);
            // Phase 1: Terrain base layers (color, accuracy, bathymetry, contours)
            for (const layer of LAYERS) {
              if (layer.category === "terrain" && MAP_2D_LAYER_IDS.has(layer.id) && mapState.layers[layer.id]) {
                addDataLayer(map, layerHandleRef.current, layer.id);
              }
            }
            // Phase 2: Data layers (non-terrain, non-hillshade) on top of terrain
            for (const layer of LAYERS) {
              if (
                layer.category !== "terrain" &&
                layer.category !== "hillshade" &&
                MAP_2D_LAYER_IDS.has(layer.id) &&
                mapState.layers[layer.id]
              ) {
                addDataLayer(map, layerHandleRef.current, layer.id);
              }
            }
            // Phase 3: Hillshade — loaded last (on top of everything except labels)
            if (mapState.layers.hillshade) addDataLayer(map, layerHandleRef.current, "hillshade");
            // Phase 4: Labels on very top
            addLabelLayer(map, mapState.basemap);
            // Enforce z-order
            reorderMapLayers(map, mapState.layers);
          } catch (e) {
            console.error("Error adding layers:", e);
          }
          setLoading(false);
        });

        map.on("click", async (e: unknown) => {
          const ev = e as { lngLat: { lat: number; lng: number } };
          const { lat, lng } = ev.lngLat;

          // Measure mode: add point instead of elevation pin
          if (measureModeRef.current !== "none") {
            const pt: [number, number] = [lng, lat];
            measurePointsRef.current = [...measurePointsRef.current, pt];
            setMeasurePoints([...measurePointsRef.current]);
            return;
          }

          // Draw mode: add point to current drawing
          if (drawModeRef.current !== "none") {
            const pt: [number, number] = [lng, lat];
            drawPointsRef.current = [...drawPointsRef.current, pt];

            // Add vertex marker
            const el = document.createElement("div");
            el.style.cssText =
              "width:10px;height:10px;background:#00ff88;border:2px solid white;border-radius:50%;cursor:pointer;";
            const marker = new mlgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
            drawVertexRef.current.push(marker);

            // Update preview line/fill
            const src = map.getSource("draw-preview");
            const pts = drawPointsRef.current;
            if (src && pts.length >= 2) {
              const coords = [...pts, pts[0]] as [number, number][]; // close polygon preview
              if (drawModeRef.current === "polygon" && pts.length >= 3) {
                src.setData({
                  type: "FeatureCollection",
                  features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} }],
                });
              } else {
                src.setData({
                  type: "FeatureCollection",
                  features: [{ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} }],
                });
              }
            } else if (!src) {
              try {
                map.addSource("draw-preview", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
                map.addLayer({
                  id: "draw-preview-line",
                  type: "line",
                  source: "draw-preview",
                  paint: { "line-color": "#00ff88", "line-width": 2, "line-dasharray": [4, 2] },
                });
                map.addLayer({
                  id: "draw-preview-fill",
                  type: "fill",
                  source: "draw-preview",
                  paint: { "fill-color": "#00ff88", "fill-opacity": 0.1 },
                });
              } catch {}
            }

            // Auto-finish for point mode
            if (drawModeRef.current === "point") {
              setTimeout(() => { finishDrawing(); }, 0);
            }
            return;
          }
          setFetchingElevation(true);
          setCtxMenu(null);

          try {
            const data = await getClientElevation(lat, lng);
            const pin: ElevationPin = {
              lat,
              lon: lng,
              elevation: data.elevation,
              status: data.status,
              surfaceType: data.surfaceType,
            };
            setPins((prev) => [...prev.slice(-49), pin]);
            setActivePin(pin);
            addPinMarker(map, mlgl, pin, pinsRef);
          } catch {
            const pin: ElevationPin = { lat, lon: lng, elevation: null, status: "unavailable", surfaceType: "unknown" };
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

        map.on("mousemove", (e: unknown) => {
          const ev = e as { lngLat: { lat: number; lng: number } };
          // Debounce cursor updates — 100ms is still smooth for coordinate display
          // Prevents 60 full-component re-renders/second on mouse move
          if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
          cursorDebounceRef.current = setTimeout(() => {
            setCursorPos({ lat: ev.lngLat.lat, lon: ev.lngLat.lng });
          }, 80);
        });
        map.on("mouseout", () => { setCursorPos(null); });

        map.addControl(new mlgl.NavigationControl(), "top-right");
        map.addControl(new mlgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

        // Right-click context menu
        map.getCanvas().addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          const rect = map.getCanvas().getBoundingClientRect();
          const point = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
          setCtxMenu({ x: e.clientX, y: e.clientY, lng: point.lng, lat: point.lat });
        });
        map.getCanvas().addEventListener("click", () => { setCtxMenu(null); }, true);
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
    };

    void initMap();

    return () => {
      cancelled = true;
      // Clear data layer refresh intervals

      // Reading the ref here is intentional: the handle accumulates refresh
      // intervals for the map's whole lifetime, so cleanup must see the
      // latest one, not the value from mount time.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const handle = layerHandleRef.current;
      handle.intervals.forEach(clearInterval);
      handle.intervals = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Mount-once map construction: the map is created from the INITIAL
    // center/zoom/basemap/layers; later changes flow through switchBasemap
    // and the per-layer effects, not by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch basemap
  const switchBasemap = useCallback(
    (key: string) => {
      const map = mapRef.current;
      const mlgl = mlglRef.current;
      if (!map || !mlgl) return;
      const bm = getBasemap(key);

      const isDark = bm.isDark;

      map.setStyle({
        version: 8,
        sources: {
          basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attribution },
          ...(isDark
            ? {
                land: {
                  type: "geojson",
                  data: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson`,
                },
              }
            : {}),
        },
        layers: [
          { id: "basemap", type: "raster", source: "basemap" },
          ...(isDark
            ? [
                {
                  id: "land-contrast",
                  type: "fill" as const,
                  source: "land",
                  paint: {
                    "fill-color": "#1e3040",
                    "fill-opacity": 0.65,
                  },
                },
              ]
            : []),
        ],
        ...(isDark ? { glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" } : {}),
      });

      map.once("styledata", () => {
        addElevationSource(map, mlgl);
        // Re-add all layers in correct order after style change
        for (const layer of LAYERS) {
          if (layer.category === "terrain" && MAP_2D_LAYER_IDS.has(layer.id) && mapState.layers[layer.id]) {
            addDataLayer(map, layerHandleRef.current, layer.id);
          }
        }
        for (const layer of LAYERS) {
          if (
            layer.category !== "terrain" &&
            layer.category !== "hillshade" &&
            MAP_2D_LAYER_IDS.has(layer.id) &&
            mapState.layers[layer.id]
          ) {
            addDataLayer(map, layerHandleRef.current, layer.id);
          }
        }
        // Hillshade — loaded last (on top of everything except labels)
        if (mapState.layers.hillshade) addDataLayer(map, layerHandleRef.current, "hillshade");
        addLabelLayer(map, key);
        reorderMapLayers(map, mapState.layers);
        if (mapState.layers.terrain3d) enable3DTerrain(map);
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
        if (enabled) {
          addDataLayer(map, layerHandleRef.current, layerName);
          reorderMapLayers(map, layers);
        } else {
          removeDataLayer(map, layerName);
        }
      }

      return { ...prev, layers };
    });

    // Persist layer state to localStorage
    try {
      const current = { ...mapStateRef.current.layers, [layerName]: enabled };
      localStorage.setItem(LAYER_STATE_KEY, JSON.stringify(current));
    } catch {}
  }, []);

  const mapStateRef = useRef(mapState);

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
  const handleSearch = useCallback(
    async (query: string) => {
      try {
        const res = await fetch(`/api/geocode?query=${encodeURIComponent(query)}&limit=1`);
        if (!res.ok) throw new Error("search unavailable");
        const data = await res.json();
        if (data?.ok === false || data?.error) throw new Error(data.error?.message || "search unavailable");
        if (data.results?.length > 0) {
          const r = data.results[0];
          const map = mapRef.current;
          if (map) map.flyTo({ center: [Number(r.lon), Number(r.lat)], zoom: 12, duration: 1500 });
        }
      } catch {
        showToast("Address search is temporarily unavailable.", "error");
      }
    },
    [showToast],
  );

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

  // Copy the elevation at a point (context menu). Best-effort: clipboard access
  // can be denied without user focus.
  const copyElevationAt = async (lat: number, lng: number) => {
    try {
      const d = await getClientElevation(lat, lng);
      const label =
        d.elevation !== null
          ? `${d.elevation}m`
          : d.status === "unavailable"
            ? "Elevation service unavailable"
            : "No data";
      navigator.clipboard.writeText(`${label} @ ${lat.toFixed(6)}, ${lng.toFixed(6)}`).catch(() => {});
    } catch {
      /* ignore */
    }
    setCtxMenu(null);
  };

  // Export visible layers as GeoJSON
  const handleExportGeoJSON = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const layerId of MAP_2D_LAYER_IDS) {
      if (!mapState.layers[layerId]) continue;
      try {
        const src = map.getSource(layerId);
        if (src && "_data" in src && src._data?.features) {
          geojson.features.push(...src._data.features);
        }
      } catch {}
    }
    if (geojson.features.length === 0) return;
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
    const link = document.createElement("a");
    link.download = `openzenith-layers-${Date.now()}.geojson`;
    link.href = URL.createObjectURL(blob);
    link.click();
  }, [mapState.layers]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
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
                  <span style={{ color: activePin.status === "unavailable" ? T.red : T.textMuted }}>
                    {activePin.status === "unavailable"
                      ? "Elevation service unavailable"
                      : activePin.surfaceType === "seafloor" || activePin.surfaceType === "ocean"
                        ? "No bathymetry data"
                        : activePin.surfaceType === "inland_water"
                          ? "No inland water data"
                          : "No elevation data"}
                  </span>
                )}
              </div>
            )}

            {fetchingElevation && (
              <span style={{ color: T.accent, fontSize: "0.75rem", fontFamily: T.fontMono }}>querying...</span>
            )}

            <button
              onClick={() => { setSidebarOpen(!sidebarOpen); }}
              aria-label="Toggle layer panel"
              aria-expanded={sidebarOpen}
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
      {/* main landmark: the map canvas, its overlays and the status bar live
          here so axe's `region` rule (WCAG 1.3.6) is satisfied. The visually
          hidden h1 gives the landmark document context (WCAG 2.4.6). */}
      <main style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        <h1 className="oz-sr-only">OpenZenith Map</h1>
        {/* Toolbar overlay */}
        <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
          {isMobile && (
            <button
              onClick={() => { setSidebarOpen(!sidebarOpen); }}
              aria-label="Toggle layer panel"
              aria-expanded={sidebarOpen}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                background: sidebarOpen ? T.accent : T.panel,
                border: `1px solid ${sidebarOpen ? T.accent : T.border}`,
                borderRadius: 4,
                color: sidebarOpen ? "#0a0f1a" : T.textMuted,
                cursor: "pointer",
                fontSize: "1.2rem",
                backdropFilter: "blur(8px)",
                marginRight: 4,
              }}
            >
              {sidebarOpen ? "✕" : "☰"}
            </button>
          )}
          <Toolbar
            onSearch={(query) => {
              void handleSearch(query);
            }}
            onJumpTo={handleJumpTo}
            onScreenshot={handleScreenshot}
          />
        </div>

        {/* Measure tools */}
        <div style={{ position: "absolute", top: 52, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
          <button
            onClick={() => { toggleMeasureMode("distance"); }}
            title="Measure distance (Esc to cancel)"
            aria-label="Measure distance"
            aria-pressed={measureMode === "distance"}
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
            onClick={() => { toggleMeasureMode("area"); }}
            title="Measure area (Esc to cancel)"
            aria-label="Measure area"
            aria-pressed={measureMode === "area"}
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
              aria-label="Clear measurement"
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

        {/* Draw tools */}
        <div style={{ position: "absolute", top: 82, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
          <button
            onClick={() => {
              if (drawMode === "point") {
                cancelDrawing();
              } else {
                cancelDrawing();
                setDrawMode("point");
                drawModeRef.current = "point";
              }
            }}
            title="Draw point annotation"
            aria-label="Draw point annotation"
            aria-pressed={drawMode === "point"}
            style={{
              background: drawMode === "point" ? "#00ff88" : T.panel,
              border: `1px solid ${drawMode === "point" ? "#00ff88" : T.border}`,
              borderRadius: 4,
              color: drawMode === "point" ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            ◎
          </button>
          <button
            onClick={() => {
              if (drawMode === "line") {
                cancelDrawing();
              } else {
                cancelDrawing();
                setDrawMode("line");
                drawModeRef.current = "line";
              }
            }}
            title="Draw line annotation (click points, Enter to finish)"
            aria-label="Draw line annotation"
            aria-pressed={drawMode === "line"}
            style={{
              background: drawMode === "line" ? "#00ff88" : T.panel,
              border: `1px solid ${drawMode === "line" ? "#00ff88" : T.border}`,
              borderRadius: 4,
              color: drawMode === "line" ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            ━
          </button>
          <button
            onClick={() => {
              if (drawMode === "polygon") {
                cancelDrawing();
              } else {
                cancelDrawing();
                setDrawMode("polygon");
                drawModeRef.current = "polygon";
              }
            }}
            title="Draw polygon annotation (click points, Enter to finish)"
            aria-label="Draw polygon annotation"
            aria-pressed={drawMode === "polygon"}
            style={{
              background: drawMode === "polygon" ? "#00ff88" : T.panel,
              border: `1px solid ${drawMode === "polygon" ? "#00ff88" : T.border}`,
              borderRadius: 4,
              color: drawMode === "polygon" ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            △
          </button>
          {drawMode !== "none" && (
            <>
              <input
                value={annotationName}
                onChange={(e) => { setAnnotationName(e.target.value); }}
                placeholder="Name..."
                aria-label="Annotation name"
                style={{
                  background: T.panel,
                  border: `1px solid ${T.border}`,
                  borderRadius: 3,
                  color: T.text,
                  padding: "3px 6px",
                  fontSize: "0.68rem",
                  fontFamily: T.fontMono,
                  width: 100,
                  outline: "none",
                }}
              />
              <button onClick={finishDrawing} aria-label="Finish drawing" title="Finish (Enter)" style={{ ...btnStyle, color: "#00ff88" }}>
                ✓
              </button>
              <button onClick={cancelDrawing} aria-label="Cancel drawing" title="Cancel (Esc)" style={{ ...btnStyle, color: T.red }}>
                ✕
              </button>
            </>
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
          {sidebarOpen && !isMobile && (
            <div
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                fontSize: "0.6rem",
                color: T.textMuted,
                fontFamily: T.fontMono,
                opacity: 0.6,
                pointerEvents: "none",
              }}
            >
              H hillshade · R radar · G quakes · 3 sat · P measure · B boundaries
            </div>
          )}
        </div>

        {/* Status indicators */}
        <div style={{ position: "absolute", bottom: 8, right: 8, zIndex: 10 }}>
          <SurveillancePanel style={{ padding: "0.3rem 0.6rem", display: "flex", gap: 12, alignItems: "center" }}>
            <StatusIndicator
              color={
                mapHealth === "error"
                  ? T.red
                  : mapHealth === "degraded"
                    ? T.amber
                    : mapHealth === "loading"
                      ? T.amber
                      : T.green
              }
              label={
                mapHealth === "error"
                  ? "ERROR"
                  : mapHealth === "degraded"
                    ? "DEGRADED"
                    : mapHealth === "loading"
                      ? "LOADING"
                      : "READY"
              }
              pulse={mapHealth === "loading"}
            />
            {pins.length > 0 && <StatusIndicator color={T.accent} label={`${pins.length} PINS`} />}
            {annotations.length > 0 && <StatusIndicator color="#00ff88" label={`${annotations.length} ANNOT`} />}
            {drawMode !== "none" && <StatusIndicator color="#00ff88" label={`DRAW: ${drawMode.toUpperCase()}`} />}
            <button
              onClick={() => {
                const map = mapRef.current;
                if (map) exportMapScreenshot(map, "openzenith-map");
              }}
              title="Export screenshot"
              aria-label="Export map screenshot as PNG"
              style={{
                background: "none",
                border: `1px solid ${T.border}`,
                /* T.textMuted (#94a3b8) only reaches 5.46:1 on the panel
                   composite; T.text (#e2e8f0) = 11.37:1 — WCAG AAA. */
                color: T.text,
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
                navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`).catch(() => {});
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
                navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`).catch(() => {});
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
                navigator.clipboard.writeText(`${toDms(ctxMenu.lat, "N", "S")} ${toDms(ctxMenu.lng, "E", "W")}`).catch(() => {});
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
                navigator.clipboard.writeText(`${ctxMenu.lng.toFixed(6)},${ctxMenu.lat.toFixed(6)}`).catch(() => {});
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
                navigator.clipboard.writeText(`${ctxMenu.lng.toFixed(6)}, ${ctxMenu.lat.toFixed(6)}`).catch(() => {});
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
              onClick={() => {
                void copyElevationAt(ctxMenu.lat, ctxMenu.lng);
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
            role="application"
            aria-label="Interactive map"
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

        {/* Mobile backdrop overlay */}
        {sidebarOpen && isMobile && (
          <div
            onClick={() => { setSidebarOpen(false); }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0,0,0,0.5)",
              zIndex: 49,
              cursor: "pointer",
            }}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: isMobile ? "85vw" : 280,
              maxWidth: 320,
              height: "100%",
              background: T.panel,
              backdropFilter: "blur(12px)",
              borderLeft: `1px solid ${T.border}`,
              boxShadow: T.glow,
              padding: "0.75rem",
              overflowY: "auto",
              zIndex: 50,
              WebkitOverflowScrolling: "touch",
              transition: isMobile ? "transform 0.25s ease" : "none",
            }}
            role="region"
            aria-label="Map controls panel"
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
                {Object.values(mapState.layers).filter(Boolean).length > 0 && (
                  <span style={{ color: T.accent, fontWeight: 400, fontSize: "0.7rem", marginLeft: "0.5rem" }}>
                    {Object.values(mapState.layers).filter(Boolean).length}/{Object.keys(mapState.layers).length} active
                  </span>
                )}
              </span>
              <button
                aria-label="Close sidebar"
                onClick={() => { setSidebarOpen(false); }}
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
                {BASEMAP_ORDER.map((key) => {
                  const bm = BASEMAPS[key];
                  return (
                    <button
                      key={key}
                      onClick={() => { switchBasemap(key); }}
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
                  );
                })}
              </div>
            </SurveillancePanel>

            {/* System theme toggle — switches basemap between dark/voyager */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
                padding: "0.35rem 0",
              }}
            >
              <span style={{ fontSize: "0.72rem", color: T.textMuted, fontFamily: T.fontMono }}>AUTO THEME</span>
              <button
                onClick={() => {
                  const map = mapRef.current;
                  const mlgl = mlglRef.current;
                  if (!map || !mlgl) return;
                  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  const newBm = prefersDark ? "dark" : "voyager";
                  switchBasemap(newBm);
                }}
                title="Switch basemap to match your OS theme"
                style={{
                  padding: "0.2rem 0.5rem",
                  borderRadius: 3,
                  border: `1px solid ${T.border}`,
                  background: "transparent",
                  color: T.accent,
                  cursor: "pointer",
                  fontSize: "0.68rem",
                  fontFamily: T.fontMono,
                }}
              >
                ⚙ Match OS
              </button>
            </div>

            {/* Hillshade — always visible at the top, no accordion */}
            {LAYERS.filter((l) => l.id === "hillshade").map((layer) => (
              <div key={layer.id} style={{ padding: "0.3rem 0.35rem", borderBottom: "1px solid rgba(0,229,255,0.15)" }}>
                <LayerToggle
                  label={layer.name}
                  checked={mapState.layers[layer.id]}
                  onChange={(checked) => { toggleLayer(layer.id, checked); }}
                  color={layer.accent}
                />
                <div style={{ color: T.textMuted, fontSize: "0.6rem", marginLeft: 18, marginTop: -2 }}>
                  {layer.description}
                </div>
              </div>
            ))}
            {/* Layer toggles — accordion groups */}
            {CATEGORY_ORDER.map((cat) => {
              if (cat === "hillshade") return null;
              const layers = LAYERS.filter(
                (l) =>
                  l.category === cat &&
                  (MAP_2D_LAYER_IDS.has(l.id) || ["hillshade", "terrain3d", "boundaries", "contour"].includes(l.id)),
              );
              if (layers.length === 0) return null;
              const isOpen = expandedCategory === cat;
              const enabledCount = layers.filter((l) => mapState.layers[l.id]).length;
              return (
                <div key={cat} style={{ marginBottom: "0.4rem" }}>
                  <button
                    onClick={() => { setExpandedCategory(isOpen ? null : cat); }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.45rem 0.5rem",
                      background: isOpen ? `rgba(0, 229, 255, 0.08)` : "transparent",
                      border: `1px solid ${isOpen ? T.border : "transparent"}`,
                      borderRadius: 4,
                      color: T.text,
                      fontSize: "0.7rem",
                      fontFamily: T.fontMono,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.15s",
                    }}
                  >
                    <span>{CATEGORY_LABELS[cat] || cat}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {enabledCount > 0 && (
                        <span style={{ fontSize: "0.58rem", color: T.green, fontFamily: T.fontMono }}>
                          {enabledCount}/{layers.length}
                        </span>
                      )}
                      <span style={{ fontSize: "0.6rem", color: T.textMuted }}>{isOpen ? "▾" : "▸"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0.25rem 0.15rem" }}>
                      {layers.map((layer) => {
                        const status = layerStatus[layer.id];
                        return (
                          <div
                            key={layer.id}
                            style={{
                              padding: "0.3rem 0.35rem",
                              borderBottom: `1px solid rgba(0,229,255,0.08)`,
                            }}
                          >
                            <LayerToggle
                              label={layer.name}
                              checked={mapState.layers[layer.id]}
                              onChange={(checked) => { toggleLayer(layer.id, checked); }}
                              color={layer.accent}
                            />
                            <div style={{ color: T.textMuted, fontSize: "0.6rem", marginLeft: 18, marginTop: -2 }}>
                              {layer.description}
                              {mapState.layers[layer.id] && status && (
                                <span
                                  aria-live="polite"
                                  aria-label={`${layer.name} status: ${status.status}`}
                                  style={{
                                    marginLeft: 6,
                                    padding: "0 3px",
                                    borderRadius: 2,
                                    fontSize: "0.55rem",
                                    fontFamily: T.fontMono,
                                    ...(status.status === "loading"
                                      ? { color: T.amber }
                                      : status.status === "error"
                                        ? { color: T.red }
                                        : status.status === "empty"
                                          ? { color: T.textMuted }
                                          : { color: T.green }),
                                  }}
                                >
                                  {status.status === "loading"
                                    ? "⟳"
                                    : status.status === "error"
                                      ? "✕ ERR"
                                      : status.status === "empty"
                                        ? "∅ 0"
                                        : status.count !== undefined
                                          ? `✓ ${status.count}`
                                          : "✓"}
                                </span>
                              )}
                              {mapState.layers[layer.id] && RASTER_LAYERS.has(layer.id) && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                                  <input
                                    type="range"
                                    min={10}
                                    max={100}
                                    value={layerOpacity[layer.id] ?? 100}
                                    onChange={(e) => { setOpacity(layer.id, Number(e.target.value)); }}
                                    style={{ width: 70, height: 14, accentColor: layer.accent, cursor: "pointer" }}
                                  />
                                  <span
                                    style={{
                                      fontSize: "0.55rem",
                                      fontFamily: T.fontMono,
                                      color: T.textMuted,
                                      minWidth: 22,
                                    }}
                                  >
                                    {layerOpacity[layer.id] ?? 100}%
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Earthquake time filter */}
            {mapState.layers.earthquakes && (
              <EarthquakeTimelinePanel
                feed={eqFeed}
                playing={eqPlaying}
                timeSlider={eqTimeSlider}
                range={eqRange}
                onFeedChange={handleEqFeedChange}
                onPlay={handleEqPlay}
                onTimeChange={handleEqTimeChange}
                onShowAll={handleEqShowAll}
              />
            )}

            {/* Hurricane animation controls */}
            {mapState.layers.hurricaneTracks && (
              <HurricaneAnimationPanel
                animating={hurricaneAnimating}
                progress={hurricaneProgress}
                onToggle={toggleHurricaneAnimation}
              />
            )}

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
              <div style={{ display: "flex", gap: "0.35rem", marginTop: 4 }}>
                <button onClick={handleExportGeoJSON} style={{ ...btnStyle, flex: 1 }}>
                  Export GeoJSON
                </button>
                <button onClick={handleScreenshot} style={{ ...btnStyle, flex: 1 }}>
                  Screenshot
                </button>
              </div>
              <div style={{ display: "flex", gap: "0.35rem", marginTop: 4 }}>
                <button onClick={() => { setShowBookmarks((v) => !v); }} style={{ ...btnStyle, flex: 1 }}>
                  {showBookmarks ? "▾" : "▸"} Bookmarks
                </button>
              </div>
              {showBookmarks && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    <input
                      value={bookmarkName}
                      onChange={(e) => { setBookmarkName(e.target.value); }}
                      placeholder="Bookmark name..."
                      aria-label="Bookmark name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveBookmark();
                      }}
                      style={{
                        flex: 1,
                        padding: "3px 6px",
                        fontSize: "0.68rem",
                        background: T.panel,
                        border: `1px solid ${T.border}`,
                        color: T.text,
                        borderRadius: 3,
                        fontFamily: T.fontMono,
                      }}
                    />
                    <button onClick={saveBookmark} style={{ ...btnStyle }} aria-label="Save bookmark" title="Save bookmark">
                      +
                    </button>
                  </div>
                  {bookmarks.length === 0 && (
                    <div style={{ fontSize: "0.62rem", color: T.textMuted, fontFamily: T.fontMono }}>
                      No bookmarks yet
                    </div>
                  )}
                  {bookmarks.map((bm, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "2px 0",
                        fontSize: "0.65rem",
                        fontFamily: T.fontMono,
                      }}
                    >
                      <button
                        onClick={() => { loadBookmark(bm); }}
                        style={{
                          background: "none",
                          border: "none",
                          color: T.accent,
                          cursor: "pointer",
                          fontSize: "0.65rem",
                          padding: 0,
                        }}
                      >
                        ◎ {bm.name}
                      </button>
                      <button
                        onClick={() => { deleteBookmark(i); }}
                        style={{
                          background: "none",
                          border: "none",
                          color: T.red,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          padding: 0,
                          opacity: 0.6,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SurveillancePanel>

            {/* Coordinate info */}
            <SurveillancePanel title="Position" style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontFamily: T.fontMono, fontSize: "0.72rem", color: T.textMuted, lineHeight: 1.8 }}>
                  Center: <span style={{ color: T.accent }}>{formatCoord(mapState.center[0], mapState.center[1])}</span>
                </div>
                <button
                  onClick={() => { setCoordFormat((f) => (f === "dd" ? "dms" : "dd")); }}
                  style={{ ...btnStyle, fontSize: "0.6rem", padding: "1px 6px" }}
                >
                  {coordFormat.toUpperCase()}
                </button>
              </div>
              <div style={{ fontFamily: T.fontMono, fontSize: "0.72rem", color: T.textMuted, lineHeight: 1.8 }}>
                <div>
                  Zoom: <span style={{ color: T.accent }}>{mapState.zoom.toFixed(1)}</span>
                  {" | Bearing: "}
                  <span style={{ color: T.accent }}>{(mapState.bearing || 0).toFixed(0)}</span>&deg;
                  {" | Pitch: "}
                  <span style={{ color: T.accent }}>{(mapState.pitch || 0).toFixed(0)}</span>&deg;
                </div>
              </div>
            </SurveillancePanel>

            {/* Elevation profile */}
            {profileData && profileData.length > 1 && (
              <SurveillancePanel title="Elevation Profile" style={{ marginBottom: "0.75rem" }}>
                {profileLoading && (
                  <div style={{ fontSize: "0.65rem", color: T.amber, fontFamily: T.fontMono }}>⟳ Loading...</div>
                )}
                <div
                  style={{
                    position: "relative",
                    height: 60,
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: 3,
                    overflow: "hidden",
                    marginTop: 4,
                  }}
                >
                  <svg
                    viewBox={`0 0 ${profileData.length * 4} 60`}
                    preserveAspectRatio="none"
                    style={{ width: "100%", height: "100%" }}
                  >
                    {(() => {
                      const elevs = profileData.map((p) => p.elevation);
                      const minE = Math.min(...elevs);
                      const maxE = Math.max(...elevs);
                      const range = maxE - minE || 1;
                      const points = profileData
                        .map((p, i) => `${i * 4},${60 - ((p.elevation - minE) / range) * 55 - 2}`)
                        .join(" ");
                      return <polyline points={points} fill="none" stroke={T.green} strokeWidth="1.5" />;
                    })()}
                  </svg>
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      left: 4,
                      fontSize: "0.55rem",
                      fontFamily: T.fontMono,
                      color: T.textMuted,
                    }}
                  >
                    {Math.max(...profileData.map((p) => p.elevation))}m
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      bottom: 2,
                      left: 4,
                      fontSize: "0.55rem",
                      fontFamily: T.fontMono,
                      color: T.textMuted,
                    }}
                  >
                    {Math.min(...profileData.map((p) => p.elevation))}m
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 4,
                      fontSize: "0.55rem",
                      fontFamily: T.fontMono,
                      color: T.textMuted,
                    }}
                  >
                    {(profileData[profileData.length - 1].distance / 1000).toFixed(1)}km
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "0.58rem",
                    fontFamily: T.fontMono,
                    color: T.textMuted,
                    marginTop: 2,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Start: {profileData[0].elevation}m</span>
                  <span>End: {profileData[profileData.length - 1].elevation}m</span>
                  <span>
                    Δ{Math.abs(profileData[0].elevation - profileData[profileData.length - 1].elevation).toFixed(0)}m
                  </span>
                </div>
              </SurveillancePanel>
            )}

            {/* Pin history */}
            {pins.length > 0 && (
              <PinHistoryPanel
                pins={pins}
                onSelect={(p) => {
                  const map = mapRef.current;
                  if (map) map.flyTo({ center: [p.lon, p.lat], zoom: 12, duration: 1000 });
                  setActivePin(p);
                }}
              />
            )}

            {/* Annotations list */}
            {annotations.length > 0 && (
              <AnnotationsListPanel
                annotations={annotations}
                onDelete={deleteAnnotation}
                onClear={clearAnnotations}
              />
            )}

            {/* Share URL */}
            <ShareUrlPanel url={window.location.origin + buildHash(mapState)} />
          </div>
        )}

        {/* Map Legend — always visible overlay */}
        <MapLegend
          layers={mapState.layers}
          onToggle={toggleLayer}
          basemapLabel={getBasemap(mapState.basemap).label}
        />

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
      </main>

      {/* Toast notifications */}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.type === "error" ? "#dc2626" : "#2563eb",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: 4,
              fontSize: "0.78rem",
              fontFamily: T.fontMono,
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              animation: "fadeIn 0.2s ease-in",
            }}
          >
            {t.type === "error" ? "✕ " : "ℹ "}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Styles ─── */

