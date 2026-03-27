"use client";

import { useState } from "react";

interface Props {
  dark: boolean;
  onToggleLayer: (id: string, enabled: boolean) => void;
  layers: Record<string, boolean>;
}

export function WeatherTool({ dark, onToggleLayer, layers }: Props) {
  const [autoRefresh, setAutoRefresh] = useState(false);

  const bg = dark ? "#141414" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        Weather data layers from NOAA/NWS. US weather warnings and alerts.
      </div>

      {/* Warnings layer */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          padding: "8px 10px", background: dark ? "#1a1a1a" : "#f5f5f5",
          border: `1px solid ${border}`, borderRadius: 4,
        }}
      >
        <input
          type="checkbox"
          checked={!!layers.weather_warnings}
          onChange={(e) => onToggleLayer("weather_warnings", e.target.checked)}
        />
        <div>
          <div style={{ color: text, fontSize: 12, fontWeight: 600 }}>Weather Warnings</div>
          <div style={{ color: textSec, fontSize: 10 }}>NOAA/NWS active warnings</div>
        </div>
      </label>

      {/* Auto refresh */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          color: textSec, fontSize: 11,
        }}
      >
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.checked)}
        />
        Auto-refresh (2 min)
      </label>

      {/* Info */}
      <div style={{ color: textSec, fontSize: 10, lineHeight: 1.4, padding: "8px 10px", background: dark ? "#1a1a1a" : "#f5f5f5", borderRadius: 4, border: `1px solid ${border}` }}>
        <strong style={{ color: text }}>Data source:</strong> NOAA National Weather Service via ArcGIS.
        Warnings include severe thunderstorms, tornadoes, floods, winter storms, and marine hazards.
        Coverage is US-only.
      </div>
    </div>
  );
}
