"use client";

import { useState, useEffect } from "react";
import { BASEMAPS } from "../constants";
import type { WidgetProps } from "./types";

const PREVIEW_GRADIENTS: Record<string, string> = {
  dark: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)",
  satellite: "linear-gradient(135deg, #2d4a22, #3d6b35, #1a3a0a)",
  osm: "linear-gradient(135deg, #f0efe8, #e0dfd5, #d4d0c8)",
  voyager: "linear-gradient(135deg, #f2f0eb, #e8e5df, #ddd9d1)",
  topo: "linear-gradient(135deg, #c8d8a0, #a8c878, #e8d8a8, #c8b898)",
};

export function BasemapWidget({ globe }: WidgetProps) {
  const [previews, setPreviews] = useState<Record<string, string>>({});

  // Load real tile previews
  useEffect(() => {
    for (const [key, { url }] of Object.entries(BASEMAPS)) {
      const tileUrl = url.replace("{z}", "2").replace("{x}", "1").replace("{y}", "1");
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 96;
          canvas.height = 96;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, 96, 96);
            const dataUrl = canvas.toDataURL();
            setPreviews((prev) => ({ ...prev, [key]: dataUrl }));
          }
        } catch {
          /* canvas not available */
        }
      };
      img.onerror = () => {
        /* keep gradient fallback */
      };
      img.src = tileUrl;
    }
  }, []);

  return (
    <div className="wv-bm-preview-grid">
      {Object.entries(BASEMAPS).map(([key, { label }]) => (
        <button
          key={key}
          className={`wv-bm-preview-card ${globe.state.basemap === key ? "active" : ""}`}
          onClick={() => globe.switchBasemap(key)}
        >
          <div
            className="wv-bm-preview-thumb"
            style={{
              background: previews[key] || PREVIEW_GRADIENTS[key] || PREVIEW_GRADIENTS.dark,
            }}
          />
          <span className="wv-bm-preview-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
