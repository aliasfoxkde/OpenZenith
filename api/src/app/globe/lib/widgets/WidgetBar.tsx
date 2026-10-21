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

/**
 * Renders the globe's widget toolbar: one button per registered widget (basemaps,
 * layers, tools, settings — icons come from `WIDGET_ICONS`, falling back to the
 * widget's own icon), plus a final button that restores the default widget
 * layout.
 *
 * A widget whose state is not visible is dimmed with the `hidden` class and its
 * button tooltip reads "Show" instead of "Hide".
 *
 * @param widgets - Registered widgets keyed by id; each entry supplies the
 *   widget's title/icon and its current visibility state.
 * @param onToggle - Called with a widget id when its button is pressed; the
 *   widget manager decides whether that shows or hides the widget.
 * @param onResetLayout - Called when the reset button is pressed to restore the
 *   default widget positions, sizes, and visibility.
 */
export function WidgetBar({ widgets, onToggle, onResetLayout }: WidgetBarProps) {
  return (
    <div className="wv-widget-bar">
      {Object.entries(widgets).map(([id, entry]) => (
        <button
          key={id}
          className={`wv-widget-bar-btn ${!entry.state.visible ? "hidden" : ""}`}
          onClick={() => {
            onToggle(id);
          }}
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
