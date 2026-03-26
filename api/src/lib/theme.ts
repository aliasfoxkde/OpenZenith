/**
 * Surveillance/monitoring theme constants for Map and Globe UIs.
 */

export const SURVEILLANCE_THEME = {
  /** Deep navy/black background */
  bg: "#0a0f1a",
  /** Slightly lighter panel background */
  panel: "rgba(10, 15, 26, 0.88)",
  /** Panel border with subtle cyan glow */
  border: "rgba(0, 229, 255, 0.2)",
  /** Primary accent — cyan */
  accent: "#00e5ff",
  /** Success/active — green */
  green: "#22c55e",
  /** Warning — amber */
  amber: "#f59e0b",
  /** Error/danger — red */
  red: "#ef4444",
  /** Info — blue */
  blue: "#3b82f6",
  /** Primary text */
  text: "#e2e8f0",
  /** Secondary/muted text */
  textMuted: "#64748b",
  /** Monospace font for data readouts */
  fontMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  /** Sans-serif font for UI labels */
  fontSans: "'Inter', 'Segoe UI', system-ui, sans-serif",
  /** Box shadow with cyan glow */
  glow: "0 0 12px rgba(0, 229, 255, 0.25)",
  /** Subtle glow for hover states */
  glowSubtle: "0 0 6px rgba(0, 229, 255, 0.15)",
  /** Pulse animation for live indicators */
  pulse: "pulse 2s ease-in-out infinite",
  /** Dark basemap URL (CartoDB Dark Matter) */
  basemapDark:
    "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  /** Dark basemap without labels */
  basemapDarkNolabels:
    "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  /** Graticule grid line color */
  graticule: "rgba(0, 229, 255, 0.06)",
} as const;

export type SurveillanceTheme = typeof SURVEILLANCE_THEME;

/** Reusable text style tiers for HUD / pin / readout rendering */
export const TEXT_STYLES = {
  /** Elevation pin main label */
  pinLabel: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textShadow: "0 0 8px rgba(34, 197, 94, 0.4)",
  },
  /** Pin sub-label (coordinates below elevation) */
  pinSublabel: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "9px",
    fontWeight: 400,
    color: "#94a3b8",
    letterSpacing: "0.02em",
  },
  /** HUD readout text */
  hudReadout: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "11px",
    fontWeight: 400,
    letterSpacing: "0.05em",
    textShadow: "0 0 6px rgba(0, 229, 255, 0.3)",
  },
} as const;
