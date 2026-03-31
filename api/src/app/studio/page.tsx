"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { waitForMapLibre } from "./lib/load-map";
import { BASEMAPS, DEFAULT_CENTER, DEFAULT_ZOOM } from "./lib/constants";
import type { ToolTab, UploadedDataset } from "./lib/types";
import { addGeoJSONLayer, removeGeoJSONLayer } from "./lib/map-helpers";
import {
  createDrawState, addDrawLayers, removeDrawLayers, updateDrawLayers,
  finishDrawing, undo, redo, type DrawState, type DrawMode,
} from "./lib/drawing";
import { ToolPanel } from "./components/ToolPanel";
import { addBuildings, removeBuildings } from "../map/lib/layers";
import { encodeMapHash, decodeMapHash, loadPreferences, savePreferences } from "./lib/map-state";
import { OnboardingOverlay } from "./components/OnboardingOverlay";

/* ─── State ─── */

interface StudioLayers {
  hillshade: boolean;
  boundaries: boolean;
  earthquakes: boolean;
  warnings: boolean;
  waterways: boolean;
  nlnog: boolean;
  radar: boolean;
  weather_warnings: boolean;
}

function buildDefaultLayers(): StudioLayers {
  return {
    hillshade: true,
    boundaries: true,
    earthquakes: false,
    warnings: false,
    waterways: false,
    nlnog: false,
    radar: false,
    weather_warnings: false,
  };
}

/* ─── Component ─── */

