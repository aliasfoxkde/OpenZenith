/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

interface HudOverlaysProps {
  isHud: boolean;
  theme: string;
  clock: string;
  dataStatus: Array<{
    key: string;
    label: string;
    lastUpdate: number | null;
    count: number;
    error: string | null;
  }>;
  cursorPos: [number, number] | null;
  state: { zoom: number; viewMode: string };
  selectedSat: {
    name: string;
    alt: number;
    vel: number;
    lat: number;
    lon: number;
    orbit: string;
  } | null;
  followSat: boolean;
  setSelectedSat: (s: any) => void;
  setFollowSat: (f: boolean) => void;
  hoverTooltip: { x: number; y: number; html: string } | null;
  elevPopup: { x: number; y: number; elev: number | null; lat: number; lon: number } | null;
  lodZone: string;
  cameraAlt: number;
  isSpaceMode: boolean;
  viewerRef: React.RefObject<any>;
  cesiumRef: React.RefObject<any>;
}

export function HudOverlays({
  isHud,
  theme,
  clock,
  dataStatus,
  cursorPos,
  state,
  selectedSat,
  followSat,
  setSelectedSat,
  setFollowSat,
  hoverTooltip,
  elevPopup,
  lodZone,
  cameraAlt,
  isSpaceMode,
  viewerRef,
  cesiumRef,
}: HudOverlaysProps) {
  return (
    <>
      {/* Scanlines, grid, HUD corners */}
      <div className="wv-scanlines" />
      <div className="wv-grid-overlay" />
      <div className="wv-hud-corners">
        <div className="wv-hud-inner" />
      </div>

      {/* Classification banner */}
      {isHud && (
        <div className="wv-classification">
          {theme === "classified" ? "TOP SECRET // SCI" : "RESTRICTED // OPERATIONAL"}
          <span className="wv-blink" style={{ marginLeft: 12, fontSize: 9, opacity: 0.5 }}>
            ●
          </span>
        </div>
      )}

      {/* Ticker bar */}
      {isHud && (
        <div className="wv-ticker">
          <div className="wv-ticker-inner">
            SIGINT FEED ACTIVE ◆ GEOSPATIAL INTEL COLLECTION IN PROGRESS ◆ ALL SOURCES NOMINAL ◆
            {dataStatus
              .filter((d) => d.lastUpdate)
              .map((d) => `${d.label.toUpperCase()}: ${d.count} OBJECTS`)
              .join(" ◆ ")}{" "}
            ◆ LAT {cursorPos ? cursorPos[1] : "----"} LON {cursorPos ? cursorPos[0] : "----"} ◆ ZOOM{" "}
            {state.zoom.toFixed(1)} ◆ VIEW {state.viewMode.toUpperCase()} ◆ {clock}
          </div>
        </div>
      )}

      {/* Space badge / LOD indicator */}
      <div className={`wv-space-badge ${isSpaceMode ? "visible" : ""}`}>
        {lodZone} {cameraAlt > 1000 ? `${(cameraAlt / 1000).toFixed(0)} km` : `${cameraAlt.toFixed(0)} m`} ALT
      </div>

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
          <div className="coords">
            {elevPopup.lat.toFixed(4)}, {elevPopup.lon.toFixed(4)}
          </div>
        </div>
      )}

      {/* Satellite info panel */}
      {selectedSat && (
        <div className="wv-sat-info">
          <button
            className="sat-close"
            onClick={() => {
              setSelectedSat(null);
              setFollowSat(false);
              (window as any).__ozSetFollowEntity?.(null);
            }}
          >
            &times;
          </button>
          <div className="sat-name">{selectedSat.name}</div>
          <div className="sat-row">
            <span className="sat-label">Altitude</span>
            <span className="sat-val">{selectedSat.alt.toLocaleString()} km</span>
          </div>
          <div className="sat-row">
            <span className="sat-label">Velocity</span>
            <span className="sat-val">{selectedSat.vel} km/s</span>
          </div>
          <div className="sat-row">
            <span className="sat-label">Orbit</span>
            <span className="sat-val">{selectedSat.orbit}</span>
          </div>
          <div className="sat-row">
            <span className="sat-label">Position</span>
            <span className="sat-val">
              {selectedSat.lat}, {selectedSat.lon}
            </span>
          </div>
          <button
            className="wv-btn"
            style={{
              marginTop: 4,
              padding: "4px 10px",
              fontSize: 10,
              width: "100%",
              background: followSat ? "var(--accent)" : "var(--bg-hover)",
              border: "1px solid var(--border)",
            }}
            onClick={() => {
              if (followSat) {
                setFollowSat(false);
                (window as any).__ozSetFollowEntity?.(null);
                viewerRef.current?.camera.lookAtTransform(cesiumRef.current?.Matrix4.IDENTITY);
              } else {
                setFollowSat(true);
                const viewer = viewerRef.current;
                if (viewer) {
                  const found = viewer.entities.values.find(
                    (e: any) =>
                      e.properties?.type?.getValue() === "orbitalTrack" &&
                      (e.name?.includes(selectedSat.name) || e.properties?.group?.getValue() === selectedSat.name),
                  );
                  (window as any).__ozSetFollowEntity?.(found || null);
                }
              }
            }}
          >
            {followSat ? "Stop Following" : "Follow"}
          </button>
        </div>
      )}
    </>
  );
}
