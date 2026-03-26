"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { LAYERS } from "@/lib/layers/registry";
import { Navbar } from "@/components/Navbar";

/* ─── Registry lookup ─── */
const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/* ─── Imports from extracted modules ─── */
import type { LayerState, DashboardState, DataStatus } from "./lib/types";
import {
  SIDEBAR_SECTIONS, BASEMAPS, DEFAULT_LAYERS, DEFAULT_STATE, THEMES,
} from "./lib/constants";
import {
  parseHash, buildHash, fmtTime, safeCopy, elevationColor,
  removeEntities as removeEntitiesHelper, toggleImageryOverlay as toggleImageryOverlayHelper,
  switchBasemapOnViewer,
} from "./lib/helpers";
import { STYLES } from "./lib/styles";
import { loadEarthquakes } from "./lib/layers/earthquakes";
import { loadRadar } from "./lib/layers/radar";
import { loadFlights } from "./lib/layers/flights";
import { loadMilitaryFlights } from "./lib/layers/military";
import { loadVessels, cleanupVessels } from "./lib/layers/vessels";
import { loadWarnings } from "./lib/layers/warnings";
import { loadEvents } from "./lib/layers/events";
import { loadSatellites } from "./lib/layers/satellites";
import { loadHurricanes } from "./lib/layers/hurricanes";
import { loadNlnogNodes } from "./lib/layers/nlnog";
import { loadFlightArcs } from "./lib/layers/flight-arcs";
import { loadOrbitalTracks } from "./lib/layers/orbital-tracks";
import { loadGroundTracks } from "./lib/layers/ground-tracks";
import { loadElevationColor } from "./lib/layers/elevation";
import { initCesiumViewer } from "./lib/cesium-init";

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export default function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const dataLoadedRef = useRef<Record<string, boolean>>({});
  const entitiesRef = useRef<Record<string, any>>({});
  const satDataRef = useRef<any[]>([]);

  const [state, setState] = useState<DashboardState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("globe-theme"); } catch { /* tracking prevention */ }
    const clean: Partial<DashboardState> = {};
    const parsed = parseHash(window.location.hash);
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) (clean as any)[k] = v;
    }
    return {
      ...DEFAULT_STATE,
      ...clean,
      layers: { ...DEFAULT_LAYERS, ...(parsed.layers || {}) },
      theme: parsed.theme || savedTheme || DEFAULT_STATE.theme,
    };
  });
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ basemaps: true, overlays: true, realtime: true, infrastructure: false, tools: false, theme: false });
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
  ]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number; elev?: number | null } | null>(null);
  const [elevPopup, setElevPopup] = useState<{ x: number; y: number; elev: number | null; lat: number; lon: number } | null>(null);
  const [clock, setClock] = useState("");
  const [bgpPrefix, setBgpPrefix] = useState("");
  const [bgpResult, setBgpResult] = useState<string | null>(null);
  const [bgpLoading, setBgpLoading] = useState(false);
  const [compassHeading, setCompassHeading] = useState(0);
  const [cameraAlt, setCameraAlt] = useState(0);
  const [isSpaceMode, setIsSpaceMode] = useState(false);
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

  const toggleImageryOverlay = useCallback((name: string, url?: string, opacity?: number) => {
    if (viewerRef.current) toggleImageryOverlayHelper(viewerRef.current, cesiumRef.current, name, url, opacity);
  }, []);

  // ─── Init Cesium Viewer ───
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    const container = containerRef.current;
    (async () => {
      const { viewer, Cesium } = await initCesiumViewer(container!, state);
      if (destroyed) { viewer.destroy(); return; }

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          setCursorPos([+Cesium.Math.toDegrees(cg.longitude).toFixed(4), +Cesium.Math.toDegrees(cg.latitude).toFixed(4)]);
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
          setCtxMenu({ x: click.position.x, y: click.position.y, lng, lat });
          fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
            .then((r) => r.json())
            .then((d) => setElevPopup({ x: click.position.x, y: click.position.y, elev: d.elevation, lat, lon: lng }))
            .catch(() => {});
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction((click: any) => setCtxMenu(null), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
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
      setLoading(false);

      // Track camera heading, altitude, space mode, atmosphere fading, and follow mode
      let followEntity: any = null;
      const preRenderListener = () => {
        const cg = viewer.camera.positionCartographic;
        if (cg) {
          const heightM = cg.height;
          setCameraAlt(heightM);
          setIsSpaceMode(heightM > 100000);
          const heading = Cesium.Math.toDegrees(viewer.camera.heading);
          setCompassHeading(-heading);

          const sa = viewer.scene.skyAtmosphere;
          if (heightM < 10000) {
            sa.brightnessShift = 0;
          } else if (heightM < 200000) {
            sa.brightnessShift = -0.7 * ((heightM - 10000) / 190000);
          } else {
            sa.brightnessShift = -0.7;
          }

          if (viewer.scene.globe.showGroundAtmosphere) {
            viewer.scene.globe.showGroundAtmosphere = heightM < 500000;
          }
        }

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
      };

      (window as any).__ozSetFollowEntity = (entity: any | null) => { followEntity = entity; };
      viewer.scene.preRender.addEventListener(preRenderListener);
    })();

    return () => {
      destroyed = true;
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
    if (viewerRef.current) switchBasemapOnViewer(viewerRef.current, key);
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

  const flyToISS = useCallback(async () => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const satJs = (window as any).satellite;
    if (!Cesium || !viewer || !satJs) return;
    try {
      const r = await fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json");
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
          if (on && !dataLoadedRef.current.radar) loadRadar(viewer, Cesium, updateStatus, toggleImageryOverlay, intervalsRef, state.layers);
          if (!on) removeEntities("radar-"); break;
        case "flights":
          if (on && !dataLoadedRef.current.flights) loadFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("flight-"); break;
        case "militaryFlights":
          if (on && !dataLoadedRef.current.militaryFlights) loadMilitaryFlights(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("mil-"); break;
        case "vessels":
          if (on && !dataLoadedRef.current.vessels) loadVessels(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) { removeEntities("vessel-"); cleanupVessels(); } break;
        case "warnings":
          if (on && !dataLoadedRef.current.warnings) loadWarnings(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("warn-"); break;
        case "events":
          if (on && !dataLoadedRef.current.events) loadEvents(viewer, Cesium, updateStatus, removeEntities, intervalsRef, state.layers);
          if (!on) removeEntities("event-"); break;
        case "satellites":
          if (on && !dataLoadedRef.current.satellites) loadSatellites(viewer, Cesium, updateStatus, removeEntities, intervalsRef, entitiesRef, satDataRef, state.layers);
          if (!on) removeEntities("sat-"); break;
        case "hurricaneTracks":
          if (on && !dataLoadedRef.current.hurricaneTracks) loadHurricanes(viewer, Cesium, updateStatus);
          if (!on) removeEntities("storm-"); break;
        case "satellite":
          if (on) toggleImageryOverlay("nasa-gibs",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.3.0&LAYER=MODIS_Terra_CorrectedReflectance_TrueColor&TILEMATRIXSET=GoogleMapsCompatible&TILECOL={z}&TILEROW={y}&TILEMATRIX={z}&FORMAT=image%2Fpng",
            0.7
          );
          else toggleImageryOverlay("nasa-gibs"); break;
        case "blueMarble":
          if (on) toggleImageryOverlay("BlueMarble_ShadedRelief",
            "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/BlueMarble_ShadedRelief/default/{z}/{y}/{x}.jpg",
            0.85
          );
          else toggleImageryOverlay("BlueMarble_ShadedRelief"); break;
        case "nightLights":
          if (on) toggleImageryOverlay("VIIRS_CityLights",
            "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/{z}/{y}/{x}.jpg",
            1.0
          );
          else toggleImageryOverlay("VIIRS_CityLights"); break;
        case "nlnogNodes":
          if (on && !dataLoadedRef.current.nlnogNodes) loadNlnogNodes(viewer, Cesium, updateStatus);
          if (!on) removeEntities("nlnog-"); break;
        case "flightArcs":
          if (on && !dataLoadedRef.current.flightArcs) loadFlightArcs(viewer, Cesium, updateStatus);
          if (!on) removeEntities("arc-"); break;
        case "hillshade":
          break;
        case "elevationColor":
          if (!on) removeEntities("elev-");
          break;
        case "orbitalTracks":
          if (on && !dataLoadedRef.current.orbitalTracks) loadOrbitalTracks(viewer, Cesium, updateStatus);
          if (!on) removeEntities("orbit-"); break;
        case "groundTracks":
          if (on && !dataLoadedRef.current.groundTracks) loadGroundTracks(viewer, Cesium);
          if (!on) removeEntities("gtrack-"); break;
      }
      return next;
    });
  }, []);

  // ─── Section/theme toggles ───
  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const switchTheme = useCallback((key: string) => {
    setState((prev) => ({ ...prev, theme: key }));
    setThemeDropdownOpen(false);
  }, []);

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

      <div ref={containerRef} className="wv-map" />

      {/* Compass */}
      <div className="wv-compass" onClick={compassNorth} title="Reset north">
        <div className="wv-compass-inner" style={{ transform: `rotate(${compassHeading.toFixed(1)}deg)` }}>
          <div className="wv-compass-n">N</div>
          <div className="wv-compass-needle" />
          <div className="wv-compass-s">S</div>
        </div>
      </div>

      {/* Space mode badge */}
      <div className={`wv-space-badge ${isSpaceMode ? "visible" : ""}`}>
        {isSpaceMode && cameraAlt > 1000000 ? "DEEP SPACE" : isSpaceMode ? "LOW EARTH ORBIT" : ""}
        {" "}{cameraAlt > 1000 ? `${(cameraAlt / 1000).toFixed(0)} km` : `${cameraAlt.toFixed(0)} m`} ALT
      </div>

      {/* Zoom controls */}
      <div className="wv-zoom-controls">
        <button className="wv-zoom-btn" onClick={zoomIn} title="Zoom in">+</button>
        <button className="wv-zoom-btn" onClick={zoomOut} title="Zoom out">&minus;</button>
        <button className="wv-zoom-btn" onClick={resetView} title="Reset view" style={{ fontSize: "12px" }}>&#8962;</button>
        <button className="wv-zoom-btn" onClick={flyToISS} title="Fly to ISS" style={{ fontSize: "10px", color: "var(--accent)" }}>&#9741;</button>
      </div>

      {/* Orbital altitude presets */}
      <div className="wv-orbit-presets">
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(408, "ISS")}>ISS<span className="alt">408 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(2000, "LEO")}>LEO<span className="alt">2,000 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(20200, "MEO")}>MEO<span className="alt">20,200 km</span></button>
        <button className="wv-orbit-btn" onClick={() => flyToOrbit(35786, "GEO")}>GEO<span className="alt">35,786 km</span></button>
      </div>

      {/* Sidebar */}
      <div className={`wv-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="wv-sidebar-header">
          <h2 className={isHud ? "wv-glow" : ""}>{isHud ? "◆ " : ""}GLOBE</h2>
          <p>{isHud ? "GEOINT ANALYSIS TERMINAL" : "Real-Time Geospatial Intelligence"}</p>
        </div>

        {/* Basemaps */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.basemaps ? "open" : ""}`} onClick={() => toggleSection("basemaps")}>
            <span>Basemaps</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.basemaps ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(BASEMAPS).map(([k, v]) => (
                <button key={k} className={`wv-bm-btn ${state.basemap === k ? "active" : ""}`} onClick={() => switchBasemap(k)}>{v.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic layer sections from registry */}
        {SIDEBAR_SECTIONS.map((section) => (
          <div className="wv-section" key={section.key}>
            <div className={`wv-section-header ${openSections[section.key as keyof typeof openSections] ? "open" : ""}`} onClick={() => toggleSection(section.key as any)}>
              <span>{section.title}</span><span className="arrow">&#9654;</span>
            </div>
            <div className={`wv-section-body ${openSections[section.key as keyof typeof openSections] ? "open" : ""}`}>
              {section.layerIds.map((layerId) => {
                const layer = LAYER_MAP[layerId];
                const checked = (state.layers as unknown as Record<string, boolean>)[layerId] ?? false;
                return (
                  <div className="wv-row" key={layerId}>
                    <label>
                      <span className="dot" style={{ background: layer?.accent || "var(--accent)" }} />
                      {layer?.name || layerId}
                    </label>
                    <input type="checkbox" checked={checked} onChange={() => toggleLayer(layerId as any)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Tools */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.tools ? "open" : ""}`} onClick={() => toggleSection("tools")}>
            <span>Tools</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.tools ? "open" : ""}`}>
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Click globe for elevation query</label></div>
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Right-click for coordinates</label></div>
            <div className="wv-row">
              <label style={{ color: "#38bdf8", fontSize: "11px" }}>BGP Prefix Lookup</label>
            </div>
            <div className="wv-row" style={{ gap: 4 }}>
              <input
                type="text"
                placeholder="e.g. 8.8.8.0/24"
                value={bgpPrefix}
                onChange={(e) => setBgpPrefix(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setBgpLoading(true); setBgpResult(null); fetch(`/api/bgp?prefix=${encodeURIComponent(bgpPrefix)}`).then(r => r.json()).then(d => { setBgpResult(JSON.stringify(d.data || d.error, null, 2)); setBgpLoading(false); }).catch(() => { setBgpResult("Query failed"); setBgpLoading(false); }); } }}
                style={{ flex: 1, background: "#1a1a1a", border: "1px solid #333", borderRadius: 3, padding: "2px 6px", color: "#ccc", fontSize: "11px", outline: "none" }}
              />
              <button
                onClick={() => { setBgpLoading(true); setBgpResult(null); fetch(`/api/bgp?prefix=${encodeURIComponent(bgpPrefix)}`).then(r => r.json()).then(d => { setBgpResult(JSON.stringify(d.data || d.error, null, 2)); setBgpLoading(false); }).catch(() => { setBgpResult("Query failed"); setBgpLoading(false); }); }}
                disabled={!bgpPrefix || bgpLoading}
                style={{ background: "#333", border: "none", borderRadius: 3, padding: "2px 8px", color: "#ccc", fontSize: "11px", cursor: bgpPrefix ? "pointer" : "default" }}
              >{bgpLoading ? "..." : "Go"}</button>
            </div>
            {bgpResult && (
              <div className="wv-row">
                <pre style={{ color: "#888", fontSize: "10px", fontFamily: "monospace", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{bgpResult}</pre>
              </div>
            )}
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Sources: USGS, RainViewer, NASA, OpenSky, ADSB-X, NOAA, Celestrak, NLNOG</label></div>
          </div>
        </div>

        {/* Theme */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.theme ? "open" : ""}`} onClick={() => toggleSection("theme")}>
            <span>Theme</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.theme ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(THEMES).map(([k, v]) => (
                <button key={k} className={`wv-bm-btn ${state.theme === k ? "active" : ""}`} onClick={() => switchTheme(k)}>{v.icon} {v.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar toggle */}
      <button className="wv-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ left: sidebarOpen ? 260 : 0 }}>
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Close theme dropdown on outside click */}
      {themeDropdownOpen && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setThemeDropdownOpen(false)} />}

      {/* Context menu */}
      {ctxMenu && (
        <div className="wv-ctx-menu" style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, zIndex: 200, background: "var(--bg-solid)", border: "1px solid var(--border-hover)", borderRadius: 6, padding: "4px 0", minWidth: 190, boxShadow: "0 4px 12px rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}>
          <button onClick={() => { safeCopy(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>Copy coordinates</button>
          <button onClick={() => { safeCopy(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>Copy compact</button>
          <button onClick={() => { const toDms = (d: number, pos: string, neg: string) => { const dir = d >= 0 ? pos : neg; const a = Math.abs(d); const deg = Math.floor(a); const min = Math.floor((a - deg) * 60); const sec = ((a - deg - min / 60) * 3600).toFixed(2); return `${deg}\u00b0${min}'${sec}"${dir}`; }; safeCopy(`${toDms(ctxMenu.lat, "N", "S")} ${toDms(ctxMenu.lng, "E", "W")}`); setCtxMenu(null); }}>Copy DMS</button>
          <button onClick={() => { window.open(`https://www.openstreetmap.org/?mlat=${ctxMenu.lat}&mlon=${ctxMenu.lng}#map=17/${ctxMenu.lat}/${ctxMenu.lng}`, "_blank"); setCtxMenu(null); }} style={{ color: "var(--accent)" }}>Open in OSM</button>
          <button onClick={async () => { try { const r = await fetch(`/api/elevation?lat=${ctxMenu.lat.toFixed(6)}&lon=${ctxMenu.lng.toFixed(6)}`); const d = await r.json(); safeCopy(`${d.elevation !== null ? d.elevation + "m" : "No data"} @ ${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); } catch { /* */ } setCtxMenu(null); }} style={{ color: "var(--ok)" }}>Copy elevation</button>
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
