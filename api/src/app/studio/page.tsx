"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MapLoading } from "@/components/MapLoading";
import { waitForMapLibre } from "./lib/load-map";
import { BASEMAPS, DEFAULT_CENTER, DEFAULT_ZOOM } from "./lib/constants";
import type { ToolTab, UploadedDataset } from "./lib/types";
import { addGeoJSONLayer, removeGeoJSONLayer } from "./lib/map-helpers";
import {
  createDrawState,
  addDrawLayers,
  removeDrawLayers,
  updateDrawLayers,
  finishDrawing,
  undo,
  redo,
  moveVertex,
  deleteVertex,
  exitEditMode,
  type DrawState,
} from "./lib/drawing";
import { ToolPanel } from "./components/ToolPanel";
import { addDataLayer, removeDataLayer, MAP_2D_LAYER_IDS } from "../map/lib/layers";
import { encodeMapHash, decodeMapHash, loadPreferences, savePreferences } from "./lib/map-state";
import { exportMapScreenshot } from "@/lib/map-export";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { ElevationProfile } from "./components/ElevationProfile";
import { computeProfileInWorker } from "@/lib/worker-utils";

/* ─── Browser session state ───
 * Read once on the client: URL-hash deep link + saved preferences.
 * The restore effect mirrors this into component state, and the map-init
 * effect calls it directly — same-commit effects see the initial state,
 * not each other's updates, so the map cannot wait on mirrored state. */
interface StudioSession {
  center: [number, number];
  zoom: number;
  basemap: string;
  tab: ToolTab;
  sidebar: boolean;
  imperial: boolean;
  onboarded: boolean;
  mobile: boolean;
}

function readStudioSession(): StudioSession {
  const s = decodeMapHash(window.location.hash);
  const p = loadPreferences();
  // Stored preferences may not carry activeTab, so keep the truthiness check.
  const tab = p.activeTab as ToolTab | undefined;
  const mobile = window.innerWidth < 768;
  return {
    center: s?.center ?? DEFAULT_CENTER,
    zoom: s?.zoom ?? DEFAULT_ZOOM,
    basemap: s?.basemap ?? "dark",
    tab: tab || "elevation",
    sidebar: mobile ? false : (p.sidebarOpen ?? true),
    imperial: p.imperial ?? false,
    onboarded: localStorage.getItem("openzenith-studio-onboarded") !== null,
    mobile,
  };
}

/* ─── Component ─── */

