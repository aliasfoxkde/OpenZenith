"use client";

import type { WidgetEntry } from "./useWidgetManager";

interface WidgetBarProps {
  widgets: Record<string, WidgetEntry>;
  onToggle: (id: string) => void;
  onResetLayout: () => void;
}

const WIDGET_ICONS: Record<string, string> = {
  basemaps: "🗺",
  layers: "📊",
  tools: "🔧",
  settings: "⚙",
};

export function WidgetBar({ widgets, onToggle, onResetLayout }: WidgetBarProps) {
  return (
    <div className="wv-widget-bar">
      {Object.entries(widgets).map(([id, entry]) => (
        <button
          key={id}
          className={`wv-widget-bar-btn ${!entry.state.visible ? "hidden" : ""}`}
          onClick={() => onToggle(id)}
          title={`${entry.state.visible ? "Hide" : "Show"} ${entry.config.title}`}
        >
          <span>{WIDGET_ICONS[id] || entry.config.icon || "?"}</span>
          <span>{entry.config.title}</span>
        </button>
      ))}
      <button className="wv-widget-bar-btn" onClick={onResetLayout} title="Reset layout to defaults">
        <span>↺</span>
      </button>
    </div>
  );
}
