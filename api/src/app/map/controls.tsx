/**
 * Sidebar controls for the 2D map page: basemap selector (with the OS-theme
 * match row) and the layer toggle accordion. Extracted from map/page.tsx
 * with callback props so the page keeps ownership of map state changes.
 */
import { LayerToggle, SurveillancePanel } from "@/components/SurveillanceUI";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";
import { BASEMAPS, BASEMAP_ORDER } from "@/lib/basemaps";
import { LAYERS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/layers/registry";
import { MAP_2D_LAYER_IDS } from "./lib/layers";

/** Per-layer load report recorded by the layer handle callback. */
export interface LayerStatusEntry {
  status: string;
  count?: number;
}

/** Layers whose accordion row exposes an opacity slider. */
const RASTER_LAYERS = new Set([
  "hillshade",
  "elevationColor",
  "elevationAccuracy",
  "contours",
  "bathymetry",
  "radar",
  "sentinel2",
  "nightLights",
  "marineWeather",
  "populationDensity",
  "landCover",
  "seaIce",
  "satellite",
  "floods",
  "fireTemperature",
  "sarBackscatter",
]);

interface BasemapSelectorProps {
  current: string;
  onSelect: (key: string) => void;
  /** Switch the basemap to match the OS color scheme. */
  onMatchOsTheme: () => void;
}

export function BasemapSelector({ current, onSelect, onMatchOsTheme }: BasemapSelectorProps) {
  return (
    <>
      {/* Basemap selector */}
      <SurveillancePanel title="Basemap" style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {BASEMAP_ORDER.map((key) => {
            const bm = BASEMAPS[key];
            return (
              <button
                key={key}
                onClick={() => { onSelect(key); }}
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: 3,
                  border: current === key ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
                  background: current === key ? `${T.accent}22` : "transparent",
                  color: current === key ? T.accent : T.textMuted,
                  cursor: "pointer",
                  fontSize: "0.72rem",
                  fontFamily: T.fontMono,
                  boxShadow: current === key ? `0 0 6px ${T.accent}33` : "none",
                }}
              >
                {bm.label}
              </button>
            );
          })}
        </div>
      </SurveillancePanel>

      {/* System theme toggle — switches basemap between dark/voyager */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
          padding: "0.35rem 0",
        }}
      >
        <span style={{ fontSize: "0.72rem", color: T.textMuted, fontFamily: T.fontMono }}>AUTO THEME</span>
        <button
          onClick={onMatchOsTheme}
          title="Switch basemap to match your OS theme"
          style={{
            padding: "0.2rem 0.5rem",
            borderRadius: 3,
            border: `1px solid ${T.border}`,
            background: "transparent",
            color: T.accent,
            cursor: "pointer",
            fontSize: "0.68rem",
            fontFamily: T.fontMono,
          }}
        >
          ⚙ Match OS
        </button>
      </div>
    </>
  );
}

interface LayerControlsProps {
  layers: Record<string, boolean>;
  layerStatus: Record<string, LayerStatusEntry | undefined>;
  layerOpacity: Record<string, number>;
  expandedCategory: string | null;
  onToggle: (layerId: string, enabled: boolean) => void;
  /** Set a raster layer's opacity (10-100). */
  onOpacity: (layerId: string, value: number) => void;
  onExpandCategory: (category: string | null) => void;
}

