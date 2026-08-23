"use client";

import { memo, type ReactNode } from "react";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";

/* ─── SurveillancePanel ─────────────────────────────────── */

interface PanelProps {
  children: ReactNode;
  title?: string;
  style?: React.CSSProperties;
}

export const SurveillancePanel = memo(function SurveillancePanel({ children, title, style }: PanelProps) {
  return (
    <div
      role={title ? "region" : undefined}
      aria-label={title}
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        padding: "0.75rem 1rem",
        backdropFilter: "blur(8px)",
        boxShadow: T.glow,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: T.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "0.5rem",
            fontFamily: T.fontMono,
            textShadow: "0 0 6px rgba(0, 229, 255, 0.25)",
          }}
          role="heading"
          aria-level={3}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
});

/* ─── StatusIndicator ───────────────────────────────────── */

interface StatusProps {
  color?: string;
  label?: string;
  pulse?: boolean;
}

export const StatusIndicator = memo(function StatusIndicator({ color = T.green, label, pulse = false }: StatusProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
          animation: pulse ? T.pulse : undefined,
        }}
      />
      {label && (
        <span
          style={{
            fontSize: "0.75rem",
            color: T.textMuted,
            fontFamily: T.fontMono,
            letterSpacing: "0.05em",
            textShadow: "0 0 4px rgba(100, 116, 139, 0.3)",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
});

/* ─── CoordinateReadout ─────────────────────────────────── */

interface CoordProps {
  lat: number;
  lon: number;
  zoom?: number;
}

export const CoordinateReadout = memo(function CoordinateReadout({ lat, lon, zoom }: CoordProps) {
  return (
    <div
      style={{
        fontFamily: T.fontMono,
        fontSize: "0.75rem",
        color: T.accent,
        lineHeight: 1.6,
        letterSpacing: "0.05em",
        textShadow: "0 0 6px rgba(0, 229, 255, 0.3)",
      }}
    >
      <span>LAT {lat.toFixed(5)}</span>
      <span style={{ margin: "0 0.4rem", color: T.textMuted }}>|</span>
      <span>LON {lon.toFixed(5)}</span>
      {zoom !== undefined && (
        <>
          <span style={{ margin: "0 0.4rem", color: T.textMuted }}>|</span>
          <span>Z{zoom.toFixed(1)}</span>
        </>
      )}
    </div>
  );
});

/* ─── LayerToggle ───────────────────────────────────────── */

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  color?: string;
}

export const LayerToggle = memo(function LayerToggle({ label, checked, onChange, color = T.accent }: ToggleProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        padding: "0.2rem 0",
        position: "relative",
      }}
    >
      {/*
        Native checkbox is visually hidden but accessible to screen readers.
        Uses the CSS clip technique (not display:none) so assistive tech can reach it.
      */}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`${label} layer`}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      />
      {/* Visual indicator — styled span synced with native checkbox state */}
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: checked ? color : "transparent",
          border: `1px solid ${checked ? color : T.textMuted}`,
          boxShadow: checked ? `0 0 6px ${color}` : "none",
          flexShrink: 0,
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          fontSize: "0.8rem",
          color: checked ? T.text : T.textMuted,
          fontFamily: T.fontSans,
          userSelect: "none",
        }}
      >
        {label}
      </span>
    </label>
  );
});