export default function StudioPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mlglRef = useRef<any>(null);
  const layerHandleRef = useRef<{ intervals: ReturnType<typeof setInterval>[] }>({ intervals: [] });

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
  const [layers, setLayers] = useState<StudioLayers>(buildDefaultLayers);
  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [overpassLayerId, setOverpassLayerId] = useState<string | null>(null);

  const [drawState, setDrawState] = useState<DrawState>(createDrawState());
  const drawStateRef = useRef<DrawState>(drawState);
  const drawKeyHandlerRef = useRef<((ev: KeyboardEvent) => void) | null>(null);
  drawStateRef.current = drawState;

  // Update draw layers when draw state changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady) updateDrawLayers(map, drawState);
  }, [drawState, mapReady]);

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

        // Drawing mode click handler
        map.on("click", (e: any) => {
          const ds = drawStateRef.current;
          if (ds.mode === "none") return;

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

        // Keyboard shortcuts for drawing
        const drawKeyHandler = (ev: KeyboardEvent) => {
          const ds = drawStateRef.current;
          if (ds.mode === "none") return;

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

        map.on("mousemove", (e: any) => {
          setCursorPos({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        });

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
      for (const interval of layerHandleRef.current.intervals) clearInterval(interval);
      layerHandleRef.current.intervals = [];
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

    if (id === "hillshade") {
      if (enabled) {
        if (!map.getLayer("hillshade")) {
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
        }
      } else {
        if (map.getLayer("hillshade")) map.removeLayer("hillshade");
      }
    } else if (id === "buildings") {
      if (enabled) addBuildings(map, layerHandleRef.current);
      else removeBuildings(map);
    }
  }, []);

  /* ─── Basemap switch ─── */

  const handleBasemapChange = useCallback(
    (key: string) => {
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
    },
    [],
  );

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
      setDatasets((prev) =>
        prev.map((d) => (d.id === id ? { ...d, visualization } : d)),
      );
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

  const handleRemoveDataset = useCallback(
    (id: string) => {
      const map = mapRef.current;
      if (map) removeGeoJSONLayer(map, id);
      setDatasets((prev) => prev.filter((d) => d.id !== id));
    },
    [],
  );

  /* ─── Overpass results ─── */

  const handleOverpassResult = useCallback(
    (data: GeoJSON.FeatureCollection, name: string) => {
      const map = mapRef.current;
      if (!map) return;

      // Remove previous overpass layer
      if (overpassLayerId) removeGeoJSONLayer(map, overpassLayerId);

      const id = `overpass-${Date.now()}`;
      addGeoJSONLayer(map, id, data, "#8b5cf6");
      setOverpassLayerId(id);

      // Fit bounds
      const bounds = new (mlglRef.current as any).LngLatBounds();
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

  /* ─── Style vars ─── */

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#666" : "#999";

  /* ─── Render ─── */

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: bg }}>
      {/* Skip links for accessibility */}
      <a
        href="#studio-sidebar"
        style={{
          position: "absolute", top: -100, left: 8, zIndex: 9999,
          padding: "4px 8px", background: "#3b82f6", color: "#fff",
          borderRadius: 4, fontSize: 12, textDecoration: "none",
        }}
        onFocus={(e) => { (e.target as HTMLElement).style.top = "8px"; }}
        onBlur={(e) => { (e.target as HTMLElement).style.top = "-100px"; }}
      >
        Skip to sidebar
      </a>
      <a
        href="#studio-map"
        style={{
          position: "absolute", top: -100, left: 120, zIndex: 9999,
          padding: "4px 8px", background: "#3b82f6", color: "#fff",
          borderRadius: 4, fontSize: 12, textDecoration: "none",
        }}
        onFocus={(e) => { (e.target as HTMLElement).style.top = "8px"; }}
        onBlur={(e) => { (e.target as HTMLElement).style.top = "-100px"; }}
      >
        Skip to map
      </a>

      <Navbar dark={dark} breadcrumb="Studio" />

      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {/* Map */}
        <div style={{ flex: 1, position: "relative" }}>
          <ErrorBoundary>
          <div ref={containerRef} id="studio-map" role="application" aria-label="Interactive map canvas" tabIndex={0} style={{ width: "100%", height: "100%" }} />
          </ErrorBoundary>

          {/* Loading */}
          {!mapReady && !loadError && (
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "rgba(0,0,0,0.8)", color: "#fff", padding: "12px 24px",
              borderRadius: 8, fontSize: 14, zIndex: 5,
            }}>
              Loading Studio...
            </div>
          )}

          {/* Error */}
          {loadError && (
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "rgba(180,0,0,0.8)", color: "#fff", padding: "16px 24px",
              borderRadius: 8, fontSize: 14, zIndex: 5, textAlign: "center",
            }}>
              Failed to load MapLibre GL. Please refresh the page.
            </div>
          )}

          {/* Sidebar toggle */}
          {mapReady && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Close sidebar panel" : "Open sidebar panel"}
              aria-expanded={sidebarOpen}
              aria-controls="studio-sidebar"
              style={{
                position: "absolute", top: 10,
                right: isMobile ? 10 : (sidebarOpen ? 380 : 10),
                zIndex: isMobile && sidebarOpen ? 60 : 10,
                background: "rgba(0,0,0,0.6)", border: "none", color: "#fff",
                padding: "6px 10px", borderRadius: 4, cursor: "pointer", fontSize: 16,
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
                position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
                zIndex: 50,
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
            borderLeft: `1px solid ${border}`, overflow: "hidden",
            flexShrink: 0,
            transition: isMobile ? "transform 0.2s, opacity 0.2s" : "margin-right 0.2s, opacity 0.2s",
            ...(isMobile
              ? {
                  position: "absolute", top: 0, right: 0, bottom: 0,
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
          height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 16,
          padding: "0 16px", background: dark ? "#080808" : "#f0f0f0",
          borderTop: `1px solid ${border}`, fontSize: 11, fontFamily: "monospace",
          color: textSec,
        }}
      >
        {cursorPos ? (
          <span>{cursorPos.lat.toFixed(5)}, {cursorPos.lon.toFixed(5)}</span>
        ) : (
          <span>-</span>
        )}
        <span>z{zoom}</span>
        <span>{basemap}</span>
        {datasets.length > 0 && <span>{datasets.length} dataset{datasets.length > 1 ? "s" : ""}</span>}
        {overpassLayerId && <span style={{ color: "#8b5cf6" }}>OSM query</span>}
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
