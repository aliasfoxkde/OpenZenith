"use client";

import { useState } from "react";
import { SIDEBAR_SECTIONS } from "../constants";
import { LAYERS } from "@/lib/layers/registry";
import type { WidgetProps } from "./types";

const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

export function LayersWidget({ globe }: WidgetProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SIDEBAR_SECTIONS.map((s) => [s.key, true])),
  );

  return (
    <>
      {SIDEBAR_SECTIONS.map((section) => (
        <div className="wv-section" key={section.key}>
          <div
            className={`wv-section-header ${openSections[section.key] ? "open" : ""}`}
            onClick={() => setOpenSections((p) => ({ ...p, [section.key]: !p[section.key] }))}
          >
            <span>{section.title}</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections[section.key] ? "open" : ""}`}>
            {section.layerIds.map((layerId) => {
              const layer = LAYER_MAP[layerId];
              const checked = (globe.state.layers as unknown as Record<string, boolean>)[layerId] ?? false;
              const status = globe.dataStatus.find((d) => d.key === layerId);
              return (
                <div className="wv-row" key={layerId}>
                  <label>
                    <span className="dot" style={{ background: layer?.accent || "var(--accent)" }} />
                    {layer?.name || layerId}
                    {checked && (status?.count ?? 0) > 0 ? (
                      <span style={{ color: "var(--text-muted)", fontSize: "9px", marginLeft: 4 }}>
                        ({status?.count ?? 0})
                      </span>
                    ) : null}
                  </label>
                  <input type="checkbox" checked={checked} onChange={() => globe.toggleLayer(layerId as any)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
