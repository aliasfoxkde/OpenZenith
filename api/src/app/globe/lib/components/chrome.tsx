/**
 * Chrome controls for the globe page: the nav-bar view toggle + theme
 * switcher, the compass, the zoom controls, and the orbital altitude
 * presets. Extracted from globe/page.tsx with callback props so the page
 * keeps ownership of viewer state.
 */
import { THEMES } from "../constants";

type ViewMode = "3d" | "2d" | "columbus";

interface ViewToggleProps {
  viewMode: ViewMode;
  onSwitch: (mode: ViewMode) => void;
}

export function ViewToggle({ viewMode, onSwitch }: ViewToggleProps) {
  return (
    <div className="wv-view-toggle">
      {(["3d", "columbus", "2d"] as const).map((mode) => (
        <button
          key={mode}
          className={`wv-view-btn ${viewMode === mode ? "active" : ""}`}
          onClick={() => { onSwitch(mode); }}
        >
          {mode === "3d" ? "3D" : mode === "columbus" ? "CB" : "2D"}
        </button>
      ))}
    </div>
  );
}

interface ThemeSwitcherProps {
  theme: string;
  open: boolean;
  onToggleOpen: () => void;
  onSelect: (key: string) => void;
}

export function ThemeSwitcher({ theme, open, onToggleOpen, onSelect }: ThemeSwitcherProps) {
  return (
    <div className="wv-theme-switcher">
      <button className="wv-theme-btn" onClick={onToggleOpen} title="Change theme">
        {(THEMES as Partial<Record<string, (typeof THEMES)[string]>>)[theme]?.icon ?? THEMES.default.icon}
      </button>
      {open && (
        <div className="wv-theme-dropdown">
          {Object.entries(THEMES).map(([k, v]) => (
            <button key={k} className={`wv-theme-option ${theme === k ? "active" : ""}`} onClick={() => { onSelect(k); }}>
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
  );
}

export function Compass({ heading, onNorth }: { heading: number; onNorth: () => void }) {
  return (
    <button type="button" className="wv-compass" onClick={onNorth} title="Reset north" aria-label="Reset north">
      <div className="wv-compass-inner" style={{ transform: `rotate(${heading.toFixed(1)}deg)` }}>
        <div className="wv-compass-n">N</div>
        <div className="wv-compass-needle" />
        <div className="wv-compass-s">S</div>
      </div>
    </button>
  );
}

interface ZoomControlsProps {
  isFullscreen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFlyISS: () => void;
  onToggleFullscreen: () => void;
}

export function ZoomControls({
  isFullscreen,
  onZoomIn,
  onZoomOut,
  onReset,
  onFlyISS,
  onToggleFullscreen,
}: ZoomControlsProps) {
  return (
    <div className="wv-zoom-controls">
      <button className="wv-zoom-btn" onClick={onZoomIn} title="Zoom in (+)" aria-label="Zoom in">
        +
      </button>
      <button className="wv-zoom-btn" onClick={onZoomOut} title="Zoom out (-)" aria-label="Zoom out">
        &minus;
      </button>
      <button className="wv-zoom-btn" onClick={onReset} title="Reset view (R)" aria-label="Reset view" style={{ fontSize: "12px" }}>
        &#8962;
      </button>
      <button
        className="wv-zoom-btn"
        onClick={onFlyISS}
        title="Fly to ISS"
        aria-label="Fly to ISS"
        style={{ fontSize: "10px", color: "var(--accent)" }}
      >
        &#9741;
      </button>
      <button
        className="wv-zoom-btn"
        onClick={onToggleFullscreen}
        title="Fullscreen (F)"
        aria-label="Toggle fullscreen"
        style={{ fontSize: "12px" }}
      >
        {isFullscreen ? "⧉" : "⛶"}
      </button>
    </div>
  );
}

const ORBIT_PRESETS: { altKm: number; name: string; label: string; alt: string }[] = [
  { altKm: 408, name: "ISS", label: "ISS", alt: "408 km" },
  { altKm: 2000, name: "LEO", label: "LEO", alt: "2,000 km" },
  { altKm: 20200, name: "MEO", label: "MEO", alt: "20,200 km" },
  { altKm: 35786, name: "GEO", label: "GEO", alt: "35,786 km" },
  { altKm: 45000, name: "Moon", label: "Moon", alt: "384,400 km" },
];

export function OrbitPresets({ onFlyToOrbit }: { onFlyToOrbit: (altKm: number, name: string) => void }) {
  return (
    <div className="wv-orbit-presets">
      {ORBIT_PRESETS.map((p) => (
        <button key={p.name} className="wv-orbit-btn" onClick={() => { onFlyToOrbit(p.altKm, p.name); }}>
          {p.label}
          <span className="alt">{p.alt}</span>
        </button>
      ))}
    </div>
  );
}
