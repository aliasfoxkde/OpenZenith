/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ComponentType } from "react";
import type { WidgetConfig, WidgetState } from "./types";

export interface WidgetEntry {
  config: WidgetConfig;
  state: WidgetState;
  component: ComponentType<any>;
}

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
    defaultPosition: { x: 12, y: 290 },
    defaultCollapsed: false,
    minWidth: 230,
  },
  {
    id: "tools",
    title: "Tools",
    icon: "🔧",
    defaultPosition: { x: 12, y: 540 },
    defaultCollapsed: true,
    minWidth: 230,
  },
  {
    id: "settings",
    title: "Settings",
    icon: "⚙",
    defaultPosition: { x: 12, y: 720 },
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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function useWidgetManager(components: Record<string, ComponentType<any>>) {
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
        component: components[config.id],
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
      const entry = prev[id];
      if (!entry) return prev;
      return {
        ...prev,
        [id]: { ...entry, state: { ...entry.state, ...patch } },
      };
    });
  }, []);

  const toggleWidget = useCallback(
    (id: string) => {
      updateWidget(id, { visible: !widgets[id]?.state.visible });
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
          component: components[config.id],
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

  return { widgets, updateWidget, toggleWidget, showWidget, resetLayout };
}
