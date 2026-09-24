/**
 * Sidebar panels and overlays for the 2D map page: pin history, annotation
 * list, share-URL readout, earthquake timeline, hurricane animation, and
 * the map legend. Extracted from map/page.tsx with callback props so the
 * page keeps ownership of map interactions and persistence.
 */
import { StatusIndicator, SurveillancePanel } from "@/components/SurveillanceUI";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import type { Annotation } from "./lib/layers/annotations";
import type { ElevationPin } from "./lib/view-state";

/** Legend entries rendered as click-to-toggle ramp cards. */
const LEGEND_ENTRIES = [
  {
    id: "bathymetry",
    name: "Bathymetry",
    colors: ["#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#c6dbef"],
    labels: ["Deep", "Shallow"],
    multi: false,
  },
  {
    id: "elevationColor",
    name: "Elevation",
    colors: [
      "#00044a",
      "#08306b",
      "#2171b5",
      "#238b45",
      "#41ab5d",
      "#addd8e",
      "#fee08b",
      "#fdae61",
      "#a50026",
    ],
    labels: ["Sea Level", "Peaks"],
    multi: false,
  },
  {
    id: "elevationAccuracy",
    name: "Data Accuracy",
    colors: ["#00bcd4", "#4caf50", "#1b5e20", "#9acd32", "#1565c0"],
    labels: ["2m", "", "", "", "450m"],
    multi: true,
  },
  {
    id: "oceanCurrents",
    name: "Ocean Currents",
    colors: ["#2878ff", "#328cff", "#00b4ff"],
    labels: ["Flow", "", "Circum."],
    multi: false,
  },
  { id: "equator", name: "Equator", colors: ["#ffffff"], labels: [""], multi: false },
  {
    id: "hillshade",
    name: "Hillshade",
    colors: ["#1a1a1a", "#555555", "#888888", "#b0b0b0", "#d0d0d0"],
    labels: ["Shadow", "Highlight"],
    multi: false,
  },
] as const;

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

interface EarthquakeTimelinePanelProps {
  feed: string;
  playing: boolean;
  timeSlider: number | null;
  range: { min: number; max: number };
  onFeedChange: (feed: string) => void;
  onPlay: () => void;
  onTimeChange: (time: number) => void;
  /** Clear the time filter and refresh the layer. */
  onShowAll: () => void;
}

export function EarthquakeTimelinePanel({
  feed,
  playing,
  timeSlider,
  range,
  onFeedChange,
  onPlay,
  onTimeChange,
  onShowAll,
}: EarthquakeTimelinePanelProps) {
  return (
    <SurveillancePanel title="Earthquake Timeline" style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {["1d", "7d", "30d"].map((f) => (
          <button
            key={f}
            onClick={() => { onFeedChange(f); }}
            style={{
              ...btnStyle,
              flex: 1,
              fontSize: "0.6rem",
              background: feed === f ? T.accent : T.panel,
              color: feed === f ? "#0a0f1a" : T.textMuted,
            }}
          >
            {f === "1d" ? "24H" : f === "7d" ? "7D" : "30D"}
          </button>
        ))}
        <button
          onClick={onPlay}
          aria-label={playing ? "Pause earthquake time animation" : "Play earthquake time animation"}
          style={{ ...btnStyle, fontSize: "0.7rem", color: playing ? T.red : T.green }}
        >
          {playing ? "⏸" : "▶"}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "0.55rem", color: T.textMuted, fontFamily: T.fontMono, minWidth: 60 }}>
          {timeSlider ? new Date(timeSlider).toLocaleDateString() : "All"}
        </span>
        <input
          type="range"
          min={range.min}
          max={range.max}
          value={timeSlider ?? range.max}
          onChange={(e) => { onTimeChange(Number(e.target.value)); }}
          style={{ flex: 1, height: 14, accentColor: T.accent, cursor: "pointer" }}
        />
      </div>
      {timeSlider && (
        <button onClick={onShowAll} style={{ ...btnStyle, fontSize: "0.58rem", marginTop: 4 }}>
          Show All
        </button>
      )}
    </SurveillancePanel>
  );
}

interface HurricaneAnimationPanelProps {
  animating: boolean;
  progress: number;
  onToggle: () => void;
}

