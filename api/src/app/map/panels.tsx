/**
 * Sidebar list panels for the 2D map page: pin history, annotation list,
 * and the share-URL readout. Extracted from map/page.tsx with callback
 * props so the page keeps ownership of map interactions and persistence.
 */
import { SurveillancePanel } from "@/components/SurveillanceUI";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import type { Annotation } from "./lib/layers/annotations";
import type { ElevationPin } from "./lib/view-state";

/** Shared compact-button style; also used by controls that remain in page.tsx. */
export const btnStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 3,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.textMuted,
  cursor: "pointer",
  fontSize: "0.72rem",
  fontFamily: T.fontMono,
};

interface PinHistoryPanelProps {
  pins: ElevationPin[];
  /** Fly the map to the pin and mark it active. */
  onSelect: (pin: ElevationPin) => void;
}

export function PinHistoryPanel({ pins, onSelect }: PinHistoryPanelProps) {
  return (
    <SurveillancePanel title={`Pins (${pins.length})`} style={{ marginBottom: "0.75rem" }}>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {[...pins]
          .reverse()
          .slice(0, 20)
          .map((p, i) => (
            <div
              key={i}
              onClick={() => {
                onSelect(p);
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.25rem 0",
                borderBottom: `1px solid ${T.border}`,
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: T.fontMono,
              }}
            >
              <span style={{ color: T.green }}>{p.elevation !== null ? `${p.elevation}m` : "---"}</span>
              <span style={{ color: T.textMuted }}>
                {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
              </span>
            </div>
          ))}
      </div>
    </SurveillancePanel>
  );
}

interface AnnotationsListPanelProps {
  annotations: Annotation[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function AnnotationsListPanel({ annotations, onDelete, onClear }: AnnotationsListPanelProps) {
  return (
    <SurveillancePanel title={`Annotations (${annotations.length})`} style={{ marginBottom: "0.75rem" }}>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {annotations.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "2px 0",
              borderBottom: `1px solid ${T.border}`,
              fontSize: "0.65rem",
              fontFamily: T.fontMono,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: a.color }}>
                {a.type === "point" ? "◎" : a.type === "line" ? "━" : "△"}
              </span>
              <span style={{ color: T.text }}>{a.name}</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <span style={{ color: T.textMuted, fontSize: "0.58rem" }}>
                {new Date(a.timestamp).toLocaleDateString()}
              </span>
              <button
                onClick={() => { onDelete(a.id); }}
                aria-label={`Delete annotation ${a.name}`}
                style={{
                  background: "none",
                  border: "none",
                  color: T.red,
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  padding: 0,
                  opacity: 0.6,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onClear}
        style={{ ...btnStyle, marginTop: 4, fontSize: "0.6rem", width: "100%" }}
      >
        Clear All Annotations
      </button>
    </SurveillancePanel>
  );
}

export function ShareUrlPanel({ url }: { url: string }) {
  return (
    <SurveillancePanel title="Share">
      <div
        style={{
          background: "rgba(0,0,0,0.3)",
          border: `1px solid ${T.border}`,
          borderRadius: 3,
          padding: "0.35rem 0.5rem",
          fontSize: "0.65rem",
          color: T.textMuted,
          wordBreak: "break-all",
          fontFamily: T.fontMono,
        }}
      >
        {url}
      </div>
    </SurveillancePanel>
  );
}
