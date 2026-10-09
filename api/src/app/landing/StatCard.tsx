"use client";

import { useState } from "react";
import { useTheme } from "./useTheme";

interface Stat {
  label: string;
  value: string;
  tip: string;
}

/**
 * One landing stats card. Hover/focus tooltip state lives HERE, not at page
 * level: the stats row renders eight of these, and page-level state used to
 * re-render the whole landing tree (28 flip cards included) on every card
 * hover. Colors mirror page.tsx's theme block (the AAA contrast ratios in
 * its comments apply here too).
 */
export default function StatCard({ s }: { s: Stat }) {
  const dark = useTheme();
  const [open, setOpen] = useState(false);
  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const textSecondary = dark ? "#9CA3AF" : "#404040";
  const accentText = dark ? "#22c55e" : "#14532d";
  const tooltipBg = "#1a1a1a";

  return (
    <div
      className="oz-lift"
      style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "0.75rem 1rem",
        textAlign: "center",
        position: "relative",
      }}
    >
      <div style={{ fontSize: "1.3rem", fontWeight: 700, color: accentText, marginBottom: "0.15rem" }}>{s.value}</div>
      <div
        style={{
          fontSize: "0.75rem",
          color: textSecondary,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.2rem",
        }}
      >
        {s.label}
        <button
          type="button"
          aria-label={`What does "${s.label}" mean?`}
          aria-expanded={open}
          onMouseEnter={() => {
            setOpen(true);
          }}
          onMouseLeave={() => {
            setOpen(false);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onClick={() => {
            setOpen((v) => !v);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // 2.5.8 AA floor (24px)
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: `1px solid ${border}`,
            fontSize: "0.65rem",
            color: textSecondary,
            lineHeight: 1,
            flexShrink: 0,
            background: "transparent",
            padding: 0,
            cursor: "help",
          }}
        >
          ?
        </button>
      </div>
      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: tooltipBg,
            color: "#e5e5e5",
            padding: "0.5rem 0.7rem",
            borderRadius: 8,
            fontSize: "0.72rem",
            lineHeight: 1.5,
            width: 220,
            zIndex: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            whiteSpace: "normal",
          }}
        >
          {s.tip}
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              border: "5px solid transparent",
              borderTopColor: tooltipBg,
            }}
          />
        </div>
      )}
    </div>
  );
}