export function HurricaneAnimationPanel({ animating, progress, onToggle }: HurricaneAnimationPanelProps) {
  return (
    <SurveillancePanel title="Hurricane Animation" style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={onToggle}
          style={{
            ...btnStyle,
            fontSize: "0.65rem",
            color: animating ? T.red : T.green,
            minWidth: 28,
          }}
          aria-label={animating ? "Pause hurricane animation" : "Play hurricane animation"}
        >
          {animating ? "⏸" : "▶"}
        </button>
        {animating && (
          <>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(progress * 100)}
              readOnly
              style={{ flex: 1, height: 14, accentColor: "#f97316", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.58rem", fontFamily: T.fontMono, color: T.textMuted, minWidth: 30 }}>
              {Math.round(progress * 100)}%
            </span>
          </>
        )}
        {!animating && (
          <span style={{ fontSize: "0.58rem", color: T.textMuted }}>
            Animates active storm track positions over time
          </span>
        )}
      </div>
    </SurveillancePanel>
  );
}

interface MapLegendProps {
  layers: Record<string, boolean>;
  onToggle: (layerId: string, enabled: boolean) => void;
  basemapLabel: string;
}

export function MapLegend({ layers, onToggle, basemapLabel }: MapLegendProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 40,
        left: 12,
        zIndex: 10,
        background: "rgba(10, 15, 26, 0.94)",
        border: "1px solid rgba(0, 229, 255, 0.35)",
        borderRadius: 6,
        padding: "12px 14px",
        width: 220,
        pointerEvents: "auto",
        fontFamily: T.fontMono,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{ fontSize: "0.75rem", color: T.accent, marginBottom: 10, fontWeight: 700, letterSpacing: "0.06em" }}
      >
        LEGEND
      </div>

      {/* Toggleable layer entries — always visible, click to toggle on/off */}
      {LEGEND_ENTRIES.map((layer) => {
        const on = layers[layer.id];
        return (
          <div
            key={layer.id}
            /* Disabled cards no longer dim the whole card with opacity:
               blending #e2e8f0 at 0.35 against the panel measured 2.8:1.
               The state signal moves to the text color instead — both
               states stay above the AAA 7:1 bar on #0a0f1a. */
            style={{ marginBottom: 8, cursor: "pointer" }}
            onClick={() => { onToggle(layer.id, !on); }}
            title={`Click to ${on ? "disable" : "enable"} ${layer.name}`}
          >
            <div
              style={{
                fontSize: "0.62rem",
                color: on ? T.text : T.textMuted, /* 14.8:1 / 7.5:1 */
                marginBottom: 2,
                fontWeight: on ? 600 : 400,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ color: on ? T.accent : T.textMuted, fontSize: "0.55rem" }}>{on ? "●" : "○"}</span>
              {layer.name}
            </div>
            {layer.id !== "equator" && (
              <div style={{ border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ display: "flex", height: 12, opacity: on ? 1 : 0.35 }}>
                  {layer.colors.map((c, i) => (
                    <div key={i} style={{ flex: 1, background: c }} />
                  ))}
                </div>
                {!layer.multi && layer.labels.length === 2 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.5rem",
                      /* Legend text stays undimmed: opacity-blended text
                         measured 2.8:1 on #090d17; T.text = 14.6:1. */
                      color: T.text,
                      padding: "1px 3px",
                      background: "rgba(0,0,0,0.3)",
                    }}
                  >
                    <span>{layer.labels[0]}</span>
                    <span>{layer.labels[1]}</span>
                  </div>
                )}
                {layer.multi && (
                  <div
                    style={{ display: "flex", fontSize: "0.5rem", color: T.text, background: "rgba(0,0,0,0.3)" }}
                  >
                    {layer.labels.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          textAlign: i === 0 ? "left" : i === layer.labels.length - 1 ? "right" : "center",
                          padding: "1px 0",
                        }}
                      >
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Basemap indicator at bottom */}
      <div
        style={{
          marginTop: 6,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 2, background: T.accent, flexShrink: 0 }} />
        <span style={{ fontSize: "0.58rem", color: T.textMuted }}>{basemapLabel}</span>
      </div>
    </div>
  );
}

/** Position and coordinates of an open map context menu. */
export interface ContextMenuState {
  x: number;
  y: number;
  lng: number;
  lat: number;
}

interface MapContextMenuProps {
  menu: ContextMenuState | null;
  /** Close the menu (every action dismisses it). */
  onClose: () => void;
  /** Copy the elevation at the menu's coordinates (async status handled by the page). */
  onCopyElevation: (lat: number, lng: number) => void;
}

function menuItemStyle(color: string): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "6px 12px",
    background: "none",
    border: "none",
    color,
    fontSize: "0.78rem",
    fontFamily: T.fontMono,
    textAlign: "left",
    cursor: "pointer",
  };
}

