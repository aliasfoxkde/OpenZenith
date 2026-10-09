"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ComponentType } from "react";
import type { WidgetConfig, WidgetProps, WidgetState } from "./types";

/**
 * One mounted widget: its static `config`, its live and persisted `state`, and
 * the React component that renders it — looked up by id in the components map
 * passed to useWidgetManager, so it can be undefined when no component was
 * supplied for that id.
 */
export interface WidgetEntry {
  config: WidgetConfig;
  state: WidgetState;
  component: ComponentType<WidgetProps>;
}

/* Default positions stack the left column with no overlap. Basemaps opens
   expanded: 5 preview cards in a 2-column grid ≈ 285px tall, so it ends near
   y≈341 and everything below starts under it. Layers also opens expanded is
   impossible on a 900px viewport (its 60vh body would bury Tools and
   Settings), so it starts collapsed — one click on its header, or the widget
   bar above, expands it over the collapsed widgets (bring-to-front on
   pointer-down keeps that usable). Saved layouts in localStorage win. */
const WIDGET_CONFIGS: WidgetConfig[] = [
  {
    id: "basemaps",
    title: "Basemaps",
    icon: "🗺",
    defaultPosition: { x: 12, y: 56 },
    defaultCollapsed: false,
    minWidth: 230,
  },
  {
    id: "layers",
    title: "Layers",
    icon: "📊",
    defaultPosition: { x: 12, y: 356 },
    defaultCollapsed: true,
    minWidth: 230,
  },
  {
    id: "tools",
    title: "Tools",
    icon: "🔧",
    defaultPosition: { x: 12, y: 398 },
    defaultCollapsed: true,
    minWidth: 230,
  },
  {
    id: "settings",
    title: "Settings",
    icon: "⚙",
    defaultPosition: { x: 12, y: 440 },
    defaultCollapsed: true,
    minWidth: 230,
  },
];

const STORAGE_KEY = "globe-widgets";

function loadSavedState(): Record<string, Partial<WidgetState>> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // localStorage boundary: a payload that is not a JSON object carries no
    // per-widget state, so treat it as "nothing saved".
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Partial<WidgetState>>) : null;
  } catch {
    return null;
  }
}

/**
 * Owns the four left-column globe widgets (basemaps, layers, tools, settings)
 * and their drag/collapse/visibility/stacking state. The initial state merges
 * the WIDGET_CONFIGS defaults with any layout saved in localStorage key
 * "globe-widgets"; with no window (SSR) the defaults are used. Every state
 * change is written back to that key after a 500 ms debounce, one setTimeout
 * per change, cleared on unmount; quota and "tracking prevention" failures are
 * swallowed silently. Note the initialiser and `resetLayout` touch localStorage
 * during the state update rather than in an effect, so server and client can
 * disagree until hydration. Returns `widgets` (id to WidgetEntry), plus
 * `updateWidget` (partial state patch, ignored for unknown ids),
 * `toggleWidget`/`showWidget` (visibility), `focusWidget` (raises to
 * max zIndex + 1, a no-op when already on top so saved values stay bounded),
 * and `resetLayout` (restores defaults and removes the storage key).
 */
export function useWidgetManager(components: Record<string, ComponentType<WidgetProps>>) {
  const [widgets, setWidgets] = useState<Record<string, WidgetEntry>>(() => {
    const saved = loadSavedState();
    const entries: Record<string, WidgetEntry> = {};
    let zBase = 100;
    for (const config of WIDGET_CONFIGS) {
      const savedState = saved?.[config.id];
      entries[config.id] = {
        config,
        state: {
          position: savedState?.position || { ...config.defaultPosition },
          collapsed: savedState?.collapsed ?? config.defaultCollapsed ?? false,
          visible: savedState?.visible ?? true,
          zIndex: savedState?.zIndex ?? ++zBase,
        },
        // bounds: callers build the components map from the WIDGET_CONFIGS ids
        // (page.tsx supplies exactly these four)
        component: components[config.id]!,
      };
    }
    return entries;
  });

  // Persist to localStorage (debounced)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    const persist = () => {
      const data: Record<string, Partial<WidgetState>> = {};
      for (const [id, w] of Object.entries(widgets)) {
        data[id] = {
          position: w.state.position,
          collapsed: w.state.collapsed,
          visible: w.state.visible,
          zIndex: w.state.zIndex,
        };
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* tracking prevention */
      }
    };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(persist, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [widgets]);

  const updateWidget = useCallback((id: string, patch: Partial<WidgetState>) => {
    setWidgets((prev) => {
      // ids can be absent from the map even though Record indexing types as present
      const entry = prev[id]; // noUncheckedIndexedAccess: indexing already yields T | undefined
      if (!entry) return prev;
      return {
        ...prev,
        [id]: { ...entry, state: { ...entry.state, ...patch } },
      };
    });
  }, []);

  // Raise a widget above every sibling. A bare +1 only clears one sibling
  // (Layers under Settings stayed buried after expand), and incrementing on
  // every mousedown inflated saved z-indexes without bound.
  const focusWidget = useCallback((id: string) => {
    setWidgets((prev) => {
      const entry = prev[id]; // noUncheckedIndexedAccess: indexing already yields T | undefined
      if (!entry) return prev;
      const top = Math.max(...Object.values(prev).map((w) => w.state.zIndex || 100));
      if ((entry.state.zIndex || 100) === top) return prev;
      return {
        ...prev,
        [id]: { ...entry, state: { ...entry.state, zIndex: top + 1 } },
      };
    });
  }, []);

  const toggleWidget = useCallback(
    (id: string) => {
      // ids can be absent from the map even though Record indexing types as present
      const entry = widgets[id]; // noUncheckedIndexedAccess: indexing already yields T | undefined
      updateWidget(id, { visible: !entry?.state.visible });
    },
    [widgets, updateWidget],
  );

  const showWidget = useCallback(
    (id: string) => {
      updateWidget(id, { visible: true });
    },
    [updateWidget],
  );

  const resetLayout = useCallback(() => {
    setWidgets(() => {
      const entries: Record<string, WidgetEntry> = {};
      let zBase = 100;
      for (const config of WIDGET_CONFIGS) {
        entries[config.id] = {
          config,
          state: {
            position: { ...config.defaultPosition },
            collapsed: config.defaultCollapsed ?? false,
            visible: true,
            zIndex: ++zBase,
          },
          // bounds: same WIDGET_CONFIGS-id components map as above
          component: components[config.id]!,
        };
      }
      return entries;
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* */
    }
  }, [components]);

  return { widgets, updateWidget, toggleWidget, showWidget, focusWidget, resetLayout };
}
