"use client";

import { useState, useCallback } from "react";
import { SURVEILLANCE_THEME as T } from "@/lib/theme";

/* ─── Toolbar ──────────────────────────────────────────────── */

interface ToolbarProps {
  onSearch?: (query: string) => void;
  onJumpTo?: (lat: number, lon: number) => void;
  onScreenshot?: () => void;
  dark?: boolean;
}

export function Toolbar({ onSearch, onJumpTo, onScreenshot }: ToolbarProps) {
  const [searchValue, setSearchValue] = useState("");
  const [latValue, setLatValue] = useState("");
  const [lonValue, setLonValue] = useState("");
  const [showCoords, setShowCoords] = useState(false);

  const handleSearch = useCallback(() => {
    if (searchValue.trim() && onSearch) {
      onSearch(searchValue.trim());
    }
  }, [searchValue, onSearch]);

  const handleJump = useCallback(() => {
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      onJumpTo?.(lat, lon);
    }
  }, [latValue, lonValue, onJumpTo]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.35rem 0.6rem",
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        backdropFilter: "blur(8px)",
        boxShadow: T.glowSubtle,
        fontFamily: T.fontMono,
        fontSize: "0.72rem",
        flexWrap: "wrap",
      }}
    >
      {/* Search */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color: T.accent, fontSize: "0.8rem" }}>⌕</span>
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search location..."
          style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 2,
            color: T.text,
            padding: "0.2rem 0.5rem",
            fontSize: "0.72rem",
            fontFamily: T.fontMono,
            outline: "none",
            width: 180,
          }}
        />
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 16, background: T.border }} />

      {/* Coordinate input */}
      <button
        onClick={() => setShowCoords(!showCoords)}
        style={{
          background: showCoords ? T.accent : "transparent",
          border: `1px solid ${T.border}`,
          borderRadius: 2,
          color: showCoords ? "#0a0f1a" : T.textMuted,
          padding: "0.2rem 0.4rem",
          cursor: "pointer",
          fontSize: "0.72rem",
          fontFamily: T.fontMono,
          lineHeight: 1,
        }}
      >
        ⊕
      </button>

      {showCoords && (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input
            type="text"
            value={latValue}
            onChange={(e) => setLatValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            placeholder="LAT"
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 2,
              color: T.text,
              padding: "0.2rem 0.3rem",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              outline: "none",
              width: 65,
            }}
          />
          <input
            type="text"
            value={lonValue}
            onChange={(e) => setLonValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            placeholder="LON"
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 2,
              color: T.text,
              padding: "0.2rem 0.3rem",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              outline: "none",
              width: 65,
            }}
          />
          <button
            onClick={handleJump}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 2,
              color: T.accent,
              padding: "0.2rem 0.4rem",
              cursor: "pointer",
              fontSize: "0.72rem",
              fontFamily: T.fontMono,
              lineHeight: 1,
            }}
          >
            GO
          </button>
        </div>
      )}

      {/* Separator */}
      {showCoords && <div style={{ width: 1, height: 16, background: T.border }} />}

      {/* Screenshot */}
      {onScreenshot && (
        <button
          onClick={onScreenshot}
          style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 2,
            color: T.textMuted,
            padding: "0.2rem 0.4rem",
            cursor: "pointer",
            fontSize: "0.72rem",
            fontFamily: T.fontMono,
            lineHeight: 1,
          }}
        >
          &#x1F4F7;
        </button>
      )}
    </div>
  );
}
