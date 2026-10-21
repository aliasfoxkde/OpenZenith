"use client";

import { memo, type ReactNode } from "react";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";

/* ─── SurveillancePanel ─────────────────────────────────── */

interface PanelProps {
  children: ReactNode;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * Translucent glassmorphic panel wrapper used by the surveillance map overlay.
 *
 * `title`, when supplied, is rendered as an `aria-level` 3 heading and the
 * container is promoted to `role="region"` with the title as its accessible
 * name; without a title the panel stays an anonymous container. The optional
 * `style` object is merged last so callers can override the default padding,
 * border, backdrop blur and glow.
 */
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

/**
 * Small colored status dot with an optional text label.
 *
 * The dot is filled with `color` (default: the theme's success green) and
 * carries a matching glow; `pulse` enables the theme's pulse animation on it.
 * `label`, when given, is rendered beside the dot in the theme's primary text
 * color, which clears WCAG AAA against the translucent panel composite.
 */
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
            /* T.textMuted (#94a3b8) measures 5.08:1 on the translucent panel
               composite (#2c313c over the basemap) — below the AAA 7:1 bar.
               T.text (#e2e8f0) = 10.57:1 on that same composite. */
            color: T.text,
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

/**
 * Readout of the current map position in the surveillance overlay.
 *
 * Latitude and longitude are printed in decimal degrees with five decimal
 * places. `zoom`, when provided, is appended as `Z` followed by one decimal
 * place.
 */
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

/**
 * Checkbox row used to switch an individual data layer on or off.
 *
 * The native checkbox stays in the accessibility tree (CSS clip technique, not
 * `display:none`) and carries an `aria-label` of "<label> layer"; the square
 * swatch beside it is `aria-hidden` and mirrors the checkbox state. `onChange`
 * receives the new checked state, and `color` (default: the theme accent)
 * tints the checked swatch and its glow.
 */
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
        onChange={(e) => {
          onChange(e.target.checked);
        }}
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