export default function StudioPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mlglRef = useRef<MapLibreGL | null>(null);
  const layerHandleRef = useRef<import("@/app/map/lib/layers").LayerHandle>({
    intervals: [],
    status: {},
    featureCount: {},
  });

  const [dark] = useState(true);
  // Server-safe initial state: every window/localStorage read happens in
  // the restore effect (and, for map parameters, directly inside the
  // map-init effect). useState initializers run during SSR as well —
  // reading browser-only state there desynced the server/client HTML and
  // hydration regenerated this whole tree on every visit.
  const [isMobile, setIsMobile] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolTab>("elevation");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [imperial, setImperial] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [basemap, setBasemap] = useState("dark");
  const [layers, setLayers] = useState<Record<string, boolean>>(() => ({
    hillshade: true,
    boundaries: true,
  }));
  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [overpassLayerId, setOverpassLayerId] = useState<string | null>(null);
  // The overpass GeoJSON is not component state (only its layer id is), so
  // the basemap-switch restore below keeps a ref to re-add it after setStyle.
  const overpassLayerRef = useRef<{ id: string; data: GeoJSON.FeatureCollection } | null>(null);
  const [profileCoords, setProfileCoords] = useState<[number, number][] | null>(null);
  const profileClickRef = useRef<((lat: number, lon: number) => void) | null>(null);
  const flowPathClickRef = useRef<((lat: number, lon: number) => void) | null>(null);

  const [drawState, setDrawState] = useState<DrawState>(createDrawState());
  const drawStateRef = useRef<DrawState>(drawState);
  const drawKeyHandlerRef = useRef<((ev: KeyboardEvent) => void) | null>(null);
  const dragRef = useRef<{ active: boolean; vertexIndex: number }>({ active: false, vertexIndex: -1 });
  drawStateRef.current = drawState;

  // Update draw layers when draw state changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady) updateDrawLayers(map, drawState);
  }, [drawState, mapReady]);

  /* ─── Restore persisted session state ───
   * Hash deep link + saved preferences → component state. The map-init
   * effect below re-derives the same values via readStudioSession()
   * because both effects run in the same commit: state updates here are
   * not visible to it yet. */
  useEffect(() => {
    const s = readStudioSession();
    setIsMobile(s.mobile);
    setShowOnboarding(!s.onboarded);
    setActiveTab(s.tab);
    setSidebarOpen(s.sidebar);
    setImperial(s.imperial);
    setZoom(s.zoom);
    setBasemap(s.basemap);
  }, []);

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "l" || e.key === "L") setSidebarOpen((v) => !v);
      if (e.key === "i" || e.key === "I") setImperial((v) => !v);
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, []);

  /* ─── Map init ─── */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Held in an object so the cleanup callback's write is visible to the type
    // checker — a bare `let` here is folded to `false` by control-flow analysis.
    const state = { cancelled: false };

    const initMap = async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (state.cancelled) return;
        mlglRef.current = mlgl;

        // Map parameters come straight from the browser session (hash deep
        // link + preferences) — the `basemap` state mirror may not be
        // applied yet within this commit. A stale stored hash can name a
        // basemap the registry dropped, so the lookup is Partial and falls
        // back to dark.
        const session = readStudioSession();
        const registry = BASEMAPS as Partial<Record<string, (typeof BASEMAPS)[string]>>;
        const bm = registry[session.basemap] ?? BASEMAPS.dark;
        const map = new mlgl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attribution },
            },
            layers: [{ id: "basemap", type: "raster", source: "basemap" }],
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          },
          center: session.center,
          zoom: session.zoom,
          maxZoom: 15,
          antialias: true,
        });

        map.on("load", () => {
          if (state.cancelled) return;

          // Add elevation/hillshade. The hillshade goes through the shared
          // layer module (id `hillshade-base`) so the LayersTool checkbox —
          // which toggles that id — actually controls it; a private inline
          // layer left the checkbox a no-op and re-enable stacked a second
          // hillshade on top.
          map.addSource("elevation", {
            type: "raster-dem",
            tiles: ["/api/dem-tile/{z}/{x}/{y}"],
            tileSize: 256,
            demTileSize: 512,
            maxzoom: 12,
            encoding: "terrarium",
          });
          void addDataLayer(map, layerHandleRef.current, "hillshade");

          setMapReady(true);
          addDrawLayers(map);
        });

        // Drawing mode / profile mode / flowpath click handler
        map.on("click", (e: { lngLat: { lat: number; lng: number }; point: { x: number; y: number } }) => {
          // Profile mode takes priority
          if (profileClickRef.current) {
            profileClickRef.current(e.lngLat.lat, e.lngLat.lng);
            return;
          }
          // Flow path mode
          if (flowPathClickRef.current) {
            flowPathClickRef.current(e.lngLat.lat, e.lngLat.lng);
            return;
          }

          const ds = drawStateRef.current;

          // Edit mode: handle vertex selection and adding
          if (ds.mode === "edit") {
            // Check if clicked on a vertex
            const vertexFeatures = map.queryRenderedFeatures(e.point, {
              layers: ["draw-vertices", "draw-selected-vertex"],
            });
            if (vertexFeatures.length > 0) {
              // properties is typed `{[k: string]: any} | null`, which TS
              // collapses to any — the `typeof` guard below is the real check.
              const vi = vertexFeatures[0].properties.vertexIndex as number | undefined;
              if (typeof vi === "number") {
                setDrawState((prev) => ({ ...prev, selectedVertexIndex: vi }));
                return;
              }
            }
            // Clicked elsewhere — deselect vertex
            setDrawState((prev) => ({ ...prev, selectedVertexIndex: -1 }));
            return;
          }

          if (ds.mode === "none") {
            // Feature selection: click on drawn features to select
            const clicked = map.queryRenderedFeatures(e.point, {
              layers: ["draw-line", "draw-fill", "draw-selected"],
            });
            if (clicked.length > 0) {
              // Query results always carry geometry (geometry: null is an
              // uploaded-file concern, not a rendered-feature one).
              const clickedCoords: unknown = clicked[0].geometry.coordinates;
              if (clickedCoords) {
                const idx = ds.features.findIndex((f) => {
                  // Uploaded GeoJSON may carry `geometry: null` (RFC 7946), which
                  // the global Feature type hides — read through a nullable view.
                  const geometry = f.geometry as (typeof f.geometry) | null;
                  const fc: unknown = geometry?.coordinates;
                  if (!fc) return false;
                  return JSON.stringify(fc) === JSON.stringify(clickedCoords);
                });
                if (idx >= 0) {
                  setDrawState((prev) => ({
                    ...prev,
                    selectedFeatureIndex: prev.selectedFeatureIndex === idx ? -1 : idx,
                    selectedVertexIndex: -1,
                  }));
                  return;
                }
              }
            }
            // Clicked empty space — deselect
            if (ds.selectedFeatureIndex >= 0) {
              setDrawState((prev) => ({ ...prev, selectedFeatureIndex: -1, selectedVertexIndex: -1 }));
            }
            return;
          }

          const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          setDrawState((prev) => {
            const next = { ...prev, currentCoords: [...prev.currentCoords, pt] };

            // Auto-finish for point mode (each click is a separate feature)
            if (prev.mode === "point") {
              return finishDrawing(next);
            }

            return next;
          });
        });

        // Vertex drag support for edit mode
        map.on("mousedown", (e: { point: { x: number; y: number } }) => {
          const ds = drawStateRef.current;
          if (ds.mode !== "edit" || ds.selectedVertexIndex < 0) return;

          const vertexFeatures = map.queryRenderedFeatures(e.point, {
            layers: ["draw-selected-vertex"],
          });
          if (vertexFeatures.length > 0) {
            dragRef.current = { active: true, vertexIndex: ds.selectedVertexIndex };
            map.dragPan.disable();
          }
        });

        map.on("mousemove", (e: { lngLat: { lat: number; lng: number } }) => {
          setCursorPos({ lat: e.lngLat.lat, lon: e.lngLat.lng });

          if (!dragRef.current.active) return;
          const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          setDrawState((prev) => moveVertex(prev, dragRef.current.vertexIndex, pt));
        });

        map.on("mouseup", () => {
          if (dragRef.current.active) {
            dragRef.current = { active: false, vertexIndex: -1 };
            map.dragPan.enable();
          }
        });

        // Keyboard shortcuts for drawing
        const drawKeyHandler = (ev: KeyboardEvent) => {
          const ds = drawStateRef.current;
          if (ds.mode === "none") return;

          if (ds.mode === "edit") {
            if (ev.key === "Escape") {
              setDrawState((prev) => exitEditMode(prev));
            } else if ((ev.key === "Delete" || ev.key === "Backspace") && ds.selectedVertexIndex >= 0) {
              ev.preventDefault();
              setDrawState((prev) => deleteVertex(prev, prev.selectedVertexIndex));
            } else if (ev.key === "z" && (ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault();
              setDrawState((prev) => undo(prev));
            } else if (ev.key === "y" && (ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault();
              setDrawState((prev) => redo(prev));
            }
            return;
          }

          if (ev.key === "Enter") {
            setDrawState((prev) => finishDrawing(prev));
          } else if (ev.key === "Escape") {
            setDrawState((prev) => ({ ...prev, currentCoords: [], mode: "none" }));
          } else if (ev.key === "z" && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            setDrawState((prev) => undo(prev));
          } else if (ev.key === "y" && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            setDrawState((prev) => redo(prev));
          }
        };
        drawKeyHandlerRef.current = drawKeyHandler;
        document.addEventListener("keydown", drawKeyHandler);

        map.on("zoom", () => {
          setZoom(Math.round(map.getZoom() * 10) / 10);
        });

        map.on("mouseout", () => {
          setCursorPos(null);
        });

        map.addControl(new mlgl.NavigationControl(), "top-left");
        mapRef.current = map;
      } catch {
        setLoadError(true);
      }
    };

    void initMap();

    return () => {
      state.cancelled = true;
      // Clear intervals

      // Reading the ref at cleanup time is intentional: intervals accumulate
      // over the map's whole lifetime.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const handle = layerHandleRef.current;
      for (const interval of handle.intervals) clearInterval(interval);
      handle.intervals = [];
      if (drawKeyHandlerRef.current) {
        document.removeEventListener("keydown", drawKeyHandlerRef.current);
      }
      if (mapRef.current) {
        removeDrawLayers(mapRef.current);
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Mount-once map construction from initial basemap/center/zoom; later
    // changes flow through toggleLayer/switchBasemap, not a rebuild.
  }, []);

  /* ─── Layer toggling ─── */

  const toggleLayer = useCallback((id: string, enabled: boolean) => {
    setLayers((prev) => ({ ...prev, [id]: enabled }));
    const map = mapRef.current;
    if (!map) return;

    if (MAP_2D_LAYER_IDS.has(id)) {
      if (enabled) void addDataLayer(map, layerHandleRef.current, id);
      else void removeDataLayer(map, layerHandleRef.current, id);
    }
  }, []);

  /* ─── Basemap switch ─── */

  const handleBasemapChange = useCallback(
    (key: string) => {
      setBasemap(key);
      const map = mapRef.current;
      if (!map) return;
      // `key` may not exist in the registry, so the lookup can miss — view it as
      // Partial to keep this guard visible to the checker.
      const registry = BASEMAPS as Partial<Record<string, (typeof BASEMAPS)[string]>>;
      const bm = registry[key];
      if (!bm) return;
      map.setStyle({
        version: 8,
        sources: { basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attribution } },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      });
      // setStyle() swaps the entire style object — the elevation source,
      // hillshade, data layers and uploaded datasets all vanish with it.
      // Re-add whatever the session had once the new style applies.
      map.once("styledata", () => {
        map.addSource("elevation", {
          type: "raster-dem",
          tiles: ["/api/dem-tile/{z}/{x}/{y}"],
          tileSize: 256,
          demTileSize: 512,
          maxzoom: 12,
          encoding: "terrarium",
        });
        // Hillshade rides the shared module via the `layers` loop below.
        for (const [id, enabled] of Object.entries(layers)) {
          if (enabled && MAP_2D_LAYER_IDS.has(id)) {
            void addDataLayer(map, layerHandleRef.current, id);
          }
        }
        for (const ds of datasets) {
          if (ds.visible) addGeoJSONLayer(map, ds.id, ds.data, ds.color, ds.visualization);
        }
        const op = overpassLayerRef.current;
        if (op) addGeoJSONLayer(map, op.id, op.data, "#8b5cf6");
      });
    },
    [layers, datasets],
  );

  /* ─── Dataset management ─── */

  const handleDatasetsChange = useCallback(
    (newDatasets: UploadedDataset[]) => {
      setDatasets(newDatasets);
      const map = mapRef.current;
      if (!map) return;

      // Sync layers on map
      const currentIds = new Set(newDatasets.map((d) => d.id));
      // Remove old layers not in new set (`datasets` state is never null)
      for (const old of datasets) {
        if (!currentIds.has(old.id)) removeGeoJSONLayer(map, old.id);
      }
      // Add new layers
      for (const ds of newDatasets) {
        if (ds.visible) {
          try {
            addGeoJSONLayer(map, ds.id, ds.data, ds.color, ds.visualization);
          } catch {
            // Layer might already exist
          }
        }
      }
    },
    [datasets],
  );

  const handleToggleDataset = useCallback(
    (id: string, visible: boolean) => {
      setDatasets((prev) => prev.map((d) => (d.id === id ? { ...d, visible } : d)));
      const map = mapRef.current;
      if (!map) return;
      const ds = datasets.find((d) => d.id === id);
      if (!ds) return;
      if (visible) {
        addGeoJSONLayer(map, id, ds.data, ds.color, ds.visualization);
      } else {
        removeGeoJSONLayer(map, id);
      }
    },
    [datasets],
  );

  const handleVisualizationChange = useCallback(
    (id: string, visualization: UploadedDataset["visualization"]) => {
      setDatasets((prev) => prev.map((d) => (d.id === id ? { ...d, visualization } : d)));
      const map = mapRef.current;
      if (!map) return;
      const ds = datasets.find((d) => d.id === id);
      if (!ds || !ds.visible) return;
      // Re-add layer with new visualization
      removeGeoJSONLayer(map, id);
      addGeoJSONLayer(map, id, ds.data, ds.color, visualization);
    },
    [datasets],
  );

  const handleRemoveDataset = useCallback((id: string) => {
    const map = mapRef.current;
    if (map) removeGeoJSONLayer(map, id);
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  }, []);

  /* ─── Overpass results ─── */

  const handleOverpassResult = useCallback(
    (data: GeoJSON.FeatureCollection, _name: string) => {
      const map = mapRef.current;
      if (!map) return;

      // Remove previous overpass layer
      if (overpassLayerId) removeGeoJSONLayer(map, overpassLayerId);

      const id = `overpass-${Date.now()}`;
      addGeoJSONLayer(map, id, data, "#8b5cf6");
      overpassLayerRef.current = { id, data };
      setOverpassLayerId(id);

      // Fit bounds
      const mlgl = mlglRef.current;
      if (!mlgl) return;
      const bounds = new mlgl.LngLatBounds();
      for (const f of data.features) {
        const geom = f.geometry;
        if (geom.type === "Point") {
          const c = geom.coordinates as [number, number];
          bounds.extend(c);
        } else if (f.bbox) {
          bounds.extend([f.bbox[0], f.bbox[1]]);
          bounds.extend([f.bbox[2], f.bbox[3]]);
        }
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
      }
    },
    [overpassLayerId],
  );

  /* ─── URL hash sync ─── */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const updateHash = () => {
      const center = map.getCenter();
      const hash = encodeMapHash({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        basemap,
      });
      window.history.replaceState(null, "", hash);
    };

    map.on("moveend", updateHash);
    map.on("zoomend", updateHash);
    return () => {
      map.off("moveend", updateHash);
      map.off("zoomend", updateHash);
    };
  }, [mapReady, basemap]);

  /* ─── Persist sidebar/tab preferences ─── */

  useEffect(() => {
    savePreferences({ sidebarOpen });
  }, [sidebarOpen]);

  useEffect(() => {
    savePreferences({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    savePreferences({ imperial });
  }, [imperial]);

  /* ─── Elevation profile ─── */

  const handleProfileChange = useCallback((coords: [number, number][] | null) => {
    if (!coords || coords.length < 2) {
      setProfileCoords(null);
      // Clearing a profile must also clear the map's profile layers, not
      // just the overlay — otherwise the line/markers linger after the
      // tool resets (removeLayer throws on absent ids, hence the guards).
      const map = mapRef.current;
      if (map) {
        for (const id of ["profile-line", "profile-marker-0", "profile-marker-1"]) {
          try {
            map.removeLayer(id);
          } catch {
            /* not added yet */
          }
          try {
            map.removeSource(id);
          } catch {
            /* not added yet */
          }
        }
      }
      return;
    }

    // Use Web Worker for interpolation computation
    computeProfileInWorker(coords[0], coords[1])
      .then(({ points }) => { setProfileCoords(points); })
      .catch(() => {
        // Fallback: simple interpolation on main thread
        const interpolated: [number, number][] = [];
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          interpolated.push([
            coords[0][0] + t * (coords[1][0] - coords[0][0]),
            coords[0][1] + t * (coords[1][1] - coords[0][1]),
          ]);
        }
        setProfileCoords(interpolated);
      });

    // `coords` is non-null here — the guard above already returned for the
    // null/short case, so the former null-branch cleanup was unreachable.
    // Draw a line on the map between profile endpoints
    const map = mapRef.current;
    if (!map) return;
    if (map.getSource("profile-line")) {
      map.getSource("profile-line")?.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
      });
    } else {
      map.addSource("profile-line", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: "profile-line",
        type: "line",
        source: "profile-line",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
    }
    // Add endpoint markers
    for (let i = 0; i < coords.length; i++) {
      const markerId = `profile-marker-${i}`;
      if (!map.getSource(markerId)) {
        map.addSource(markerId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Point", coordinates: coords[i] },
            properties: {},
          },
        });
        map.addLayer({
          id: markerId,
          type: "circle",
          source: markerId,
          paint: {
            "circle-radius": 6,
            "circle-color": i === 0 ? "#22c55e" : "#ef4444",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff",
          },
        });
      }
    }
  }, []);

  /* ─── Style vars ─── */

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  // WCAG AAA (7:1) secondary text on both themes (matches globals.css tokens).
  const textSec = dark ? "#a3a3a3" : "#525252";

  /* ─── Render ─── */

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: bg }}>
      {/* Skip links for accessibility */}
      <a
        href="#studio-sidebar"
        style={{
          position: "absolute",
          top: -100,
          left: 8,
          zIndex: 9999,
          padding: "4px 8px",
          /* #ffffff on #1e40af = 8.72:1 (AAA); #3b82f6 only reached 3.7:1 */
          background: "#1e40af",
          color: "#fff",
          borderRadius: 4,
          fontSize: 12,
          textDecoration: "none",
        }}
        onFocus={(e) => {
          (e.target as HTMLElement).style.top = "8px";
        }}
        onBlur={(e) => {
          (e.target as HTMLElement).style.top = "-100px";
        }}
      >
        Skip to sidebar
      </a>
      <a
        href="#studio-map"
        style={{
          position: "absolute",
          top: -100,
          left: 120,
          zIndex: 9999,
          padding: "4px 8px",
          /* #ffffff on #1e40af = 8.72:1 (AAA); #3b82f6 only reached 3.7:1 */
          background: "#1e40af",
          color: "#fff",
          borderRadius: 4,
          fontSize: 12,
          textDecoration: "none",
        }}
        onFocus={(e) => {
          (e.target as HTMLElement).style.top = "8px";
        }}
        onBlur={(e) => {
          (e.target as HTMLElement).style.top = "-100px";
        }}
      >
        Skip to map
      </a>

      <Navbar dark={dark} breadcrumb="Studio" />

      {/* main landmark: contains the map, sidebar, status bar and onboarding
          overlay so axe's `region` rule (WCAG 1.3.6) is satisfied. */}
      <main
        id="main-content" tabIndex={-1}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          position: "relative",
        }}
      >
        {/* App-shell page title (axe page-has-heading-one): the visible chrome
            is a full-viewport map, so the h1 is announced but not rendered.
            Sits inside <main> so axe's `region` rule stays satisfied. */}
        <h1 className="oz-sr-only">OpenZenith Studio</h1>
      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {/* Map */}
        <div style={{ flex: 1, position: "relative" }}>
          <ErrorBoundary>
            <div
              ref={containerRef}
              id="studio-map"
              role="application"
              aria-label="Interactive map canvas"
              tabIndex={0}
              style={{ width: "100%", height: "100%" }}
            />
          </ErrorBoundary>

          {/* Loading */}
          {!mapReady && !loadError && <MapLoading dark message="Loading Studio..." />}

          {/* Error */}
          {loadError && <MapLoading error dark message="Failed to load MapLibre GL" />}

          {/* Sidebar toggle */}
          {mapReady && (
            <button
              onClick={() => { setSidebarOpen(!sidebarOpen); }}
              aria-label={sidebarOpen ? "Close sidebar panel" : "Open sidebar panel"}
              aria-expanded={sidebarOpen}
              aria-controls="studio-sidebar"
              style={{
                position: "absolute",
                top: 10,
                right: isMobile ? 10 : sidebarOpen ? 380 : 10,
                zIndex: isMobile && sidebarOpen ? 60 : 10,
                background: "rgba(0,0,0,0.6)",
                border: "none",
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 16,
                transition: "right 0.2s",
              }}
            >
              {sidebarOpen ? "\u276F" : "\u276E"}
            </button>
          )}

          {/* Mobile overlay backdrop */}
          {isMobile && sidebarOpen && (
            <div
              onClick={() => { setSidebarOpen(false); }}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                zIndex: 50,
              }}
            />
          )}

          {/* Elevation profile overlay */}
          {profileCoords && (
            <ElevationProfile
              dark={dark}
              coordinates={profileCoords}
              onClose={() => {
                setProfileCoords(null);
                // Same cleanup path as handleProfileChange(null): drop the
                // profile line and endpoint markers from the map.
                const map = mapRef.current;
                if (map) {
                  for (const id of ["profile-line", "profile-marker-0", "profile-marker-1"]) {
                    try {
                      map.removeLayer(id);
                    } catch {
                      /* not added yet */
                    }
                    try {
                      map.removeSource(id);
                    } catch {
                      /* not added yet */
                    }
                  }
                }
              }}
            />
          )}
        </div>

        {/* Sidebar */}
        <div
          id="studio-sidebar"
          role="complementary"
          aria-label="Studio tools panel"
          style={{
            width: isMobile ? "100%" : 380,
            maxWidth: isMobile ? 380 : undefined,
            borderLeft: `1px solid ${border}`,
            overflow: "hidden",
            flexShrink: 0,
            transition: isMobile ? "transform 0.2s, opacity 0.2s" : "margin-right 0.2s, opacity 0.2s",
            ...(isMobile
              ? {
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
                  opacity: sidebarOpen ? 1 : 0,
                  zIndex: 55,
                  background: "#0a0a0a",
                }
              : {
                  marginRight: sidebarOpen ? 0 : -380,
                  opacity: sidebarOpen ? 1 : 0,
                }),
          }}
        >
          {mapReady && (
            <ToolPanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              dark={dark}
              map={mapRef.current}
              cursorPos={cursorPos}
              layers={layers}
              onToggleLayer={toggleLayer}
              basemap={basemap}
              onBasemapChange={handleBasemapChange}
              datasets={datasets}
              onDatasetsChange={handleDatasetsChange}
              onToggleDataset={handleToggleDataset}
              onRemoveDataset={handleRemoveDataset}
              onOverpassResult={handleOverpassResult}
              onVisualizationChange={handleVisualizationChange}
              drawState={drawState}
              onDrawStateChange={setDrawState}
              imperial={imperial}
              onImperialChange={setImperial}
              onProfileChange={handleProfileChange}
              profileClickRef={profileClickRef}
              flowPathClickRef={flowPathClickRef}
              flowPathActive={activeTab === "flowpath"}
            />
          )}
        </div>
      </div>

      {/* Status bar */}
      <div
        role="status"
        aria-label="Map status bar"
        aria-live="polite"
        style={{
          height: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 16px",
          background: dark ? "#080808" : "#f0f0f0",
          borderTop: `1px solid ${border}`,
          fontSize: 11,
          fontFamily: "monospace",
          color: textSec,
        }}
      >
        {cursorPos ? (
          <span>
            {cursorPos.lat.toFixed(5)}, {cursorPos.lon.toFixed(5)}
          </span>
        ) : (
          <span>-</span>
        )}
        <span>z{zoom}</span>
        <span>{basemap}</span>
        {datasets.length > 0 && (
          <span>
            {datasets.length} dataset{datasets.length > 1 ? "s" : ""}
          </span>
        )}
        {overpassLayerId && (
          <span style={{ color: dark ? "#a78bfa" : "#6d28d9" }}>OSM query</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => {
            const map = mapRef.current;
            if (map) exportMapScreenshot(map, "openzenith-studio");
          }}
          title="Export screenshot"
          aria-label="Export map screenshot as PNG"
          style={{
            background: "none",
            border: `1px solid ${border}`,
            color: textSec,
            padding: "1px 8px",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 10,
          }}
        >
          EXPORT
        </button>
      </div>

      {/* Onboarding overlay */}
      {showOnboarding && (
        <OnboardingOverlay
          dark={dark}
          onDismiss={() => {
            setShowOnboarding(false);
            if (typeof window !== "undefined") {
              localStorage.setItem("openzenith-studio-onboarded", "1");
            }
          }}
        />
      )}
      </main>
    </div>
  );
}
