"use client";

import { useState } from "react";

interface Props {
  dark: boolean;
  onDismiss: () => void;
}

const TIPS = [
  {
    icon: "\u26f0",
    title: "Elevation",
    desc: "Click the map to get terrain elevation. Draw a line for a cross-section profile.",
  },
  {
    icon: "\ud83d\udccd",
    title: "Geocode",
    desc: "Search for addresses and places. Results are shown on the map with markers.",
  },
  {
    icon: "\ud83d\uddfa",
    title: "OSM Query",
    desc: "Query OpenStreetMap data in the current view. Use presets or write custom Overpass QL.",
  },
  { icon: "\u26c8", title: "Weather", desc: "Check weather warnings, radar, and forecasts for the map area." },
  {
    icon: "\ud83d\udcc1",
    title: "Data Upload",
    desc: "Drag & drop GeoJSON, CSV, GPX, or KML files. Visualize with choropleth and heatmap styles.",
  },
  {
    icon: "\ud83d\udcda",
    title: "Layers",
    desc: "Toggle data layers like earthquakes, buildings, population density, and more.",
  },
  {
    icon: "\u270f",
    title: "Draw",
    desc: "Draw points, lines, and polygons on the map. Measurements shown in real-time.",
  },
  { icon: "\u2316", title: "Measure", desc: "Distances and areas calculated automatically while drawing." },
];

export function OnboardingOverlay({ dark, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);

  const dismiss = () => {
    setVisible(false);
    onDismiss();
  };

  if (!visible) return null;

  const bg = dark ? "#0a0a0a" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 18, color: text }}>Welcome to Studio</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: textSec }}>
          OpenZenith&apos;s GIS sandbox. Here&apos;s what you can do:
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TIPS.map((tip) => (
            <div
              key={tip.title}
              style={{
                display: "flex",
                gap: 12,
                padding: "8px 0",
                borderBottom: `1px solid ${border}`,
              }}
            >
              <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: "center" }}>{tip.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: text }}>{tip.title}</div>
                <div style={{ fontSize: 12, color: textSec, marginTop: 2 }}>{tip.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={dismiss}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px",
            background: "#3b82f6",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
