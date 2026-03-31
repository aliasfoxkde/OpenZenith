"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";

/* ─── Imports from extracted modules ─── */
import type { LayerState, DashboardState, DataStatus } from "./lib/types";
import {
  DEFAULT_LAYERS, DEFAULT_STATE, THEMES,
} from "./lib/constants";
import {
  parseHash, buildHash, fmtTime, safeCopy, elevationColor,
  removeEntities as removeEntitiesHelper, toggleImageryOverlay as toggleImageryOverlayHelper,
  switchBasemapOnViewer,
} from "./lib/helpers";
import { STYLES } from "./lib/styles";
import { loadEarthquakes } from "./lib/layers/earthquakes";
import { loadEvents } from "./lib/layers/events";
import { loadElevationColor } from "./lib/layers/elevation";
import { initCesiumViewer } from "./lib/cesium-init";
import { applyLOD, getZoneLabel } from "./lib/lod";

import { createToolManager, type ToolMode } from "./lib/tools/tools";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { createElevationProfile, renderProfileChart } from "./lib/tools/elevation-profile";
import { getAllFormats } from "./lib/tools/measure";
import { useWidgetManager } from "./lib/widgets/useWidgetManager";
import { WidgetShell } from "./lib/widgets/WidgetShell";
import { WidgetBar } from "./lib/widgets/WidgetBar";
import { BasemapWidget } from "./lib/widgets/BasemapWidget";
import { LayersWidget } from "./lib/widgets/LayersWidget";
import { ToolsWidget } from "./lib/widgets/ToolsWidget";
import { SettingsWidget } from "./lib/widgets/SettingsWidget";
import { createSpaceSceneManager } from "./lib/space-scene";
import type { GlobeContext } from "./lib/widgets/types";

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export default function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const layerModulesRef = useRef<Record<string, any>>({});
  const dataLoadedRef = useRef<Record<string, boolean>>({});
  const entitiesRef = useRef<Record<string, any>>({});
  const satDataRef = useRef<any[]>([]);
  const loadLayerDynamicRef = useRef<(key: string) => Promise<void>>(undefined as unknown as (key: string) => Promise<void>);
  const addCloudOverlayRef = useRef<(() => void) | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  // ─── Context menu sub-components ───
  const closeCtx = () => { setCtxMenu(null); setExpandedGroup(null); };

  const CtxDivider = () => <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />;

  const CtxSection = ({ children }: { children: React.ReactNode }) => (
    <div style={{ padding: "2px 0" }}>{children}</div>
  );

  const CtxMenuItem = ({ label, icon, accent, color, shortcut, onClick }: { label: string; icon?: string; accent?: boolean; color?: string; shortcut?: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 12px", border: "none", background: "transparent",
        color: accent ? "var(--accent)" : color || "var(--text)", cursor: "pointer",
        textAlign: "left", fontFamily: "inherit", fontSize: "12px",
        borderRadius: 4, transition: "background .1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget.style.background = "var(--bg-hover)"); }}
      onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
    >
      {icon && <span style={{ width: 16, textAlign: "center", fontSize: "13px", flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{shortcut}</span>}
    </button>
  );

  const CtxSubMenu = ({ label, icon, children }: { label: string; icon?: string; children: React.ReactNode }) => {
    const isOpen = expandedGroup === label;
    return (
      <>
        <button
          onClick={() => setExpandedGroup(isOpen ? null : label)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "5px 12px", border: "none", background: "transparent",
            color: "var(--text)", cursor: "pointer", textAlign: "left",
            fontFamily: "inherit", fontSize: "12px", borderRadius: 4, transition: "background .1s",
          }}
          onMouseEnter={(e) => { (e.currentTarget.style.background = "var(--bg-hover)"); }}
          onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
        >
          {icon && <span style={{ width: 16, textAlign: "center", fontSize: "13px", flexShrink: 0 }}>{icon}</span>}
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: "9px", transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "rotate(0)", display: "inline-block", color: "var(--text-muted)" }}>&#9654;</span>
        </button>
        {isOpen && (
          <div style={{ paddingLeft: 16, borderLeft: "1px solid var(--border)", margin: "1px 0 1px 12px" }}>
            {children}
          </div>
        )}
      </>
    );
  };

  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  // Apply hash/localStorage state on mount (client-only to avoid hydration mismatch)
  useEffect(() => {
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("globe-theme"); } catch { /* tracking prevention */ }
    const parsed = parseHash(window.location.hash);
    const clean: Partial<DashboardState> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) (clean as any)[k] = v;
    }
    setState({
      ...DEFAULT_STATE,
      ...clean,
      layers: { ...DEFAULT_LAYERS, ...(parsed.layers || {}) },
      theme: parsed.theme || savedTheme || DEFAULT_STATE.theme,
    });
  }, []);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus[]>([
    { key: "earthquakes", label: "Earthquakes", lastUpdate: null, count: 0, error: null },
    { key: "radar", label: "Radar", lastUpdate: null, count: 0, error: null },
    { key: "flights", label: "Flights", lastUpdate: null, count: 0, error: null },
    { key: "militaryFlights", label: "Mil Flights", lastUpdate: null, count: 0, error: null },
    { key: "vessels", label: "Vessels", lastUpdate: null, count: 0, error: null },
    { key: "warnings", label: "Warnings", lastUpdate: null, count: 0, error: null },
    { key: "events", label: "Events", lastUpdate: null, count: 0, error: null },
    { key: "satellites", label: "Satellites", lastUpdate: null, count: 0, error: null },
    { key: "hurricaneTracks", label: "Hurricanes", lastUpdate: null, count: 0, error: null },
    { key: "nlnogNodes", label: "NLNOG Nodes", lastUpdate: null, count: 0, error: null },
    { key: "flightArcs", label: "Flight Arcs", lastUpdate: null, count: 0, error: null },
    { key: "currents", label: "Currents", lastUpdate: null, count: 0, error: null },
  ]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number; elev?: number | null; entity?: any } | null>(null);
  const [elevPopup, setElevPopup] = useState<{ x: number; y: number; elev: number | null; lat: number; lon: number } | null>(null);
  const [clock, setClock] = useState("");
  const [compassHeading, setCompassHeading] = useState(0);
  const [cameraAlt, setCameraAlt] = useState(0);
  const [isSpaceMode, setIsSpaceMode] = useState(false);
  const [lodZone, setLodZone] = useState<string>("SURFACE");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>("none");
  const toolManagerRef = useRef<any>(null);
  const elevationProfileRef = useRef<any>(null);
  const spaceSceneRef = useRef<any>(null);
  const [profileData, setProfileData] = useState<any[] | null>(null);
  const [coordFormats, setCoordFormats] = useState<Record<string, string> | null>(null);
  const profileCanvasRef = useRef<HTMLDivElement>(null);
  const [selectedSat, setSelectedSat] = useState<{ name: string; alt: number; vel: number; lat: number; lon: number; orbit: string } | null>(null);
  const [followSat, setFollowSat] = useState(false);

  // UTC clock for HUD themes
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setClock(now.toUTCString().split(" ")[4] + "Z");
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Persist theme
  useEffect(() => {
    try { localStorage.setItem("globe-theme", state.theme); } catch { /* tracking prevention */ }
  }, [state.theme]);

  // Compute coordinate formats from cursor position
  useEffect(() => {
    if (cursorPos) {
      setCoordFormats(getAllFormats(cursorPos[1], cursorPos[0]));
    }
  }, [cursorPos]);

  // Update hash
  useEffect(() => {
    window.history.replaceState(null, "", buildHash(state));
  }, [state]);

  const updateStatus = useCallback((key: string, update: Partial<DataStatus>) => {
    setDataStatus((prev) => prev.map((d) => (d.key === key ? { ...d, ...update } : d)));
  }, []);

  // Shorthand helpers using refs
  const removeEntities = useCallback((prefix: string) => {
    if (viewerRef.current) removeEntitiesHelper(viewerRef.current, prefix, entitiesRef.current);
  }, []);

  const toggleImageryOverlay = useCallback((name: string, url?: string, opacity?: number, maximumLevel?: number) => {
    if (viewerRef.current) toggleImageryOverlayHelper(viewerRef.current, cesiumRef.current, name, url, opacity, maximumLevel);
  }, []);

  // ─── Init Cesium Viewer ───
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Visibility handler (outer scope so cleanup can access it)
    const onVisibilityChange = () => {
      if (document.hidden) {
        intervalsRef.current.forEach(clearInterval);
        intervalsRef.current = [];
      } else {
        const viewer = viewerRef.current;
        const Cesium = cesiumRef.current;
        const activeLayers = Object.entries(dataLoadedRef.current)
          .filter(([, loaded]) => loaded)
          .map(([key]) => key);
        if (activeLayers.length > 0 && viewer && Cesium) {
          activeLayers.forEach((key) => {
            dataLoadedRef.current[key] = false;
          });
          if (activeLayers.includes("earthquakes") && state.layers.earthquakes) loadEarthquakes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (activeLayers.includes("events") && state.layers.events) loadEvents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          const dynamicKeys = ["flights", "militaryFlights", "vessels", "warnings", "satellites", "radar", "hurricaneTracks", "nlnogNodes", "flightArcs", "orbitalTracks", "groundTracks", "currents"] as const;
          for (const dk of dynamicKeys) {
            if (activeLayers.includes(dk) && state.layers[dk as keyof LayerState]) {
              loadLayerDynamicRef.current?.(dk);
            }
          }
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const container = containerRef.current;
    (async () => {
      const { viewer, Cesium, addCloudOverlay } = await initCesiumViewer(container!, state);
      if (destroyed) { viewer.destroy(); return; }

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          setCursorPos([+Cesium.Math.toDegrees(cg.longitude).toFixed(4), +Cesium.Math.toDegrees(cg.latitude).toFixed(4)]);
        }
        // Entity hover detection
        const picked = viewer.scene.pick(movement.endPosition);
        if (picked && picked.id) {
          const ent = picked.id;
          const entType = ent.properties?.type?.getValue?.() || "";
          const entName = ent.name || "";
          const entId = ent.id || "";
          let html = "";
          if (entId.startsWith("eq-")) {
            const mag = ent.properties?.mag?.getValue?.() || "";
            const place = ent.properties?.place?.getValue?.() || "";
            html = `<div style="font-weight:700;color:var(--err)">M${mag}</div><div>${place}</div>`;
          } else if (entId.startsWith("flight-") || entId.startsWith("mil-")) {
            const callsign = entName || "";
            const alt = ent.properties?.altitude?.getValue?.();
            const speed = ent.properties?.velocity?.getValue?.();
            html = `<div style="font-weight:700;color:var(--warn)">${callsign}</div>${alt != null ? `<div>Alt: ${Math.round(alt * 3.281)}ft</div>` : ""}${speed != null ? `<div>Spd: ${Math.round(speed * 1.944)}kts</div>` : ""}`;
          } else if (entId.startsWith("vessel-")) {
            const name = entName || "";
            const mmsi = entId.replace("vessel-", "");
            html = `<div style="font-weight:700;color:#4488ff">${name}</div><div>MMSI: ${mmsi}</div>`;
          } else if (entId.startsWith("sat-") || entType === "orbitalTrack") {
            const name = entName || "";
            const alt = ent.properties?.altitude?.getValue?.();
            html = `<div style="font-weight:700;color:#aa44ff">${name}</div>${alt != null ? `<div>Alt: ${(alt / 1000).toFixed(0)}km</div>` : ""}`;
          } else if (entId.startsWith("storm-")) {
            html = `<div style="font-weight:700;color:#ff00ff">${entName || "Storm"}</div>`;
          } else if (entId.startsWith("event-")) {
            const cat = ent.properties?.category?.getValue?.() || "";
            const title = ent.properties?.title?.getValue?.() || entName || "Event";
            html = `<div style="font-weight:700">${title}</div><div style="color:var(--text-muted)">${cat}</div>`;
          } else if (entName) {
            html = `<div>${entName}</div>`;
          }
          if (html) {
            setHoverTooltip({ x: movement.endPosition.x, y: movement.endPosition.y, html });
            viewer.scene.canvas.style.cursor = "pointer";
          } else {
            setHoverTooltip(null);
            viewer.scene.canvas.style.cursor = "";
          }
        } else {
          setHoverTooltip(null);
          viewer.scene.canvas.style.cursor = "";
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      handler.setInputAction((click: any) => {
        const picked = viewer.scene.pick(click.position);
        if (picked && picked.id) {
          const entity = picked.id;
          const props = entity.properties;
          if (props && props.type?.getValue() === "orbitalTrack") {
            const name = entity.name || props.group?.getValue() || "Satellite";
            const pos = entity.position?.getValue(Cesium.JulianDate.now());
            if (pos) {
              const cg = Cesium.Cartographic.fromCartesian(pos);
              const lat = +Cesium.Math.toDegrees(cg.latitude);
              const lon = +Cesium.Math.toDegrees(cg.longitude);
              const altKm = +(cg.height / 1000).toFixed(1);
              const group = props.group?.getValue() || "Unknown";
              let orbitType = "Unknown";
              if (altKm < 2000) orbitType = "LEO";
              else if (altKm > 30000) orbitType = "GEO";
              else orbitType = "MEO";
              const velKms = altKm > 30000 ? 3.07 : +(7.66 / Math.sqrt(1 + altKm / 6371)).toFixed(2);
              setSelectedSat({ name, alt: altKm, vel: velKms, lat: +lat.toFixed(2), lon: +lon.toFixed(2), orbit: orbitType });
              setFollowSat(false);
            }
            return;
          }
        }
        const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          const lng = +Cesium.Math.toDegrees(cg.longitude);
          const lat = +Cesium.Math.toDegrees(cg.latitude);

          // Handle measurement tool clicks
          if (toolManagerRef.current && toolManagerRef.current.state.mode !== "none") {
            toolManagerRef.current.handleClick(lng, lat);
            return;
          }

          // Handle elevation profile clicks
          if (activeTool === "elevation-profile" && elevationProfileRef.current) {
            elevationProfileRef.current.addPoint(lng, lat).then(() => {
              setProfileData([...elevationProfileRef.current.state.profile]);
            });
            return;
          }

          fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
            .then((r) => r.json())
            .then((d) => setElevPopup({ x: click.position.x, y: click.position.y, elev: d.elevation, lat, lon: lng }))
            .catch(() => {});
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Right-click context menu (entity-aware)
      handler.setInputAction((click: any) => {
        const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        // Check for entity under cursor
        const picked = viewer.scene.pick(click.position);
        const entity = picked?.id;
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          const lng = +Cesium.Math.toDegrees(cg.longitude);
          const lat = +Cesium.Math.toDegrees(cg.latitude);
          const entityProps = entity?.properties;
          const entityType = entityProps?.type?.getValue?.() || entityProps?.type;
          setCtxMenu({ x: click.position.x, y: click.position.y, lng, lat, entity: entity ? { id: entity.id, name: entity.name, type: entityType, properties: entityProps } : undefined });
        }
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

      handler.setInputAction((click: any) => setCtxMenu(null), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      document.addEventListener("contextmenu", (e) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) {
          e.preventDefault();
        }
      });
      document.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) setCtxMenu(null);
      });

      viewer.camera.changed.addEventListener(() => {
        const cg = viewer.camera.positionCartographic;
        if (cg) {
          const lng = +Cesium.Math.toDegrees(cg.longitude);
          const lat = +Cesium.Math.toDegrees(cg.latitude);
          const heightM = cg.height;
          const zoomEst = Math.max(1, Math.log2(40075016 / heightM));
          setState((prev) => ({ ...prev, center: [lng, lat], zoom: zoomEst }));
        }
      });

      viewerRef.current = viewer;
      cesiumRef.current = Cesium;
      addCloudOverlayRef.current = addCloudOverlay;
      toolManagerRef.current = createToolManager(viewer, Cesium);
      elevationProfileRef.current = createElevationProfile(viewer, Cesium);
      spaceSceneRef.current = createSpaceSceneManager(viewer, Cesium);
      setLoading(false);

      // Track camera heading, altitude, space mode, atmosphere fading, and follow mode
      let followEntity: any = null;
      let currentLodZone: any = null;
      let lastUIUpdate = 0;
      let prevAlt = 0;
      const preRenderListener = () => {
        // Follow-entity needs per-frame update for smooth tracking
        if (followEntity) {
          const pos = followEntity.position?.getValue(Cesium.JulianDate.now());
          if (pos) {
            const camH = viewer.camera.positionCartographic?.height || 2000000;
            viewer.camera.lookAt(
              pos,
              new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), camH > 500000 ? camH * 0.5 : 2000000),
            );
          }
        }

        // Throttle all other work to ~4Hz
        const now = performance.now();
        if (now - lastUIUpdate < 250) return;

        const cg = viewer.camera.positionCartographic;
        if (!cg) return;
        const heightM = cg.height;

        // Early return if altitude unchanged — skips LOD, atmosphere, React state
        if (heightM === prevAlt) return;
        lastUIUpdate = now;
        prevAlt = heightM;

        // LOD (only on altitude change)
        const newZone = applyLOD(viewer, Cesium, heightM, currentLodZone);
        if (newZone.name !== currentLodZone?.name) {
          currentLodZone = newZone;
          setLodZone(newZone.label);
        }

        // Atmosphere brightness (only on altitude change, compare before assigning)
        const sa = viewer.scene.skyAtmosphere;
        let newBrightness: number;
        if (heightM < 10000) newBrightness = 0.1;
        else if (heightM < 300000) newBrightness = 0.1 - 0.4 * ((heightM - 10000) / 290000);
        else newBrightness = -0.3;
        if (sa.brightnessShift !== newBrightness) sa.brightnessShift = newBrightness;

        const showGround = heightM < 500000;
        if (viewer.scene.globe.showGroundAtmosphere !== showGround)
          viewer.scene.globe.showGroundAtmosphere = showGround;

        // React state (batched by React 18)
        const heading = Cesium.Math.toDegrees(viewer.camera.heading);
        setCameraAlt(heightM);
        setIsSpaceMode(heightM > 100000);
        setCompassHeading(-heading);
      };

      (window as any).__ozSetFollowEntity = (entity: any | null) => { followEntity = entity; };
      viewer.scene.preRender.addEventListener(preRenderListener);
    })();

    return () => {
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      intervalsRef.current.forEach(clearInterval);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Basemap switch ──
  const switchBasemap = useCallback((key: string) => {
    setState((prev) => ({ ...prev, basemap: key }));
    if (viewerRef.current) {
      switchBasemapOnViewer(viewerRef.current, key);
      addCloudOverlayRef.current?.();
    }
  }, []);

  // ─── View mode switch ───
  const switchViewMode = useCallback((mode: "3d" | "2d" | "columbus") => {
    setState((prev) => ({ ...prev, viewMode: mode }));
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    switch (mode) {
      case "3d": viewer.scene.morphTo3D(1.5); break;
      case "2d": viewer.scene.morphTo2D(1.5); break;
      case "columbus": viewer.scene.morphToColumbusView(1.5); break;
    }
  }, []);

  // ─── Zoom & Navigation Controls ───
  const zoomIn = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const h = viewer.camera.positionCartographic.height;
    viewer.camera.zoomIn(h * 0.5);
    viewer.scene.requestRender();
  }, []);

  const zoomOut = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const h = viewer.camera.positionCartographic.height;
    viewer.camera.zoomOut(h * 0.5);
    viewer.scene.requestRender();
  }, []);

  const resetView = useCallback(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 20, 15000000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 1.5,
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const wrap = document.querySelector(".wv-wrap");
    if (!wrap) return;
    if (!document.fullscreenElement) {
      wrap.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // ─── Keyboard Bindings ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "+": case "=": zoomIn(); break;
        case "-": case "_": zoomOut(); break;
        case "r": case "R": resetView(); break;
        case "f": case "F": toggleFullscreen(); break;
        case "Escape": setCtxMenu(null); break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, resetView, toggleFullscreen]);

  // Render elevation profile chart
  useEffect(() => {
    if (!profileCanvasRef.current || !profileData || profileData.length < 2) return;
    const container = profileCanvasRef.current;
    container.innerHTML = "";
    const canvas = renderProfileChart(profileData, 480, 180);
    container.appendChild(canvas);
  }, [profileData]);

  const flyToOrbit = useCallback((altKm: number, _label?: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const Cesium = cesiumRef.current;
    if (!Cesium) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, altKm * 1000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 2,
    });
  }, []);

  // Load space scene (stars + planets) lazily on first space mode entry
  useEffect(() => {
    if (isSpaceMode && spaceSceneRef.current && !spaceSceneRef.current.state.starsLoaded) {
      spaceSceneRef.current.loadAll();
    }
  }, [isSpaceMode]);

  const flyToISS = useCallback(async () => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const satJs = (window as any).satellite;
    if (!Cesium || !viewer || !satJs) return;
    try {
      const r = await fetch("/api/proxy/https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json");
      const data = await r.json();
      if (!Array.isArray(data) || !data[0]?.TLE_LINE1) return;
      const tle = data[0];
      const satrec = satJs.twoline2satrec(tle.TLE_LINE1, tle.TLE_LINE2);
      const pos = satJs.propagate(satrec, new Date());
      if (!pos.position) return;
      const gmst = satJs.gstime(new Date());
      const ecf = satJs.eciToEcf(pos.position, gmst);
      const posM = new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
      viewer.camera.flyTo({
        destination: new Cesium.Cartesian3(posM.x * 1.1, posM.y * 1.1, posM.z * 1.1),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2,
      });
    } catch { /* ISS position unavailable */ }
  }, []);

  const compassNorth = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5,
    });
  }, []);

  // ─── Dynamic layer loader (lazy imports with cache) ───
  const loadLayerDynamic = useCallback(async (key: string) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || dataLoadedRef.current[key]) return;

    let mod: any;
    switch (key) {
      case "radar": mod = layerModulesRef.current.radar ??= await import("./lib/layers/radar"); break;
      case "flights": mod = layerModulesRef.current.flights ??= await import("./lib/layers/flights"); break;
      case "militaryFlights": mod = layerModulesRef.current.militaryFlights ??= await import("./lib/layers/military"); break;
      case "vessels": mod = layerModulesRef.current.vessels ??= await import("./lib/layers/vessels"); break;
      case "warnings": mod = layerModulesRef.current.warnings ??= await import("./lib/layers/warnings"); break;
      case "satellites": mod = layerModulesRef.current.satellites ??= await import("./lib/layers/satellites"); break;
      case "hurricaneTracks": mod = layerModulesRef.current.hurricaneTracks ??= await import("./lib/layers/hurricanes"); break;
      case "nlnogNodes": mod = layerModulesRef.current.nlnogNodes ??= await import("./lib/layers/nlnog"); break;
      case "flightArcs": mod = layerModulesRef.current.flightArcs ??= await import("./lib/layers/flight-arcs"); break;
      case "orbitalTracks": mod = layerModulesRef.current.orbitalTracks ??= await import("./lib/layers/orbital-tracks"); break;
      case "groundTracks": mod = layerModulesRef.current.groundTracks ??= await import("./lib/layers/ground-tracks"); break;
      case "currents": mod = layerModulesRef.current.currents ??= await import("./lib/layers/currents"); break;
      case "spaceWeather": mod = layerModulesRef.current.spaceWeather ??= await import("./lib/layers/space-weather"); break;
      case "airQuality": mod = layerModulesRef.current.airQuality ??= await import("./lib/layers/air-quality"); break;
      case "aviationWeather": mod = layerModulesRef.current.aviationWeather ??= await import("./lib/layers/aviation-weather"); break;
      case "volcanoes": mod = layerModulesRef.current.volcanoes ??= await import("./lib/layers/volcanoes"); break;
      case "gdacs": mod = layerModulesRef.current.gdacs ??= await import("./lib/layers/gdacs"); break;
      case "marineWeather": mod = layerModulesRef.current.marineWeather ??= await import("./lib/layers/marine-weather"); break;
      case "wildfires": mod = layerModulesRef.current.wildfires ??= await import("./lib/layers/wildfires"); break;
      case "lightning": mod = layerModulesRef.current.lightning ??= await import("./lib/layers/lightning"); break;
    }
    if (!mod) return;

    switch (key) {
      case "radar": mod.loadRadar(viewer, Cesium, updateStatus, toggleImageryOverlay, intervalsRef, state.layers); break;
      case "flights": mod.loadFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "militaryFlights": mod.loadMilitaryFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "vessels": mod.loadVessels(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "warnings": mod.loadWarnings(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "satellites": mod.loadSatellites(viewer, Cesium, updateStatus, removeEntities, intervalsRef, entitiesRef, satDataRef, state.layers); break;
      case "hurricaneTracks": mod.loadHurricanes(viewer, Cesium, updateStatus); break;
      case "nlnogNodes": mod.loadNlnogNodes(viewer, Cesium, updateStatus); break;
      case "flightArcs": mod.loadFlightArcs(viewer, Cesium, updateStatus); break;
      case "orbitalTracks": mod.loadOrbitalTracks(viewer, Cesium, updateStatus); break;
      case "groundTracks": mod.loadGroundTracks(viewer, Cesium); break;
      case "currents": mod.loadCurrents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "spaceWeather": mod.loadSpaceWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "airQuality": mod.loadAirQuality(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "aviationWeather": mod.loadAviationWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "volcanoes": mod.loadVolcanoes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "gdacs": mod.loadGDACS(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "marineWeather": mod.loadMarineWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "wildfires": mod.loadWildfires(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
      case "lightning": mod.loadLightning(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers); break;
    }
    dataLoadedRef.current[key] = true;
  }, [state.layers]);
  loadLayerDynamicRef.current = loadLayerDynamic;

  // ─── Layer toggling ───
  const toggleLayer = useCallback((key: keyof LayerState) => {
    setState((prev) => {
      const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
      const on = next.layers[key];
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      if (!Cesium || !viewer) return next;

      switch (key) {
        case "earthquakes":
          if (on && !dataLoadedRef.current.earthquakes) loadEarthquakes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("eq-");
          break;
        case "radar":
          if (on) loadLayerDynamic("radar");
          if (!on) removeEntities("radar-"); break;
        case "flights":
          if (on) loadLayerDynamic("flights");
          if (!on) removeEntities("flight-"); break;
        case "militaryFlights":
          if (on) loadLayerDynamic("militaryFlights");
          if (!on) removeEntities("mil-"); break;
        case "vessels":
          if (on) loadLayerDynamic("vessels");
          if (!on) {
            removeEntities("vessel-");
            const vesselMod = layerModulesRef.current.vessels;
            if (vesselMod) vesselMod.cleanupVessels();
          }
          break;
        case "warnings":
          if (on) loadLayerDynamic("warnings");
          if (!on) removeEntities("warn-"); break;
        case "events":
          if (on && !dataLoadedRef.current.events) loadEvents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("event-"); break;
        case "satellites":
          if (on) loadLayerDynamic("satellites");
          if (!on) removeEntities("sat-"); break;
        case "hurricaneTracks":
          if (on) loadLayerDynamic("hurricaneTracks");
          if (!on) removeEntities("storm-"); break;
        case "satellite":
          if (on) toggleImageryOverlay("nasa-gibs",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-03-31/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg",
            0.7, 9
          );
          else toggleImageryOverlay("nasa-gibs"); break;
        case "blueMarble":
          if (on) toggleImageryOverlay("BlueMarble_ShadedRelief",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
            0.85, 8
          );
          else toggleImageryOverlay("BlueMarble_ShadedRelief"); break;
        case "nightLights":
          if (on) toggleImageryOverlay("VIIRS_CityLights",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
            1.0
          );
          else toggleImageryOverlay("VIIRS_CityLights"); break;
        case "nlnogNodes":
          if (on) loadLayerDynamic("nlnogNodes");
          if (!on) removeEntities("nlnog-"); break;
        case "flightArcs":
          if (on) loadLayerDynamic("flightArcs");
          if (!on) removeEntities("arc-"); break;
        case "hillshade":
          break;
        case "elevationColor":
          // Toggle elevation color material on the globe
          if (on && !dataLoadedRef.current.elevationColor) {
            doLoadElevationColor();
            dataLoadedRef.current.elevationColor = true;
          } else if (!on) {
            removeEntities("elev-");
            dataLoadedRef.current.elevationColor = false;
          }
          break;
        case "orbitalTracks":
          if (on) loadLayerDynamic("orbitalTracks");
          if (!on) removeEntities("orbit-"); break;
        case "groundTracks":
          if (on) loadLayerDynamic("groundTracks");
          if (!on) removeEntities("gtrack-"); break;
        case "currents":
          if (on) loadLayerDynamic("currents");
          if (!on) removeEntities("current-"); break;
      }
      return next;
    });
  }, [loadLayerDynamic]);

  // ─── Section/theme toggles ───
  const switchTheme = useCallback((key: string) => {
    setState((prev) => ({ ...prev, theme: key }));
    setThemeDropdownOpen(false);
  }, []);

  // ─── Fly To helper ───
  const flyTo = useCallback((lat: number, lon: number, alt?: number) => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt || 50000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
      duration: 1.5,
    });
  }, []);

  // ─── Widget system ───
  const widgetComponents = useMemo(() => ({
    basemaps: BasemapWidget,
    layers: LayersWidget,
    tools: ToolsWidget,
    settings: SettingsWidget,
  }), []);

  const { widgets, updateWidget, toggleWidget, resetLayout } = useWidgetManager(widgetComponents);

  const globeContext: GlobeContext = useMemo(() => ({
    viewerRef, cesiumRef, state, setState,
    toggleLayer, switchBasemap, switchTheme, switchViewMode,
    activeTool, setActiveTool,
    toolManagerRef, elevationProfileRef,
    cursorPos, dataStatus, flyTo,
  }), [viewerRef, cesiumRef, state, setState, toggleLayer, switchBasemap, switchTheme, switchViewMode, activeTool, setActiveTool, toolManagerRef, elevationProfileRef, cursorPos, dataStatus, flyTo]);

  // ─── Elevation Color (batched) ───
  const elevTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doLoadElevationColor = useCallback(async () => {
    await loadElevationColor(viewerRef.current, cesiumRef.current, entitiesRef.current);
  }, []);

  useEffect(() => {
    if (!state.layers.elevationColor || loading) return;

    const update = () => {
      if (elevTimerRef.current) clearTimeout(elevTimerRef.current);
      elevTimerRef.current = setTimeout(() => {
        doLoadElevationColor();
      }, 2000);
    };

    doLoadElevationColor();

    const viewer = viewerRef.current;
    if (viewer) {
      viewer.camera.changed.addEventListener(update);
    }

    return () => {
      if (elevTimerRef.current) clearTimeout(elevTimerRef.current);
      if (viewer) {
        viewer.camera.changed.removeEventListener(update);
      }
    };
  }, [state.layers.elevationColor, loading, doLoadElevationColor]);

  // ─── Load initial layers ───
  useEffect(() => {
    if (!loading) {
      if (state.layers.earthquakes) loadEarthquakes(viewerRef.current, cesiumRef.current, updateStatus, removeEntities, intervalsRef, state.layers);
      if (state.layers.events) loadEvents(viewerRef.current, cesiumRef.current, updateStatus, removeEntities, intervalsRef, state.layers);
    }
  }, [loading, state.layers.earthquakes, state.layers.events, updateStatus, removeEntities, intervalsRef]);

  // ─── Render ───
  const currentTheme = THEMES[state.theme] || THEMES.default;
  const isHud = state.theme === "classified" || state.theme === "crimson";
  const themeStyle = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const pair of currentTheme.css.split(";")) {
      const idx = pair.indexOf(":");
      if (idx === -1) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k && v) obj[k] = v;
    }
    return obj;
  }, [currentTheme.css]);

  return (
    <div className="wv-wrap" style={themeStyle as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {loading && (
        <div className="wv-loading-overlay"><div className="spinner" /></div>
      )}

      <div className="wv-scanlines" />
      <div className="wv-grid-overlay" />
      <div className="wv-hud-corners"><div className="wv-hud-inner" /></div>

      {isHud && (
        <div className="wv-classification">
          {state.theme === "classified" ? "TOP SECRET // SCI" : "RESTRICTED // OPERATIONAL"}
          <span className="wv-blink" style={{ marginLeft: 12, fontSize: 9, opacity: 0.5 }}>●</span>
        </div>
      )}

      {isHud && (
        <div className="wv-ticker">
          <div className="wv-ticker-inner">
            SIGINT FEED ACTIVE ◆ GEOSPATIAL INTEL COLLECTION IN PROGRESS ◆ ALL SOURCES NOMINAL ◆
            {dataStatus.filter((d) => d.lastUpdate).map((d) => `${d.label.toUpperCase()}: ${d.count} OBJECTS`).join(" ◆ ")} ◆
            LAT {cursorPos ? cursorPos[1] : "----"} LON {cursorPos ? cursorPos[0] : "----"} ◆
            ZOOM {state.zoom.toFixed(1)} ◆ VIEW {state.viewMode.toUpperCase()} ◆ {clock}
          </div>
        </div>
      )}

      {/* Nav */}
      <Navbar
        dark
        breadcrumb="Globe"
        extra={
          <>
            <div className="wv-view-toggle">
              {(["3d", "columbus", "2d"] as const).map((mode) => (
                <button key={mode} className={`wv-view-btn ${state.viewMode === mode ? "active" : ""}`} onClick={() => switchViewMode(mode)}>
                  {mode === "3d" ? "3D" : mode === "columbus" ? "CB" : "2D"}
                </button>
              ))}
            </div>
            {isHud && <span className="wv-nav-time">{clock}</span>}
            <div className="wv-theme-switcher">
              <button className="wv-theme-btn" onClick={() => setThemeDropdownOpen(!themeDropdownOpen)} title="Change theme">{currentTheme.icon}</button>
              {themeDropdownOpen && (
                <div className="wv-theme-dropdown">
                  {Object.entries(THEMES).map(([k, v]) => (
                    <button key={k} className={`wv-theme-option ${state.theme === k ? "active" : ""}`} onClick={() => switchTheme(k)}>
                      <span className="swatch" style={{ background: k === "default" ? "#4a9eff" : k === "classified" ? "#00ff41" : k === "amber" ? "#ffb000" : k === "arctic" ? "#00ccff" : "#ff2222" }} />
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      />

      <ErrorBoundary>
      <div ref={containerRef} className="wv-map" />
      </ErrorBoundary>

      {/* Compass */}
      <div className="wv-compass" onClick={compassNorth} title="Reset north">
        <div className="wv-compass-inner" style={{ transform: `rotate(${compassHeading.toFixed(1)}deg)` }}>
          <div className="wv-compass-n">N</div>
          <div className="wv-compass-needle" />
          <div className="wv-compass-s">S</div>
        </div>
      </div>

      {/* LOD zone badge */}
      <div className={`wv-space-badge ${isSpaceMode ? "visible" : ""}`}>
        {lodZone}{" "}{cameraAlt > 1000 ? `${(cameraAlt / 1000).toFixed(0)} km` : `${cameraAlt.toFixed(0)} m`} ALT
      </div>

      {/* Zoom controls */}
      <div className="wv-zoom-controls">
        <button className="wv-zoom-btn" onClick={zoomIn} title="Zoom in (+)">+</button>
        <button className="wv-zoom-btn" onClick={zoomOut} title="Zoom out (-)">&minus;</button>
        <button className="wv-zoom-btn" onClick={resetView} title="Reset view (R)" style={{ fontSize: "12px" }}>&#8962;</button>
        <button className="wv-zoom-btn" onClick={flyToISS} title="Fly to ISS" style={{ fontSize: "10px", color: "var(--accent)" }}>&#9741;</button>
        <button className="wv-zoom-btn" onClick={toggleFullscreen} title="Fullscreen (F)" style={{ fontSize: "12px" }}>{isFullscreen ? "\u29C9" : "\u26F6"}</button>
      </div>

      {/* Elevation profile chart */}
      {activeTool === "elevation-profile" && (
        <div className="wv-profile-panel">
          <div className="wv-profile-header">
            <span className="wv-profile-title">Elevation Profile</span>
            <button className="wv-profile-close" onClick={() => { setActiveTool("none"); elevationProfileRef.current?.clear(); setProfileData(null); }}>&times;</button>
          </div>
          <div ref={profileCanvasRef} className="wv-profile-chart" />
          {!profileData && <div className="wv-profile-hint">Click 2+ points on the globe to create a terrain cross-section</div>}
        </div>
      )}

      {/* Coordinate formats panel */}
      {coordFormats && (
        <div className="wv-coord-panel">
          {Object.entries(coordFormats).map(([fmt, val]) => (
            <div key={fmt} className="wv-coord-row">
              <span className="wv-coord-label">{fmt}</span>
              <span className="wv-coord-val" title="Click to copy" onClick={() => { navigator.clipboard.writeText(val); }}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Orbital altitude presets */}
      <div className="wv-orbit-presets">
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(408, "ISS")}>ISS<span className="alt">408 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(2000, "LEO")}>LEO<span className="alt">2,000 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(20200, "MEO")}>MEO<span className="alt">20,200 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(35786, "GEO")}>GEO<span className="alt">35,786 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(45000, "Moon")}>Moon<span className="alt">384,400 km</span></button>
      </div>

      {/* Widget bar */}
      <WidgetBar widgets={widgets} onToggle={toggleWidget} onResetLayout={resetLayout} />

      {/* Floating widgets */}
      {Object.entries(widgets).map(([id, entry]) => (
        <WidgetShell
          key={id}
          config={entry.config}
          state={entry.state}
          onStateChange={(patch) => updateWidget(id, patch)}
        >
          <entry.component globe={globeContext} />
        </WidgetShell>
      ))}

      {/* Close theme dropdown on outside click */}
      {themeDropdownOpen && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setThemeDropdownOpen(false)} />}

      {/* Context menu (right-click) — grouped with expandable sub-menus */}
      {ctxMenu && (() => {
        const { x, y, lng, lat, entity } = ctxMenu;
        const entType = entity?.type as string | undefined;
        const entName = entity?.name as string | undefined;
        const entId = entity?.id as string | undefined;
        const entProps = entity?.properties;
        const isEq = entId?.startsWith("eq-");
        const isFlight = entId?.startsWith("flight-") || entId?.startsWith("mil-");
        const isVessel = entId?.startsWith("vessel-");
        const isSat = entId?.startsWith("sat-") || entType === "orbitalTrack";
        const isStorm = entId?.startsWith("storm-");
        const isEvent = entId?.startsWith("event-");
        const isEntity = isEq || isFlight || isVessel || isSat || isStorm || isEvent;

        // Keep menu within viewport (safe for SSR — only runs client-side since ctxMenu is client-set)
        const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
        const vh = typeof window !== "undefined" ? window.innerHeight : 768;
        const menuW = 240;
        const adjustedX = x + menuW > vw ? vw - menuW - 8 : x;
        const adjustedY = Math.min(y, vh - 8);

        return (
          <div className="wv-ctx-menu" style={{
            position: "fixed", top: adjustedY, left: adjustedX, zIndex: 200,
            background: "var(--bg-solid)", border: "1px solid var(--border-hover)",
            borderRadius: 8, padding: "4px 0", minWidth: menuW, maxHeight: "70vh",
            overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)", fontFamily: "var(--font-ui)", fontSize: "12px",
          }}>
            {/* Entity header */}
            {entity && (
              <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", marginBottom: 2, fontSize: "11px", color: "var(--text-muted)" }}>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "12px", marginBottom: 2 }}>{entName || entId}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: isEq ? "var(--err)" : isFlight ? "var(--warn)" : isVessel ? "#4488ff" : isSat ? "#aa44ff" : isStorm ? "#ff00ff" : "var(--accent)", flexShrink: 0 }} />
                  <span>{entType || "Entity"}</span>
                </div>
              </div>
            )}

            {/* ── Zoom ── */}
            <CtxSection>
              <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>NAVIGATE</div>
              <CtxMenuItem label="Fly here (close)" icon="&#x1F50D;" accent onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (v && C) v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lng, lat, 10000), orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 }, duration: 1.5 });
                closeCtx();
              }} />
              <CtxMenuItem label="Fly here (overview)" icon="&#x1F30D;" accent onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (v && C) v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lng, lat, 200000), orientation: { heading: 0, pitch: C.Math.toRadians(-60), roll: 0 }, duration: 2 });
                closeCtx();
              }} />
              <CtxMenuItem label="Fly here (orbital)" icon="&#x1F680;" accent onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (v && C) v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lng, lat, 5000000), orientation: { heading: 0, pitch: C.Math.toRadians(-75), roll: 0 }, duration: 3 });
                closeCtx();
              }} />
              <CtxMenuItem label="Zoom to ISS" icon="&#x1F6F0;" accent onClick={() => { flyToISS(); closeCtx(); }} />
            </CtxSection>

            <CtxDivider />

            {/* ── Create ── */}
            <CtxSection>
              <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>CREATE</div>
              <CtxMenuItem label="Add marker" icon="&#x1F4CD;" color="var(--err)" onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (v && C) v.entities.add({ id: `marker-${Date.now()}`, position: C.Cartesian3.fromDegrees(lng, lat), point: { pixelSize: 10, color: C.Color.fromCssColorString("#ff4444") }, label: { text: "Marker", font: "11px sans-serif", fillColor: C.Color.WHITE, style: C.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, outlineColor: C.Color.BLACK, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -12) } });
                v.scene.requestRender(); closeCtx();
              }} />
              <CtxMenuItem label="Add annotation" icon="&#x270D;" color="#44aaff" onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (v && C) v.entities.add({ id: `ann-text-${Date.now()}`, position: C.Cartesian3.fromDegrees(lng, lat), label: { text: "Double-click to edit", font: "12px sans-serif", fillColor: C.Color.fromCssColorString("#44aaff"), style: C.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, outlineColor: C.Color.BLACK, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -14), showBackground: true, backgroundColor: new C.Color(0, 0, 0, 0.7), backgroundPadding: new C.Cartesian2(6, 4) } });
                v.scene.requestRender(); closeCtx();
              }} />
              <CtxMenuItem label="Place range rings" icon="&#x25CE;" color="var(--warn)" onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (!v || !C) { closeCtx(); return; }
                for (const r of [50, 100, 200, 500]) {
                  const rDeg = r / 111.32;
                  v.entities.add({ id: `ring-${r}km-${Date.now()}`, position: C.Cartesian3.fromDegrees(lng, lat), ellipse: { semiMajorAxis: rDeg, semiMinorAxis: rDeg, material: C.Color.fromCssColorString("#eab308").withAlpha(0.08), outline: true, outlineColor: C.Color.fromCssColorString("#eab308").withAlpha(0.3) } });
                }
                v.scene.requestRender(); closeCtx();
              }} />
              <CtxMenuItem label="Add bookmark" icon="&#x2606;" color="var(--warn)" onClick={() => {
                const v = viewerRef.current; const C = cesiumRef.current;
                if (!v || !C) { closeCtx(); return; }
                const cam = v.camera; const cg = cam.positionCartographic;
                const bm = { id: `bm-${Date.now()}`, name: `Bookmark @ ${lat.toFixed(2)}, ${lng.toFixed(2)}`, lat, lon: lng, alt: cg.height, heading: C.Math.toDegrees(cam.heading), pitch: C.Math.toDegrees(cam.pitch), timestamp: Date.now() };
                try { const existing = JSON.parse(localStorage.getItem("globe-bookmarks") || "[]"); existing.push(bm); localStorage.setItem("globe-bookmarks", JSON.stringify(existing)); } catch { /* */ }
                closeCtx();
              }} />
            </CtxSection>

            <CtxDivider />

            {/* ── Measure ── */}
            <CtxSection>
              <CtxSubMenu label="Measure" icon="&#x1F4CF;">
                <CtxMenuItem label="Distance from here" icon="&#x2194;" onClick={() => {
                  setActiveTool("measure-distance");
                  if (toolManagerRef.current) { toolManagerRef.current.setMode("measure-distance"); toolManagerRef.current.handleClick(lng, lat); }
                  closeCtx();
                }} />
                <CtxMenuItem label="Area from here" icon="&#x25A1;" onClick={() => {
                  setActiveTool("measure-area");
                  if (toolManagerRef.current) { toolManagerRef.current.setMode("measure-area"); toolManagerRef.current.handleClick(lng, lat); }
                  closeCtx();
                }} />
                <CtxMenuItem label="Elevation profile" icon="&#x26F0;" onClick={() => {
                  setActiveTool("elevation-profile");
                  if (elevationProfileRef.current) elevationProfileRef.current.addPoint(lng, lat);
                  closeCtx();
                }} />
              </CtxSubMenu>
            </CtxSection>

            <CtxDivider />

            {/* ── Copy ── */}
            <CtxSection>
              <CtxSubMenu label="Copy" icon="&#x2398;">
                <CtxMenuItem label="Coordinates (DD)" onClick={() => { safeCopy(`${lat.toFixed(6)}, ${lng.toFixed(6)}`); closeCtx(); }} />
                <CtxMenuItem label="Compact" onClick={() => { safeCopy(`${lat.toFixed(4)},${lng.toFixed(4)}`); closeCtx(); }} />
                <CtxMenuItem label="DMS" onClick={() => {
                  const toDms = (d: number, pos: string, neg: string) => { const dir = d >= 0 ? pos : neg; const a = Math.abs(d); const deg = Math.floor(a); const min = Math.floor((a - deg) * 60); const sec = ((a - deg - min / 60) * 3600).toFixed(2); return `${deg}\u00b0${min}'${sec}"${dir}`; };
                  safeCopy(`${toDms(lat, "N", "S")} ${toDms(lng, "E", "W")}`);
                  closeCtx();
                }} />
                <CtxMenuItem label="Elevation" color="var(--ok)" onClick={async () => {
                  try { const r = await fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`); const d = await r.json(); safeCopy(`${d.elevation !== null ? d.elevation + "m" : "No data"} @ ${lat.toFixed(6)}, ${lng.toFixed(6)}`); } catch { /* */ }
                  closeCtx();
                }} />
              </CtxSubMenu>
            </CtxSection>

            <CtxDivider />

            {/* ── Edit / Manage ── */}
            <CtxSection>
              <CtxSubMenu label="Edit" icon="&#x270E;">
                <CtxMenuItem label="Clear measurements" color="var(--err)" onClick={() => {
                  if (toolManagerRef.current) toolManagerRef.current.clear();
                  setActiveTool("none"); closeCtx();
                }} />
                <CtxMenuItem label="Clear annotations" color="var(--err)" onClick={() => {
                  const v = viewerRef.current; if (!v) return;
                  const toRemove: any[] = [];
                  v.entities.values.forEach((e: any) => { if (e.id && (e.id.startsWith("marker-") || e.id.startsWith("ann-text-") || e.id.startsWith("ann-line-") || e.id.startsWith("ann-poly-"))) toRemove.push(e); });
                  toRemove.forEach((e) => v.entities.remove(e));
                  v.scene.requestRender(); closeCtx();
                }} />
                <CtxMenuItem label="Clear range rings" color="var(--err)" onClick={() => {
                  const v = viewerRef.current; if (!v) return;
                  const toRemove: any[] = [];
                  v.entities.values.forEach((e: any) => { if (e.id && e.id.startsWith("ring-")) toRemove.push(e); });
                  toRemove.forEach((e) => v.entities.remove(e));
                  v.scene.requestRender(); closeCtx();
                }} />
                <CtxMenuItem label="Clear all custom" color="var(--err)" onClick={() => {
                  const v = viewerRef.current; if (!v) return;
                  const toRemove: any[] = [];
                  v.entities.values.forEach((e: any) => { if (e.id && (e.id.startsWith("marker-") || e.id.startsWith("ann-") || e.id.startsWith("ring-") || e.id.startsWith("bm-"))) toRemove.push(e); });
                  toRemove.forEach((e) => v.entities.remove(e));
                  if (toolManagerRef.current) toolManagerRef.current.clear();
                  setActiveTool("none"); v.scene.requestRender(); closeCtx();
                }} />
              </CtxSubMenu>
            </CtxSection>

            <CtxDivider />

            {/* ── Entity-specific actions ── */}
            {isEq && (
              <CtxSection>
                <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>EARTHQUAKE</div>
                <CtxMenuItem label="USGS details" icon="&#x1F517;" accent onClick={() => {
                  const usgsId = entId?.replace("eq-", "");
                  window.open(`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`, "_blank"); closeCtx();
                }} />
                <CtxMenuItem label="Copy coordinates" onClick={() => { safeCopy(`${lat.toFixed(6)}, ${lng.toFixed(6)}`); closeCtx(); }} />
              </CtxSection>
            )}
            {isFlight && (
              <CtxSection>
                <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>AIRCRAFT</div>
                <CtxMenuItem label="FlightAware" icon="&#x1F517;" accent onClick={() => {
                  const callsign = entName || entId?.replace("flight-", "") || "";
                  window.open(`https://flightaware.com/live/flight/${callsign}`, "_blank"); closeCtx();
                }} />
                <CtxMenuItem label="Copy callsign" onClick={() => { safeCopy(entName || entId || ""); closeCtx(); }} />
              </CtxSection>
            )}
            {isVessel && (
              <CtxSection>
                <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>VESSEL</div>
                <CtxMenuItem label="MarineTraffic" icon="&#x1F517;" accent onClick={() => {
                  const mmsi = entId?.replace("vessel-", "") || "";
                  window.open(`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`, "_blank"); closeCtx();
                }} />
                <CtxMenuItem label="Copy MMSI" onClick={() => { safeCopy(entId?.replace("vessel-", "") || ""); closeCtx(); }} />
              </CtxSection>
            )}
            {isSat && (
              <CtxSection>
                <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>SATELLITE</div>
                <CtxMenuItem label="Show orbit info" icon="&#x1F6F0;" accent onClick={() => {
                  // Trigger the left-click satellite info flow
                  const v = viewerRef.current; const C = cesiumRef.current;
                  if (v && C && entity) {
                    const found = v.entities.values.find((e: any) => e.id === entId || (entName && e.name?.includes(entName)));
                    if (found) {
                      const pos = found.position?.getValue(C.JulianDate.now());
                      if (pos) {
                        const cg = C.Cartographic.fromCartesian(pos);
                        const altKm = +(cg.height / 1000).toFixed(1);
                        const group = found.properties?.group?.getValue?.() || entName || "Unknown";
                        let orbitType = "Unknown";
                        if (altKm < 2000) orbitType = "LEO"; else if (altKm > 30000) orbitType = "GEO"; else orbitType = "MEO";
                        const velKms = altKm > 30000 ? 3.07 : +(7.66 / Math.sqrt(1 + altKm / 6371)).toFixed(2);
                        setSelectedSat({ name: entName || group, alt: altKm, vel: velKms, lat: +C.Math.toDegrees(cg.latitude).toFixed(2), lon: +C.Math.toDegrees(cg.longitude).toFixed(2), orbit: orbitType });
                      }
                    }
                  }
                  closeCtx();
                }} />
                <CtxMenuItem label="Follow satellite" icon="&#x1F440;" onClick={() => {
                  const v = viewerRef.current;
                  if (v) {
                    const found = v.entities.values.find((e: any) => e.id === entId || (entName && e.name?.includes(entName)));
                    (window as any).__ozSetFollowEntity?.(found || null);
                    setFollowSat(true);
                  }
                  closeCtx();
                }} />
              </CtxSection>
            )}
            {isStorm && (
              <CtxSection>
                <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>STORM</div>
                <CtxMenuItem label="NHC advisory" icon="&#x1F517;" accent onClick={() => {
                  window.open("https://www.nhc.noaa.gov/", "_blank"); closeCtx();
                }} />
                <CtxMenuItem label="Zoom to track" onClick={() => {
                  const v = viewerRef.current; const C = cesiumRef.current;
                  if (v && C) v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lng, lat, 3000000), orientation: { heading: 0, pitch: C.Math.toRadians(-70), roll: 0 }, duration: 2 });
                  closeCtx();
                }} />
              </CtxSection>
            )}

            {/* ── External links ── */}
            <CtxSection>
              <div style={{ padding: "2px 12px 1px", fontSize: "9px", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "1px", fontFamily: "var(--font-mono)" }}>EXTERNAL</div>
              <CtxMenuItem label="Open in OSM" icon="&#x1F5FA;" onClick={() => { window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`, "_blank"); closeCtx(); }} />
              <CtxMenuItem label="Open in Google Maps" icon="&#x1F5FA;" onClick={() => { window.open(`https://www.google.com/maps/@${lat},${lng},15z`, "_blank"); closeCtx(); }} />
              <CtxMenuItem label="Open in Google Earth" icon="&#x1F30C;" onClick={() => { window.open(`https://earth.google.com/web/@${lat},${lng},1000a,300d,35y,0h,0t,0r`, "_blank"); closeCtx(); }} />
              {isEq && <CtxMenuItem label="Open in USGS" icon="&#x1F517;" onClick={() => {
                const usgsId = entId?.replace("eq-", "");
                window.open(`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`, "_blank"); closeCtx();
              }} />}
            </CtxSection>
          </div>
        );
      })()}

      {/* Entity hover tooltip */}
      {hoverTooltip && (
        <div className="wv-hover-tooltip" style={{ left: hoverTooltip.x + 16, top: hoverTooltip.y - 8, zIndex: 150 }}>
          <div dangerouslySetInnerHTML={{ __html: hoverTooltip.html }} />
        </div>
      )}

      {/* Elevation popup */}
      {elevPopup && (
        <div className="wv-elev-popup" style={{ left: elevPopup.x + 16, top: elevPopup.y - 10 }}>
          <div className="val">{elevPopup.elev != null ? `${elevPopup.elev}m` : "No data"}</div>
          <div className="coords">{elevPopup.lat.toFixed(4)}, {elevPopup.lon.toFixed(4)}</div>
        </div>
      )}

      {/* Satellite info panel */}
      {selectedSat && (
        <div className="wv-sat-info">
          <button className="sat-close" onClick={() => { setSelectedSat(null); setFollowSat(false); (window as any).__ozSetFollowEntity?.(null); }}>&times;</button>
          <div className="sat-name">{selectedSat.name}</div>
          <div className="sat-row"><span className="sat-label">Altitude</span><span className="sat-val">{selectedSat.alt.toLocaleString()} km</span></div>
          <div className="sat-row"><span className="sat-label">Velocity</span><span className="sat-val">{selectedSat.vel} km/s</span></div>
          <div className="sat-row"><span className="sat-label">Orbit</span><span className="sat-val">{selectedSat.orbit}</span></div>
          <div className="sat-row"><span className="sat-label">Position</span><span className="sat-val">{selectedSat.lat}, {selectedSat.lon}</span></div>
          <button
            className="wv-btn"
            style={{ marginTop: 4, padding: "4px 10px", fontSize: 10, width: "100%", background: followSat ? "var(--accent)" : "var(--bg-hover)", border: "1px solid var(--border)" }}
            onClick={() => {
              if (followSat) {
                setFollowSat(false);
                (window as any).__ozSetFollowEntity?.(null);
                viewerRef.current?.camera.lookAtTransform(cesiumRef.current?.Matrix4.IDENTITY);
              } else {
                setFollowSat(true);
                const viewer = viewerRef.current;
                if (viewer) {
                  const Cesium = cesiumRef.current;
                  const found = viewer.entities.values.find((e: any) => e.properties?.type?.getValue() === "orbitalTrack" && (e.name?.includes(selectedSat.name) || e.properties?.group?.getValue() === selectedSat.name));
                  (window as any).__ozSetFollowEntity?.(found || null);
                }
              }
            }}
          >
            {followSat ? "Stop Following" : "Follow"}
          </button>
        </div>
      )}

      {/* Status bar */}
      <div className="wv-status">
        {dataStatus.map((ds) => {
          const isActive = state.layers[ds.key as keyof LayerState];
          const indicatorClass = ds.error ? "err" : ds.lastUpdate ? "ok" : isActive ? "loading" : "off";
          return (
            <div key={ds.key} className="wv-status-item">
              <span className={`indicator ${isActive ? indicatorClass : "off"}`} />
              <span>{ds.label}</span>
              {isActive && ds.count > 0 && <span style={{ color: "#555" }}>({ds.count})</span>}
              {isActive && ds.lastUpdate && <span style={{ color: "#444" }}>{fmtTime(ds.lastUpdate)}</span>}
            </div>
          );
        })}
        <span className="wv-status-sep" />
        <span className="wv-coords">{cursorPos ? `${cursorPos[0]}, ${cursorPos[1]}` : "--"}</span>
        <span className="wv-status-sep" />
        <span className="wv-coords" style={{ color: isSpaceMode ? "var(--accent)" : "var(--text-muted)" }}>
          {isSpaceMode ? `${(cameraAlt / 1000).toFixed(0)} km` : cameraAlt > 1000 ? `${(cameraAlt / 1000).toFixed(1)} km` : `${cameraAlt.toFixed(0)} m`}
        </span>
      </div>
    </div>
  );
}
