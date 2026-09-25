/**
 * Map toolbar overlays: the measure (ruler/area) toolbar, the annotation
 * draw toolbar, and the live measure readout. Extracted from map/page.tsx
 * with callback props so the page keeps ownership of measure/draw state
 * (refs, keydown effects, and the measure controller).
 */
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import {
  formatArea,
  formatDistance,
  pathDistance,
  sphericalPolygonArea,
  type MeasureMode,
} from "./lib/measure";
import { btnStyle } from "./panels";

/** Annotation drawing modes (hoisted from the page component). */
export type DrawMode = "none" | "point" | "line" | "polygon";

interface MeasureToolsProps {
  mode: MeasureMode;
  onToggleMode: (mode: MeasureMode) => void;
  onClear: () => void;
}

export function MeasureTools({ mode, onToggleMode, onClear }: MeasureToolsProps) {
  return (
    <div style={{ position: "absolute", top: 52, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
      <button
        onClick={() => { onToggleMode("distance"); }}
        title="Measure distance (Esc to cancel)"
        aria-label="Measure distance"
        aria-pressed={mode === "distance"}
        style={{
          background: mode === "distance" ? T.accent : T.panel,
          border: `1px solid ${mode === "distance" ? T.accent : T.border}`,
          borderRadius: 4,
          color: mode === "distance" ? "#0a0f1a" : T.textMuted,
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: "0.72rem",
          fontFamily: T.fontMono,
          backdropFilter: "blur(8px)",
        }}
      >
        RULER
      </button>
      <button
        onClick={() => { onToggleMode("area"); }}
        title="Measure area (Esc to cancel)"
        aria-label="Measure area"
        aria-pressed={mode === "area"}
        style={{
          background: mode === "area" ? T.accent : T.panel,
          border: `1px solid ${mode === "area" ? T.accent : T.border}`,
          borderRadius: 4,
          color: mode === "area" ? "#0a0f1a" : T.textMuted,
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: "0.72rem",
          fontFamily: T.fontMono,
          backdropFilter: "blur(8px)",
        }}
      >
        AREA
      </button>
      {mode !== "none" && (
        <button
          onClick={onClear}
          title="Clear measurement"
          aria-label="Clear measurement"
          style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            color: T.red,
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "0.72rem",
            fontFamily: T.fontMono,
          }}
        >
          CLR
        </button>
      )}
    </div>
  );
}

interface DrawToolsProps {
  mode: DrawMode;
  name: string;
  onSetMode: (mode: DrawMode) => void;
  onNameChange: (name: string) => void;
  onFinish: () => void;
  onCancel: () => void;
}

const DRAW_TOOLS: { mode: Exclude<DrawMode, "none">; glyph: string; title: string; label: string }[] = [
  { mode: "point", glyph: "◎", title: "Draw point annotation", label: "Draw point annotation" },
  { mode: "line", glyph: "━", title: "Draw line annotation (click points, Enter to finish)", label: "Draw line annotation" },
  {
    mode: "polygon",
    glyph: "△",
    title: "Draw polygon annotation (click points, Enter to finish)",
    label: "Draw polygon annotation",
  },
];

export function DrawTools({ mode, name, onSetMode, onNameChange, onFinish, onCancel }: DrawToolsProps) {
  return (
    <div style={{ position: "absolute", top: 82, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
      {DRAW_TOOLS.map((tool) => {
        const active = mode === tool.mode;
        return (
          <button
            key={tool.mode}
            onClick={() => {
              if (mode === tool.mode) {
                onCancel();
              } else {
                onCancel();
                onSetMode(tool.mode);
              }
            }}
            title={tool.title}
            aria-label={tool.label}
            aria-pressed={active}
            style={{
              background: active ? "#00ff88" : T.panel,
              border: `1px solid ${active ? "#00ff88" : T.border}`,
              borderRadius: 4,
              color: active ? "#0a0f1a" : T.textMuted,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              backdropFilter: "blur(8px)",
            }}
          >
            {tool.glyph}
          </button>
        );
      })}
      {mode !== "none" && (
        <>
          <input
            value={name}
            onChange={(e) => { onNameChange(e.target.value); }}
            placeholder="Name..."
            aria-label="Annotation name"
            style={{
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: 3,
              color: T.text,
              padding: "3px 6px",
              fontSize: "0.68rem",
              fontFamily: T.fontMono,
              width: 100,
              outline: "none",
            }}
          />
          <button onClick={onFinish} aria-label="Finish drawing" title="Finish (Enter)" style={{ ...btnStyle, color: "#00ff88" }}>
            ✓
          </button>
          <button onClick={onCancel} aria-label="Cancel drawing" title="Cancel (Esc)" style={{ ...btnStyle, color: T.red }}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}

interface MeasureResultProps {
  mode: MeasureMode;
  points: [number, number][];
}

export function MeasureResult({ mode, points }: MeasureResultProps) {
  if (mode === "none" || points.length < 2) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 86,
        left: 8,
        zIndex: 10,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontFamily: T.fontMono,
        fontSize: "0.75rem",
        color: T.accent,
        backdropFilter: "blur(8px)",
        boxShadow: T.glowSubtle,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div>
        {mode === "distance"
          ? `Distance: ${formatDistance(pathDistance(points))}`
          : `Area: ${formatArea(sphericalPolygonArea(points))}`}
      </div>
      {mode === "distance" && points.length >= 2 && (
        <div style={{ fontSize: "0.65rem", color: T.textMuted }}>Segments: {points.length - 1}</div>
      )}
      <div style={{ fontSize: "0.65rem", color: T.textMuted }}>
        {points.length} point{points.length > 1 ? "s" : ""} | Esc to cancel | Ctrl+Z undo
      </div>
    </div>
  );
}
