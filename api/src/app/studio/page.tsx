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
  type DrawMode,
} from "./lib/drawing";
import { ToolPanel } from "./components/ToolPanel";
import { addDataLayer, removeDataLayer, MAP_2D_LAYER_IDS } from "../map/lib/layers";
import { encodeMapHash, decodeMapHash, loadPreferences, savePreferences } from "./lib/map-state";
import { exportMapScreenshot } from "@/lib/map-export";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { ElevationProfile } from "./components/ElevationProfile";
import { computeProfileInWorker } from "@/lib/worker-utils";

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
  const [isMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("openzenith-studio-onboarded");
  });

  // Restore from URL hash and localStorage
  const [initialCenter] = useState<[number, number]>(() => {
    const s = typeof window !== "undefined" ? decodeMapHash(window.location.hash) : null;
    return s?.center ?? DEFAULT_CENTER;
  });
  const [initialZoom] = useState(() => {
    const s = typeof window !== "undefined" ? decodeMapHash(window.location.hash) : null;
    return s?.zoom ?? DEFAULT_ZOOM;
  });
  const [initialBasemap] = useState(() => {
    const s = typeof window !== "undefined" ? decodeMapHash(window.location.hash) : null;
    return s?.basemap ?? "dark";
  });
  const [initialTab] = useState<ToolTab>(() => {
    const p = loadPreferences();
    return (p.activeTab as ToolTab) || "elevation";
  });
  const [initialSidebar] = useState(() => {
    const p = loadPreferences();
    const mobile = typeof window !== "undefined" && window.innerWidth < 768;
    return mobile ? false : (p.sidebarOpen ?? true);
  });
  const [initialImperial] = useState(() => {
    const p = loadPreferences();
    return p.imperial ?? false;
  });

  const [activeTab, setActiveTab] = useState<ToolTab>(initialTab);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebar);
  const [imperial, setImperial] = useState(initialImperial);
  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [basemap, setBasemap] = useState(initialBasemap);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => ({
    hillshade: true,
    boundaries: true,
  }));
  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [overpassLayerId, setOverpassLayerId] = useState<string | null>(null);
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

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "l" || e.key === "L") setSidebarOpen((v) => !v);
      if (e.key === "i" || e.key === "I") setImperial((v) => !v);
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ─── Map init ─── */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled) return;
        mlglRef.current = mlgl;

        const bm = BASEMAPS[basemap] || BASEMAPS.dark;
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
          center: initialCenter,
          zoom: initialZoom,
          maxZoom: 15,
          antialias: true,
        });

        map.on("load", () => {
          if (cancelled) return;

          // Add elevation/hillshade
          map.addSource("elevation", {
            type: "raster-dem",
            tiles: ["/api/dem-tile/{z}/{x}/{y}"],
            tileSize: 256,
            demTileSize: 512,
            maxzoom: 12,
            encoding: "terrarium",
          });
          map.addLayer({
            id: "hillshade",
            type: "hillshade",
            source: "elevation",
            paint: {
              "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#ffffff",
              "hillshade-accent-color": "#333333",
              "hillshade-exaggeration": 0.3,
            },
          });

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
              const vi = vertexFeatures[0].properties?.vertexIndex;
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
              const clickedCoords = clicked[0].geometry?.coordinates;
              if (clickedCoords) {
                const idx = ds.features.findIndex((f) => {
                  const fc = f.geometry?.coordinates;
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
            setDrawState((prev) => ({ ...prev, currentCoords: [], mode: "none" as DrawMode }));
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
    })();

    return () => {
      cancelled = true;
      // Clear intervals
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Layer toggling ─── */

  const toggleLayer = useCallback((id: string, enabled: boolean) => {
    setLayers((prev) => ({ ...prev, [id]: enabled }));
    const map = mapRef.current;
    if (!map) return;

    if (MAP_2D_LAYER_IDS.has(id)) {
      if (enabled) addDataLayer(map, layerHandleRef.current, id);
      else removeDataLayer(map, id);
    }
  }, []);

  /* ─── Basemap switch ─── */

  const handleBasemapChange = useCallback((key: string) => {
    setBasemap(key);
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS[key];
    if (!bm) return;
    map.setStyle({
      version: 8,
      sources: { basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attribution } },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    });
  }, []);

  /* ─── Dataset management ─── */

  const handleDatasetsChange = useCallback(
    (newDatasets: UploadedDataset[]) => {
      setDatasets(newDatasets);
      const map = mapRef.current;
      if (!map) return;

      // Sync layers on map
      const currentIds = new Set(newDatasets.map((d) => d.id));
      // Remove old layers not in new set
      if (datasets) {
        for (const old of datasets) {
          if (!currentIds.has(old.id)) removeGeoJSONLayer(map, old.id);
        }
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
      setOverpassLayerId(id);

      // Fit bounds
      const bounds = new mlglRef.current!.LngLatBounds();
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
      return;
    }

    // Use Web Worker for interpolation computation
    computeProfileInWorker(coords[0], coords[1])
      .then(({ points }) => setProfileCoords(points))
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

    if (coords) {
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
    } else {
      // Clean up profile layers
      const map = mapRef.current;
      if (map) {
        try {
          map.removeLayer("profile-line");
        } catch {}
        try {
          map.removeSource("profile-line");
        } catch {}
        try {
          map.removeLayer("profile-marker-0");
        } catch {}
        try {
          map.removeSource("profile-marker-0");
        } catch {}
        try {
          map.removeLayer("profile-marker-1");
        } catch {}
        try {
          map.removeSource("profile-marker-1");
        } catch {}
      }
    }
  }, []);

  /* ─── Style vars ─── */

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const textSec = dark ? "#666" : "#999";

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
          background: "#3b82f6",
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
          background: "#3b82f6",
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
              onClick={() => setSidebarOpen(!sidebarOpen)}
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
              onClick={() => setSidebarOpen(false)}
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
                // Clean up profile layers
                const map = mapRef.current;
                if (map) {
                  try {
                    map.removeLayer("profile-line");
                  } catch {}
                  try {
                    map.removeSource("profile-line");
                  } catch {}
                  try {
                    map.removeLayer("profile-marker-0");
                  } catch {}
                  try {
                    map.removeSource("profile-marker-0");
                  } catch {}
                  try {
                    map.removeLayer("profile-marker-1");
                  } catch {}
                  try {
                    map.removeSource("profile-marker-1");
                  } catch {}
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
        {overpassLayerId && <span style={{ color: "#8b5cf6" }}>OSM query</span>}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => exportMapScreenshot(mapRef.current!, "openzenith-studio")}
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
    </div>
  );
}