export function LayerControls({
  layers,
  layerStatus,
  layerOpacity,
  expandedCategory,
  onToggle,
  onOpacity,
  onExpandCategory,
}: LayerControlsProps) {
  return (
    <>
      {/* Hillshade — always visible at the top, no accordion */}
      {LAYERS.filter((l) => l.id === "hillshade").map((layer) => (
        <div key={layer.id} style={{ padding: "0.3rem 0.35rem", borderBottom: "1px solid rgba(0,229,255,0.15)" }}>
          <LayerToggle
            label={layer.name}
            checked={layers[layer.id]}
            onChange={(checked) => { onToggle(layer.id, checked); }}
            color={layer.accent}
          />
          <div style={{ color: T.textMuted, fontSize: "0.6rem", marginLeft: 18, marginTop: -2 }}>
            {layer.description}
          </div>
        </div>
      ))}
      {/* Layer toggles — accordion groups */}
      {CATEGORY_ORDER.map((cat) => {
        if (cat === "hillshade") return null;
        const catLayers = LAYERS.filter(
          (l) =>
            l.category === cat &&
            (MAP_2D_LAYER_IDS.has(l.id) || ["hillshade", "terrain3d", "boundaries", "contour"].includes(l.id)),
        );
        if (catLayers.length === 0) return null;
        const isOpen = expandedCategory === cat;
        const enabledCount = catLayers.filter((l) => layers[l.id]).length;
        return (
          <div key={cat} style={{ marginBottom: "0.4rem" }}>
            <button
              onClick={() => { onExpandCategory(isOpen ? null : cat); }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.45rem 0.5rem",
                background: isOpen ? `rgba(0, 229, 255, 0.08)` : "transparent",
                border: `1px solid ${isOpen ? T.border : "transparent"}`,
                borderRadius: 4,
                color: T.text,
                fontSize: "0.7rem",
                fontFamily: T.fontMono,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
            >
              <span>{CATEGORY_LABELS[cat] || cat}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {enabledCount > 0 && (
                  <span style={{ fontSize: "0.58rem", color: T.green, fontFamily: T.fontMono }}>
                    {enabledCount}/{catLayers.length}
                  </span>
                )}
                <span style={{ fontSize: "0.6rem", color: T.textMuted }}>{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "0.25rem 0.15rem" }}>
                {catLayers.map((layer) => {
                  const status = layerStatus[layer.id];
                  return (
                    <div
                      key={layer.id}
                      style={{
                        padding: "0.3rem 0.35rem",
                        borderBottom: `1px solid rgba(0,229,255,0.08)`,
                      }}
                    >
                      <LayerToggle
                        label={layer.name}
                        checked={layers[layer.id]}
                        onChange={(checked) => { onToggle(layer.id, checked); }}
                        color={layer.accent}
                      />
                      <div style={{ color: T.textMuted, fontSize: "0.6rem", marginLeft: 18, marginTop: -2 }}>
                        {layer.description}
                        {layers[layer.id] && status && (
                          <span
                            aria-live="polite"
                            aria-label={`${layer.name} status: ${status.status}`}
                            style={{
                              marginLeft: 6,
                              padding: "0 3px",
                              borderRadius: 2,
                              fontSize: "0.55rem",
                              fontFamily: T.fontMono,
                              ...(status.status === "loading"
                                ? { color: T.amber }
                                : status.status === "error"
                                  ? { color: T.red }
                                  : status.status === "empty"
                                    ? { color: T.textMuted }
                                    : { color: T.green }),
                            }}
                          >
                            {status.status === "loading"
                              ? "⟳"
                              : status.status === "error"
                                ? "✕ ERR"
                                : status.status === "empty"
                                  ? "∅ 0"
                                  : status.count !== undefined
                                    ? `✓ ${status.count}`
                                    : "✓"}
                          </span>
                        )}
                        {layers[layer.id] && RASTER_LAYERS.has(layer.id) && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                            <input
                              type="range"
                              min={10}
                              max={100}
                              value={layerOpacity[layer.id] ?? 100}
                              onChange={(e) => { onOpacity(layer.id, Number(e.target.value)); }}
                              style={{ width: 70, height: 14, accentColor: layer.accent, cursor: "pointer" }}
                            />
                            <span
                              style={{
                                fontSize: "0.55rem",
                                fontFamily: T.fontMono,
                                color: T.textMuted,
                                minWidth: 22,
                              }}
                            >
                              {layerOpacity[layer.id] ?? 100}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
