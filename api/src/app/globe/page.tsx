/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";

/* ─── Imports from extracted modules ─── */
import type { LayerState, DashboardState, DataStatus } from "./lib/types";
import { DEFAULT_LAYERS, DEFAULT_STATE, THEMES } from "./lib/constants";
import {
  parseHash,
  buildHash,
  fmtTime,
  removeEntities as removeEntitiesHelper,
  toggleImageryOverlay as toggleImageryOverlayHelper,
  switchBasemapOnViewer,
} from "./lib/helpers";
import { STYLES } from "./lib/styles";
import { loadEarthquakes } from "./lib/layers/earthquakes";
import { loadEvents } from "./lib/layers/events";
import { loadElevationColor } from "./lib/layers/elevation";
import { addCoverage, removeCoverage } from "./lib/layers/coverage";
import { initCesiumViewer } from "./lib/cesium-init";
import { applyLOD } from "./lib/lod";

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
import { getClientElevation } from "@/lib/client-elevation";
import { ContextMenu } from "./lib/components/ContextMenu";
import { HudOverlays } from "./lib/components/HudOverlays";

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
  const loadLayerDynamicRef = useRef<(key: string) => Promise<void>>(
    undefined as unknown as (key: string) => Promise<void>,
  );
  const addCloudOverlayRef = useRef<(() => void) | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  // Apply hash/localStorage state on mount (client-only to avoid hydration mismatch)
  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem("globe-theme");
    } catch {
      /* tracking prevention */
    }
    const parsed = parseHash(window.location.hash);
    const clean: Partial<DashboardState> = {};
    // parseHash returns Partial<DashboardState> — spread is safe
    Object.assign(clean, parsed);
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
    { key: "gpsJamming", label: "GPS Jamming", lastUpdate: null, count: 0, error: null },
    { key: "dayNight", label: "Day/Night", lastUpdate: null, count: 0, error: null },
    { key: "coverage", label: "Elevation Coverage", lastUpdate: null, count: 0, error: null },
  ]);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    lng: number;
    lat: number;
    elev?: number | null;
    entity?: any;
  } | null>(null);
  const [elevPopup, setElevPopup] = useState<{
    x: number;
    y: number;
    elev: number | null;
    lat: number;
    lon: number;
  } | null>(null);
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
  const [showCoordPanel, setShowCoordPanel] = useState(true);
  const profileCanvasRef = useRef<HTMLDivElement>(null);
  const [selectedSat, setSelectedSat] = useState<{
    name: string;
    alt: number;
    vel: number;
    lat: number;
    lon: number;
    orbit: string;
  } | null>(null);
  const [followSat, setFollowSat] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

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
    try {
      localStorage.setItem("globe-theme", state.theme);
    } catch {
      /* tracking prevention */
    }
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
    // Trigger a render since requestRenderMode is true — entity changes
    // won't be visible until we explicitly request a frame
    if (viewerRef.current) {
      try { viewerRef.current.scene.requestRender(); } catch {}
    }
  }, []);

  // Shorthand helpers using refs
  const removeEntities = useCallback((prefix: string) => {
    if (viewerRef.current) removeEntitiesHelper(viewerRef.current, prefix, entitiesRef.current);
  }, []);

  const toggleImageryOverlay = useCallback((name: string, url?: string, opacity?: number, maximumLevel?: number) => {
    if (viewerRef.current)
      toggleImageryOverlayHelper(viewerRef.current, cesiumRef.current, name, url, opacity, maximumLevel);
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
          if (activeLayers.includes("earthquakes") && state.layers.earthquakes)
            loadEarthquakes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (activeLayers.includes("events") && state.layers.events)
            loadEvents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          const dynamicKeys = [
            "flights",
            "militaryFlights",
            "vessels",
            "warnings",
            "satellites",
            "radar",
            "hurricaneTracks",
            "nlnogNodes",
            "flightArcs",
            "orbitalTracks",
            "groundTracks",
            "currents",
            "gpsJamming",
            "dayNight",
          ] as const;
          for (const dk of dynamicKeys) {
            if (activeLayers.includes(dk) && state.layers[dk as keyof LayerState]) {
              loadLayerDynamicRef.current?.(dk);
            }
          }
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Document-level handlers (outer scope so cleanup can remove them)
    let handleDocumentContextmenu: ((e: Event) => void) | null = null;
    let handleDocumentClick: ((e: Event) => void) | null = null;

    const container = containerRef.current;
    (async () => {
      let viewer: any = null;
      try {
        const result = await initCesiumViewer(container!, state);
        if (destroyed) {
          result.viewer.destroy();
          return;
        }
        viewer = result.viewer;
        const { Cesium, addCloudOverlay } = result;

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          setCursorPos([
            +Cesium.Math.toDegrees(cg.longitude).toFixed(4),
            +Cesium.Math.toDegrees(cg.latitude).toFixed(4),
          ]);
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
              let orbitType = "Unknown";
              if (altKm < 2000) orbitType = "LEO";
              else if (altKm > 30000) orbitType = "GEO";
              else orbitType = "MEO";
              const velKms = altKm > 30000 ? 3.07 : +(7.66 / Math.sqrt(1 + altKm / 6371)).toFixed(2);
              setSelectedSat({
                name,
                alt: altKm,
                vel: velKms,
                lat: +lat.toFixed(2),
                lon: +lon.toFixed(2),
                orbit: orbitType,
              });
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

          getClientElevation(lat, lng)
            .then((d) =>
              setElevPopup({ x: click.position.x, y: click.position.y, elev: d?.elevation ?? null, lat, lon: lng }),
            )
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
          setCtxMenu({
            x: click.position.x,
            y: click.position.y,
            lng,
            lat,
            entity: entity
              ? { id: entity.id, name: entity.name, type: entityType, properties: entityProps }
              : undefined,
          });
        }
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

      handler.setInputAction((e: any) => {
        setCtxMenu(null);
        // Check for annotation double-click
        const picked = viewer.scene.pick(e.position);
        if (picked?.id?.id?.startsWith("ann-text-")) {
          const annId = picked.id.id;
          setEditingAnnotation({ id: annId, x: e.position.x, y: e.position.y });
        }
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      handleDocumentContextmenu = (e: Event) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) {
          e.preventDefault();
        }
      };
      handleDocumentClick = (e: Event) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) setCtxMenu(null);
      };
      document.addEventListener("contextmenu", handleDocumentContextmenu);
      document.addEventListener("click", handleDocumentClick);

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

      (window as any).__ozSetFollowEntity = (entity: any | null) => {
        followEntity = entity;
      };
      viewer.scene.preRender.addEventListener(preRenderListener);
      } catch(err: any) {
        // Only update state if component is still mounted
        if (!destroyed) {
          console.error("[Globe] Cesium initialization failed:", err);
          setLoading(false);
          // Show error in status
          setDataStatus((prev) =>
            prev.map((d) => (d.key === "earthquakes" ? { ...d, error: "Cesium failed to load" } : d)),
          );
        }
      }
    })();

    return () => {
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (handleDocumentContextmenu) document.removeEventListener("contextmenu", handleDocumentContextmenu);
      if (handleDocumentClick) document.removeEventListener("click", handleDocumentClick);
      intervalsRef.current.forEach(clearInterval);
      layerModulesRef.current.lightning?.cleanupLightning();
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
      case "3d":
        viewer.scene.morphTo3D(1.5);
        break;
      case "2d":
        viewer.scene.morphTo2D(1.5);
        break;
      case "columbus":
        viewer.scene.morphToColumbusView(1.5);
        break;
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
      wrap
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  // ─── Keyboard Bindings ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "+":
        case "=":
          zoomIn();
          break;
        case "-":
        case "_":
          zoomOut();
          break;
        case "r":
        case "R":
          resetView();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          setCtxMenu(null);
          break;
        case "c":
        case "C":
          if (coordFormats) setShowCoordPanel((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, resetView, toggleFullscreen, coordFormats]);

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
    } catch {
      /* ISS position unavailable */
    }
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
  const loadLayerDynamic = useCallback(
    async (key: string) => {
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      if (!Cesium || !viewer || dataLoadedRef.current[key]) return;

      let mod: any;
      switch (key) {
        case "radar":
          mod = layerModulesRef.current.radar ??= await import("./lib/layers/radar");
          break;
        case "flights":
          mod = layerModulesRef.current.flights ??= await import("./lib/layers/flights");
          break;
        case "militaryFlights":
          mod = layerModulesRef.current.militaryFlights ??= await import("./lib/layers/military");
          break;
        case "vessels":
          mod = layerModulesRef.current.vessels ??= await import("./lib/layers/vessels");
          break;
        case "warnings":
          mod = layerModulesRef.current.warnings ??= await import("./lib/layers/warnings");
          break;
        case "satellites":
          mod = layerModulesRef.current.satellites ??= await import("./lib/layers/satellites");
          break;
        case "hurricaneTracks":
          mod = layerModulesRef.current.hurricaneTracks ??= await import("./lib/layers/hurricanes");
          break;
        case "nlnogNodes":
          mod = layerModulesRef.current.nlnogNodes ??= await import("./lib/layers/nlnog");
          break;
        case "flightArcs":
          mod = layerModulesRef.current.flightArcs ??= await import("./lib/layers/flight-arcs");
          break;
        case "orbitalTracks":
          mod = layerModulesRef.current.orbitalTracks ??= await import("./lib/layers/orbital-tracks");
          break;
        case "groundTracks":
          mod = layerModulesRef.current.groundTracks ??= await import("./lib/layers/ground-tracks");
          break;
        case "currents":
          mod = layerModulesRef.current.currents ??= await import("./lib/layers/currents");
          break;
        case "spaceWeather":
          mod = layerModulesRef.current.spaceWeather ??= await import("./lib/layers/space-weather");
          break;
        case "airQuality":
          mod = layerModulesRef.current.airQuality ??= await import("./lib/layers/air-quality");
          break;
        case "aviationWeather":
          mod = layerModulesRef.current.aviationWeather ??= await import("./lib/layers/aviation-weather");
          break;
        case "volcanoes":
          mod = layerModulesRef.current.volcanoes ??= await import("./lib/layers/volcanoes");
          break;
        case "gdacs":
          mod = layerModulesRef.current.gdacs ??= await import("./lib/layers/gdacs");
          break;
        case "marineWeather":
          mod = layerModulesRef.current.marineWeather ??= await import("./lib/layers/marine-weather");
          break;
        case "wildfires":
          mod = layerModulesRef.current.wildfires ??= await import("./lib/layers/wildfires");
          break;
        case "lightning":
          mod = layerModulesRef.current.lightning ??= await import("./lib/layers/lightning");
          break;
        case "gpsJamming":
          mod = layerModulesRef.current.gpsJamming ??= await import("./lib/layers/gps-jamming");
          break;
        case "dayNight":
          mod = layerModulesRef.current.dayNight ??= await import("./lib/layers/day-night");
          break;
      }
      if (!mod) return;

      switch (key) {
        case "radar":
          mod.loadRadar(viewer, Cesium, updateStatus, toggleImageryOverlay, intervalsRef, state.layers);
          break;
        case "flights":
          mod.loadFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "militaryFlights":
          mod.loadMilitaryFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "vessels":
          mod.loadVessels(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "warnings":
          mod.loadWarnings(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "satellites":
          mod.loadSatellites(
            viewer,
            Cesium,
            updateStatus,
            removeEntities,
            intervalsRef,
            entitiesRef,
            satDataRef,
            state.layers,
          );
          break;
        case "hurricaneTracks":
          mod.loadHurricanes(viewer, Cesium, updateStatus);
          break;
        case "nlnogNodes":
          mod.loadNlnogNodes(viewer, Cesium, updateStatus);
          break;
        case "flightArcs":
          mod.loadFlightArcs(viewer, Cesium, updateStatus);
          break;
        case "orbitalTracks":
          mod.loadOrbitalTracks(viewer, Cesium, updateStatus);
          break;
        case "groundTracks":
          mod.loadGroundTracks(viewer, Cesium);
          break;
        case "currents":
          mod.loadCurrents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "spaceWeather":
          mod.loadSpaceWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "airQuality":
          mod.loadAirQuality(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "aviationWeather":
          mod.loadAviationWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "volcanoes":
          mod.loadVolcanoes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "gdacs":
          mod.loadGDACS(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "marineWeather":
          mod.loadMarineWeather(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "wildfires":
          mod.loadWildfires(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "lightning":
          mod.loadLightning(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          break;
        case "gpsJamming":
          mod.loadGpsJamming(viewer, Cesium, updateStatus, removeEntities, intervalsRef, entitiesRef, state.layers);
          break;
        case "dayNight":
          mod.loadDayNightTerminator(viewer, Cesium, updateStatus, removeEntities, intervalsRef, entitiesRef, state.layers);
          break;
      }
      dataLoadedRef.current[key] = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.layers],
  );
  loadLayerDynamicRef.current = loadLayerDynamic;

  // ─── Layer toggling ───
  const toggleLayer = useCallback(
    (key: keyof LayerState) => {
      setState((prev) => {
        const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
        const on = next.layers[key];
        const Cesium = cesiumRef.current;
        const viewer = viewerRef.current;
        if (!Cesium || !viewer) return next;

        switch (key) {
          case "earthquakes":
            if (on && !dataLoadedRef.current.earthquakes)
              loadEarthquakes(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
            if (!on) { removeEntities("eq-"); dataLoadedRef.current.earthquakes = false; }
            break;
          case "radar":
            if (on) loadLayerDynamic("radar");
            if (!on) { removeEntities("radar-"); dataLoadedRef.current.radar = false; }
            break;
          case "flights":
            if (on) loadLayerDynamic("flights");
            if (!on) { removeEntities("flight-"); dataLoadedRef.current.flights = false; }
            break;
          case "militaryFlights":
            if (on) loadLayerDynamic("militaryFlights");
            if (!on) { removeEntities("mil-"); dataLoadedRef.current.militaryFlights = false; }
            break;
          case "vessels":
            if (on) loadLayerDynamic("vessels");
            if (!on) {
              removeEntities("vessel-");
              dataLoadedRef.current.vessels = false;
              const vesselMod = layerModulesRef.current.vessels;
              if (vesselMod) vesselMod.cleanupVessels();
            }
            break;
          case "warnings":
            if (on) loadLayerDynamic("warnings");
            if (!on) { removeEntities("warn-"); dataLoadedRef.current.warnings = false; }
            break;
          case "events":
            if (on && !dataLoadedRef.current.events)
              loadEvents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
            if (!on) { removeEntities("event-"); dataLoadedRef.current.events = false; }
            break;
          case "satellites":
            if (on) loadLayerDynamic("satellites");
            if (!on) { removeEntities("sat-"); dataLoadedRef.current.satellites = false; }
            break;
          case "hurricaneTracks":
            if (on) loadLayerDynamic("hurricaneTracks");
            if (!on) { removeEntities("storm-"); dataLoadedRef.current.hurricaneTracks = false; }
            break;
          case "satellite":
            if (on)
              toggleImageryOverlay(
                "nasa-gibs",
                "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-03-31/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg",
                0.7,
                9,
              );
            else toggleImageryOverlay("nasa-gibs");
            break;
          case "blueMarble":
            if (on)
              toggleImageryOverlay(
                "BlueMarble_ShadedRelief",
                "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
                0.85,
                8,
              );
            else toggleImageryOverlay("BlueMarble_ShadedRelief");
            break;
          case "nightLights":
            if (on)
              toggleImageryOverlay(
                "VIIRS_CityLights",
                "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
                1.0,
              );
            else toggleImageryOverlay("VIIRS_CityLights");
            break;
          case "nlnogNodes":
            if (on) loadLayerDynamic("nlnogNodes");
            if (!on) { removeEntities("nlnog-"); dataLoadedRef.current.nlnogNodes = false; }
            break;
          case "flightArcs":
            if (on) loadLayerDynamic("flightArcs");
            if (!on) { removeEntities("arc-"); dataLoadedRef.current.flightArcs = false; }
            break;
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
            if (!on) { removeEntities("orbit-"); dataLoadedRef.current.orbitalTracks = false; }
            break;
          case "groundTracks":
            if (on) loadLayerDynamic("groundTracks");
            if (!on) { removeEntities("gtrack-"); dataLoadedRef.current.groundTracks = false; }
            break;
          case "currents":
            if (on) loadLayerDynamic("currents");
            if (!on) { removeEntities("current-"); dataLoadedRef.current.currents = false; }
            break;
          case "gpsJamming":
            if (on) loadLayerDynamic("gpsJamming");
            if (!on) { removeEntities("gps-jam-"); dataLoadedRef.current.gpsJamming = false; }
            break;
          case "dayNight":
            if (on) loadLayerDynamic("dayNight");
            if (!on) { removeEntities("day-night"); dataLoadedRef.current.dayNight = false; }
            break;
          case "coverage":
            if (on) {
              addCoverage(viewer, Cesium);
              updateStatus("coverage", { lastUpdate: Date.now(), count: 1, error: null });
            } else {
              removeCoverage(viewer);
              dataLoadedRef.current.coverage = false;
            }
            break;
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadLayerDynamic],
  );

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
  const widgetComponents = useMemo(
    () => ({
      basemaps: BasemapWidget,
      layers: LayersWidget,
      tools: ToolsWidget,
      settings: SettingsWidget,
    }),
    [],
  );

  const { widgets, updateWidget, toggleWidget, resetLayout } = useWidgetManager(widgetComponents);

  const globeContext: GlobeContext = useMemo(
    () => ({
      viewerRef,
      cesiumRef,
      state,
      setState,
      toggleLayer,
      switchBasemap,
      switchTheme,
      switchViewMode,
      activeTool,
      setActiveTool,
      toolManagerRef,
      elevationProfileRef,
      cursorPos,
      dataStatus,
      flyTo,
    }),
    [
      viewerRef,
      cesiumRef,
      state,
      setState,
      toggleLayer,
      switchBasemap,
      switchTheme,
      switchViewMode,
      activeTool,
      setActiveTool,
      toolManagerRef,
      elevationProfileRef,
      cursorPos,
      dataStatus,
      flyTo,
    ],
  );

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
      if (state.layers.earthquakes)
        loadEarthquakes(viewerRef.current, cesiumRef.current, updateStatus, removeEntities, intervalsRef, state.layers);
      if (state.layers.events)
        loadEvents(viewerRef.current, cesiumRef.current, updateStatus, removeEntities, intervalsRef, state.layers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="wv-loading-overlay">
          <div className="spinner" />
        </div>
      )}

      <HudOverlays
        isHud={isHud}
        theme={state.theme}
        clock={clock}
        dataStatus={dataStatus}
        cursorPos={cursorPos}
        state={state}
        selectedSat={selectedSat}
        followSat={followSat}
        setSelectedSat={setSelectedSat}
        setFollowSat={setFollowSat}
        hoverTooltip={hoverTooltip}
        elevPopup={elevPopup}
        lodZone={lodZone}
        cameraAlt={cameraAlt}
        isSpaceMode={isSpaceMode}
        viewerRef={viewerRef}
        cesiumRef={cesiumRef}
      />

      {/* Annotation inline edit */}
      {editingAnnotation && (
        <div
          className="wv-annotation-edit"
          style={{
            position: "absolute",
            left: editingAnnotation.x + 16,
            top: editingAnnotation.y - 10,
            zIndex: 200,
          }}
        >
          <input
            autoFocus
            defaultValue="Double-click to edit"
            className="wv-annotation-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const text = (e.target as HTMLInputElement).value.trim();
                const viewer = viewerRef.current;
                if (viewer && text) {
                  const entity = viewer.entities.getById(editingAnnotation.id);
                  if (entity?.label) {
                    entity.label.text = text;
                  }
                }
                setEditingAnnotation(null);
              } else if (e.key === "Escape") {
                setEditingAnnotation(null);
              }
            }}
            onBlur={(e) => {
              const text = (e.target as HTMLInputElement).value.trim();
              const viewer = viewerRef.current;
              if (viewer && text && text !== "Double-click to edit") {
                const entity = viewer.entities.getById(editingAnnotation.id);
                if (entity?.label) {
                  entity.label.text = text;
                }
              }
              setEditingAnnotation(null);
            }}
          />
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
                <button
                  key={mode}
                  className={`wv-view-btn ${state.viewMode === mode ? "active" : ""}`}
                  onClick={() => switchViewMode(mode)}
                >
                  {mode === "3d" ? "3D" : mode === "columbus" ? "CB" : "2D"}
                </button>
              ))}
            </div>
            {isHud && <span className="wv-nav-time">{clock}</span>}
            <div className="wv-theme-switcher">
              <button
                className="wv-theme-btn"
                onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
                title="Change theme"
              >
                {currentTheme.icon}
              </button>
              {themeDropdownOpen && (
                <div className="wv-theme-dropdown">
                  {Object.entries(THEMES).map(([k, v]) => (
                    <button
                      key={k}
                      className={`wv-theme-option ${state.theme === k ? "active" : ""}`}
                      onClick={() => switchTheme(k)}
                    >
                      <span
                        className="swatch"
                        style={{
                          background:
                            k === "default"
                              ? "#4a9eff"
                              : k === "classified"
                                ? "#00ff41"
                                : k === "amber"
                                  ? "#ffb000"
                                  : k === "arctic"
                                    ? "#00ccff"
                                    : "#ff2222",
                        }}
                      />
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

      {/* Zoom controls */}
      <div className="wv-zoom-controls">
        <button className="wv-zoom-btn" onClick={zoomIn} title="Zoom in (+)" aria-label="Zoom in">
          +
        </button>
        <button className="wv-zoom-btn" onClick={zoomOut} title="Zoom out (-)" aria-label="Zoom out">
          &minus;
        </button>
        <button
          className="wv-zoom-btn"
          onClick={resetView}
          title="Reset view (R)"
          aria-label="Reset view"
          style={{ fontSize: "12px" }}
        >
          &#8962;
        </button>
        <button
          className="wv-zoom-btn"
          onClick={flyToISS}
          title="Fly to ISS"
          aria-label="Fly to ISS"
          style={{ fontSize: "10px", color: "var(--accent)" }}
        >
          &#9741;
        </button>
        <button
          className="wv-zoom-btn"
          onClick={toggleFullscreen}
          title="Fullscreen (F)"
          aria-label="Toggle fullscreen"
          style={{ fontSize: "12px" }}
        >
          {isFullscreen ? "\u29C9" : "\u26F6"}
        </button>
      </div>

      {/* Elevation profile chart */}
      {activeTool === "elevation-profile" && (
        <div className="wv-profile-panel">
          <div className="wv-profile-header">
            <span className="wv-profile-title">Elevation Profile</span>
            <button
              className="wv-profile-close"
              onClick={() => {
                setActiveTool("none");
                elevationProfileRef.current?.clear();
                setProfileData(null);
              }}
            >
              &times;
            </button>
          </div>
          <div ref={profileCanvasRef} className="wv-profile-chart" />
          {!profileData && (
            <div className="wv-profile-hint">Click 2+ points on the globe to create a terrain cross-section</div>
          )}
        </div>
      )}

      {/* Coordinate formats panel */}
      {coordFormats && showCoordPanel && (
        <div className="wv-coord-panel">
          <button className="wv-coord-close" onClick={() => setShowCoordPanel(false)} title="Close (C)">
            &times;
          </button>
          {Object.entries(coordFormats).map(([fmt, val]) => (
            <div key={fmt} className="wv-coord-row">
              <span className="wv-coord-label">{fmt}</span>
              <span
                className="wv-coord-val"
                title="Click to copy"
                onClick={() => {
                  navigator.clipboard.writeText(val);
                }}
              >
                {val}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Orbital altitude presets */}
      <div className="wv-orbit-presets">
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(408, "ISS")}>
          ISS<span className="alt">408 km</span>
        </button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(2000, "LEO")}>
          LEO<span className="alt">2,000 km</span>
        </button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(20200, "MEO")}>
          MEO<span className="alt">20,200 km</span>
        </button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(35786, "GEO")}>
          GEO<span className="alt">35,786 km</span>
        </button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(45000, "Moon")}>
          Moon<span className="alt">384,400 km</span>
        </button>
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
      {themeDropdownOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setThemeDropdownOpen(false)} />
      )}

      {/* Context menu (right-click) */}
      {ctxMenu && (
        <ContextMenu
          ctxMenu={ctxMenu}
          setCtxMenu={setCtxMenu}
          expandedGroup={expandedGroup}
          setExpandedGroup={setExpandedGroup}
          viewerRef={viewerRef}
          cesiumRef={cesiumRef}
          toolManagerRef={toolManagerRef}
          elevationProfileRef={elevationProfileRef}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          setSelectedSat={setSelectedSat}
          setFollowSat={setFollowSat}
          flyToISS={flyToISS}
        />
      )}

      {/* Status bar */}
      <div className="wv-status">
        {dataStatus.map((ds) => {
          const isActive = state.layers[ds.key as keyof LayerState];
          // Only show active layers or layers with errors
          if (!isActive && !ds.error) return null;
          const indicatorClass = ds.error ? "err" : ds.lastUpdate ? "ok" : "loading";
          return (
            <div key={ds.key} className="wv-status-item">
              <span className={`indicator ${indicatorClass}`} />
              <span>{ds.label}</span>
              {ds.error && <span style={{ color: "var(--error, #ff4444)" }}>({ds.error})</span>}
              {isActive && !ds.error && ds.count > 0 && <span style={{ color: "#555" }}>({ds.count})</span>}
              {isActive && !ds.error && ds.lastUpdate && (
                <span style={{ color: "#444" }}>{fmtTime(ds.lastUpdate)}</span>
              )}
            </div>
          );
        })}
        <span className="wv-status-sep" />
        <span className="wv-coords">{cursorPos ? `${cursorPos[0]}, ${cursorPos[1]}` : "--"}</span>
        <span className="wv-status-sep" />
        <span className="wv-coords" style={{ color: isSpaceMode ? "var(--accent)" : "var(--text-muted)" }}>
          {isSpaceMode
            ? `${(cameraAlt / 1000).toFixed(0)} km`
            : cameraAlt > 1000
              ? `${(cameraAlt / 1000).toFixed(1)} km`
              : `${cameraAlt.toFixed(0)} m`}
        </span>
      </div>
    </div>
  );
}
