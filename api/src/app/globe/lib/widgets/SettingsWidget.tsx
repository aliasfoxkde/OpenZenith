"use client";

import { useState, useEffect } from "react";
import type { WidgetProps } from "./types";
import { THEMES } from "../constants";

type SectionKey = "ui" | "performance" | "coords" | "theme";

interface Settings {
  showCompass: boolean;
  showStatusBar: boolean;
  showCoordPanel: boolean;
  showOrbitPresets: boolean;
  showZoomControls: boolean;
  entityCap: number;
  contrails: boolean;
  coordFormat: string;
}

const SETTINGS_KEY = "globe-settings";

const DEFAULT_SETTINGS: Settings = {
  showCompass: true,
  showStatusBar: true,
  showCoordPanel: true,
  showOrbitPresets: true,
  showZoomControls: true,
  entityCap: 5000,
  contrails: true,
  coordFormat: "DD",
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* tracking prevention */ }
}

const COORD_FORMATS = [
  { value: "DD", label: "DD (Decimal Degrees)" },
  { value: "DMS", label: "DMS (Degrees Minutes Seconds)" },
  { value: "DDM", label: "DDM (Degrees Decimal Minutes)" },
];

export function SettingsWidget({ globe }: WidgetProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    ui: true, performance: false, coords: false, theme: false,
  });

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  const sectionToggle = (key: SectionKey) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const checkbox = (label: string, key: keyof Settings) => (
    <div className="wv-setting-row">
      <label className="wv-setting-label">{label}</label>
      <input
        type="checkbox"
        checked={settings[key] as boolean}
        onChange={(e) => update(key, e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
    </div>
  );

  return (
    <>
      {/* UI Elements */}
      <div className="wv-section">
        <div className={`wv-section-header ${openSections.ui ? "open" : ""}`} onClick={() => sectionToggle("ui")}>
          <span>UI Elements</span><span className="arrow">&#9654;</span>
        </div>
        <div className={`wv-section-body ${openSections.ui ? "open" : ""}`}>
          {checkbox("Compass", "showCompass")}
          {checkbox("Status Bar", "showStatusBar")}
          {checkbox("Coord Panel", "showCoordPanel")}
          {checkbox("Orbit Presets", "showOrbitPresets")}
          {checkbox("Zoom Controls", "showZoomControls")}
        </div>
      </div>

      {/* Performance */}
      <div className="wv-section">
        <div className={`wv-section-header ${openSections.performance ? "open" : ""}`} onClick={() => sectionToggle("performance")}>
          <span>Performance</span><span className="arrow">&#9654;</span>
        </div>
        <div className={`wv-section-body ${openSections.performance ? "open" : ""}`}>
          <div className="wv-setting-row">
            <label className="wv-setting-label">Entity Cap</label>
            <input
              type="number"
              min={100}
              max={50000}
              step={500}
              value={settings.entityCap}
              onChange={(e) => update("entityCap", Math.max(100, Math.min(50000, +e.target.value || 5000)))}
              style={{
                width: 70,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "2px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
          {checkbox("Flight Contrails", "contrails")}
        </div>
      </div>

      {/* Coordinate Format */}
      <div className="wv-section">
        <div className={`wv-section-header ${openSections.coords ? "open" : ""}`} onClick={() => sectionToggle("coords")}>
          <span>Coordinates</span><span className="arrow">&#9654;</span>
        </div>
        <div className={`wv-section-body ${openSections.coords ? "open" : ""}`}>
          <div className="wv-setting-row">
            <label className="wv-setting-label">Format</label>
            <select
              value={settings.coordFormat}
              onChange={(e) => update("coordFormat", e.target.value)}
              style={{
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "2px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            >
              {COORD_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="wv-section">
        <div className={`wv-section-header ${openSections.theme ? "open" : ""}`} onClick={() => sectionToggle("theme")}>
          <span>Theme</span><span className="arrow">&#9654;</span>
        </div>
        <div className={`wv-section-body ${openSections.theme ? "open" : ""}`}>
          <div className="wv-bm-grid">
            {Object.entries(THEMES).map(([k, v]) => (
              <button
                key={k}
                className={`wv-bm-btn ${globe.state.theme === k ? "active" : ""}`}
                onClick={() => globe.switchTheme(k)}
              >
                {v.icon} {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
