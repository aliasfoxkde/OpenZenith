"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import type { WidgetConfig, WidgetState } from "./types";

interface WidgetShellProps {
  config: WidgetConfig;
  state: WidgetState;
  onStateChange: (patch: Partial<WidgetState>) => void;
  /** Raise this widget above all siblings (computed by the widget manager). */
  onFocus: () => void;
  children: ReactNode;
}

export function WidgetShell({ config, state, onStateChange, onFocus, children }: WidgetShellProps) {
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const headerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
      e.preventDefault();
      setDragging(true);
      dragOffset.current = {
        x: e.clientX - state.position.x,
        y: e.clientY - state.position.y,
      };
      onFocus();
      if (headerRef.current) {
        headerRef.current.setPointerCapture(e.pointerId);
      }
    },
    [state.position, onFocus],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const maxX = Math.max(100, typeof window !== "undefined" ? window.innerWidth : 800) - (config.minWidth || 220);
      const maxY = Math.max(60, typeof window !== "undefined" ? window.innerHeight : 600) - 40;
      onStateChange({
        position: {
          x: Math.max(0, Math.min(e.clientX - dragOffset.current.x, maxX)),
          y: Math.max(0, Math.min(e.clientY - dragOffset.current.y, maxY)),
        },
      });
    },
    [dragging, config.minWidth, onStateChange],
  );

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  if (!state.visible) return null;

  return (
    <div
      className="wv-widget"
      style={{
        left: state.position.x,
        top: state.position.y,
        zIndex: state.zIndex || 100,
        minWidth: config.minWidth || 220,
      }}
      onMouseDown={onFocus}
    >
      <div
        ref={headerRef}
        className="wv-widget-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="wv-widget-title">
          {config.icon ? `${config.icon} ` : ""}
          {config.title}
        </span>
        <button
          onClick={() => {
            onStateChange({ collapsed: !state.collapsed });
          }}
          title={state.collapsed ? "Expand" : "Collapse"}
        >
          {state.collapsed ? "▼" : "▲"}
        </button>
        <button
          onClick={() => {
            onStateChange({ visible: false });
          }}
          title="Close"
        >
          ×
        </button>
      </div>
      {!state.collapsed && <div className="wv-widget-body">{children}</div>}
    </div>
  );
}