export function MapContextMenu({ menu, onClose, onCopyElevation }: MapContextMenuProps) {
  if (!menu) return null;
  const toDms = (d: number, pos: string, neg: string) => {
    const dir = d >= 0 ? pos : neg;
    const a = Math.abs(d);
    const deg = Math.floor(a);
    const min = Math.floor((a - deg) * 60);
    const sec = ((a - deg - min / 60) * 3600).toFixed(2);
    return `${deg}°${min}'${sec}"${dir}`;
  };
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    onClose();
  };
  return (
    <div
      className="map-ctx-menu"
      style={{
        position: "absolute",
        top: menu.y,
        left: menu.x,
        zIndex: 30,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        padding: "4px 0",
        minWidth: 180,
        boxShadow: T.glow,
        backdropFilter: "blur(8px)",
      }}
    >
      <button
        onClick={() => {
          copy(`${menu.lat.toFixed(6)}, ${menu.lng.toFixed(6)}`);
        }}
        style={menuItemStyle(T.text)}
      >
        Copy coordinates
      </button>
      <button
        onClick={() => {
          copy(`${menu.lat.toFixed(6)},${menu.lng.toFixed(6)}`);
        }}
        style={menuItemStyle(T.text)}
      >
        Copy compact
      </button>
      <button
        onClick={() => {
          copy(`${toDms(menu.lat, "N", "S")} ${toDms(menu.lng, "E", "W")}`);
        }}
        style={menuItemStyle(T.text)}
      >
        Copy DMS
      </button>
      <button
        onClick={() => {
          copy(`${menu.lng.toFixed(6)},${menu.lat.toFixed(6)}`);
        }}
        style={menuItemStyle(T.text)}
      >
        Copy lng,lat
      </button>
      <button
        onClick={() => {
          copy(`${menu.lng.toFixed(6)}, ${menu.lat.toFixed(6)}`);
        }}
        style={menuItemStyle(T.text)}
      >
        Copy lat,lng
      </button>
      <button
        onClick={() => {
          window.open(
            `https://www.openstreetmap.org/?mlat=${menu.lat}&mlon=${menu.lng}#map=17/${menu.lat}/${menu.lng}`,
            "_blank",
          );
          onClose();
        }}
        style={{ ...menuItemStyle(T.accent), fontSize: "0.8rem" }}
      >
        Open in OSM
      </button>
      <button
        onClick={() => {
          onCopyElevation(menu.lat, menu.lng);
        }}
        style={{ ...menuItemStyle(T.green), fontSize: "0.8rem" }}
      >
        Copy elevation
      </button>
    </div>
  );
}

export type MapHealth = "ok" | "degraded" | "loading" | "error";

interface StatusBarProps {
  mapHealth: MapHealth;
  pinCount: number;
  annotationCount: number;
  drawMode: string;
  onExport: () => void;
}

export function StatusBar({ mapHealth, pinCount, annotationCount, drawMode, onExport }: StatusBarProps) {
  return (
    <div style={{ position: "absolute", bottom: 8, right: 8, zIndex: 10 }}>
      <SurveillancePanel style={{ padding: "0.3rem 0.6rem", display: "flex", gap: 12, alignItems: "center" }}>
        <StatusIndicator
          color={
            mapHealth === "error"
              ? T.red
              : mapHealth === "degraded"
                ? T.amber
                : mapHealth === "loading"
                  ? T.amber
                  : T.green
          }
          label={
            mapHealth === "error"
              ? "ERROR"
              : mapHealth === "degraded"
                ? "DEGRADED"
                : mapHealth === "loading"
                  ? "LOADING"
                  : "READY"
          }
          pulse={mapHealth === "loading"}
        />
        {pinCount > 0 && <StatusIndicator color={T.accent} label={`${pinCount} PINS`} />}
        {annotationCount > 0 && <StatusIndicator color="#00ff88" label={`${annotationCount} ANNOT`} />}
        {drawMode !== "none" && <StatusIndicator color="#00ff88" label={`DRAW: ${drawMode.toUpperCase()}`} />}
        <button
          onClick={onExport}
          title="Export screenshot"
          aria-label="Export map screenshot as PNG"
          style={{
            background: "none",
            border: `1px solid ${T.border}`,
            /* T.textMuted (#94a3b8) only reaches 5.46:1 on the panel
               composite; T.text (#e2e8f0) = 11.37:1 — WCAG AAA. */
            color: T.text,
            padding: "2px 8px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: T.fontMono,
            letterSpacing: "0.05em",
          }}
        >
          EXPORT
        </button>
      </SurveillancePanel>
    </div>
  );
}
