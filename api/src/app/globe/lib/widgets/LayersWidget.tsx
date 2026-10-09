"use client";

import { useState } from "react";
import { SIDEBAR_SECTIONS } from "../constants";
import { LAYERS } from "@/lib/layers/registry";
import type { LayerDefinition } from "@/lib/layers/types";
import { SectionHeader } from "./SectionHeader";
import type { WidgetProps } from "./types";

// Values stay nullable: a section can list a layer id that is not registered.
const LAYER_MAP: Record<string, LayerDefinition | undefined> = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

// Globe-native layers (wired through LayerState in the Cesium viewer, not the
// shared registry) would otherwise render as their raw ids.
const GLOBE_LAYER_LABELS: Record<string, string> = {
  coverage: "DEM Coverage",
  currents: "Ocean Currents",
};

export function LayersWidget({ globe }: WidgetProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SIDEBAR_SECTIONS.map((s) => [s.key, true])),
  );

  return (
    <>
      {SIDEBAR_SECTIONS.map((section) => (
        <div className="wv-section" key={section.key}>
          <SectionHeader
            id={`wv-section-header-${section.key}`}
            title={section.title}
            // bounds: openSections is seeded from SIDEBAR_SECTIONS above and
            // toggles only flip existing keys, so section.key is always set
            open={openSections[section.key]!}
            onToggle={() => {
              setOpenSections((p) => ({ ...p, [section.key]: !p[section.key] }));
            }}
            bodyId={`wv-section-body-${section.key}`}
          />
          <div
            className={`wv-section-body ${openSections[section.key] ? "open" : ""}`}
            id={`wv-section-body-${section.key}`}
            role="region"
            aria-labelledby={`wv-section-header-${section.key}`}
          >
            {section.layerIds.map((layerId) => {
              const layer = LAYER_MAP[layerId];
              const checked = (globe.state.layers as unknown as Record<string, boolean>)[layerId] ?? false;
              const status = globe.dataStatus.find((d) => d.key === layerId);
              return (
                <div className="wv-row" key={layerId}>
                  <label htmlFor={`wv-layer-toggle-${layerId}`}>
                    <span className="dot" style={{ background: layer?.accent || "var(--accent)" }} />
                    {layer?.name || GLOBE_LAYER_LABELS[layerId] || layerId}
                    {checked && (status?.count ?? 0) > 0 ? (
                      <span style={{ color: "var(--text-muted)", fontSize: "9px", marginLeft: 4 }}>
                        ({status?.count ?? 0})
                      </span>
                    ) : null}
                  </label>
                  <input
                    id={`wv-layer-toggle-${layerId}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      globe.toggleLayer(layerId);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
