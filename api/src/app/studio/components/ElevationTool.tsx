"use client";

import { useState, useCallback } from "react";
import type { ElevationResult } from "../lib/types";

interface Props {
  map: any;
  dark: boolean;
  cursorPos: { lat: number; lon: number } | null;
}

export function ElevationTool({ map, dark, cursorPos }: Props) {
  const [results, setResults] = useState<ElevationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [profileMode, setProfileMode] = useState(false);
  const [profileStart, setProfileStart] = useState<{ lat: number; lon: number } | null>(null);
  const [profileEnd, setProfileEnd] = useState<{ lat: number; lon: number } | null>(null);

  const queryElevation = useCallback(
    async (lat: number, lon: number) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/elevation?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
        const data = await res.json();
        const result: ElevationResult = { lat, lon, elevation: data.elevation, surfaceType: data.surface_type };
        setResults((prev) => [result, ...prev].slice(0, 50));
        return result;
      } catch {
        setResults((prev) => [{ lat, lon, elevation: null }, ...prev].slice(0, 50));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleManualQuery = () => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (!isNaN(lat) && !isNaN(lon)) queryElevation(lat, lon);
  };

  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (profileMode) {
        if (!profileStart) {
          setProfileStart({ lat, lon });
        } else if (!profileEnd) {
          setProfileEnd({ lat, lon });
        }
      }
      queryElevation(lat, lon);
    },
    [profileMode, profileStart, profileEnd, queryElevation],
  );

  const handleClear = () => {
    setResults([]);
    setProfileStart(null);
    setProfileEnd(null);
    setProfileMode(false);
  };

  const copyCSV = () => {
    const header = "lat,lon,elevation,surface_type";
    const rows = results.map((r) => `${r.lat},${r.lon},${r.elevation ?? ""},${r.surfaceType || ""}`);
    navigator.clipboard.writeText([header, ...rows].join("\n"));
  };

  const bg = dark ? "#141414" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        Click the map to query elevation, or enter coordinates manually.
      </div>

      {/* Manual entry */}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          placeholder="lat"
          value={manualLat}
          onChange={(e) => setManualLat(e.target.value)}
          style={{
            flex: 1, padding: "5px 8px", background: inputBg, border: `1px solid ${border}`,
            borderRadius: 4, color: text, fontSize: 12,
          }}
        />
        <input
          placeholder="lon"
          value={manualLon}
          onChange={(e) => setManualLon(e.target.value)}
          style={{
            flex: 1, padding: "5px 8px", background: inputBg, border: `1px solid ${border}`,
            borderRadius: 4, color: text, fontSize: 12,
          }}
        />
        <button
          onClick={handleManualQuery}
          style={{
            padding: "5px 12px", background: "#22c55e", color: "#fff", border: "none",
            borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600,
          }}
        >
          Query
        </button>
      </div>

      {/* Use cursor position */}
      {cursorPos && (
        <button
          onClick={() => queryElevation(cursorPos.lat, cursorPos.lon)}
          style={{
            padding: "4px 10px", background: "transparent", border: `1px solid ${border}`,
            borderRadius: 4, cursor: "pointer", color: textSec, fontSize: 11,
          }}
        >
          Query cursor ({cursorPos.lat.toFixed(3)}, {cursorPos.lon.toFixed(3)})
        </button>
      )}

      {/* Profile mode */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => {
            setProfileMode(!profileMode);
            setProfileStart(null);
            setProfileEnd(null);
          }}
          style={{
            padding: "4px 10px",
            background: profileMode ? "#3b82f6" : "transparent",
            border: `1px solid ${profileMode ? "#3b82f6" : border}`,
            borderRadius: 4,
            cursor: "pointer",
            color: profileMode ? "#fff" : textSec,
            fontSize: 11,
          }}
        >
          Elevation Profile
        </button>
        {profileMode && (
          <span style={{ color: textSec, fontSize: 11 }}>
            {profileStart ? (profileEnd ? "Done" : "Click end point") : "Click start point"}
          </span>
        )}
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: textSec, fontSize: 11 }}>{results.length} results</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={copyCSV}
                style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${border}`, borderRadius: 3, cursor: "pointer", color: textSec, fontSize: 10 }}
              >
                Copy CSV
              </button>
              <button
                onClick={handleClear}
                style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${border}`, borderRadius: 3, cursor: "pointer", color: textSec, fontSize: 10 }}
              >
                Clear
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 250, overflow: "auto", border: `1px solid ${border}`, borderRadius: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: bg }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", color: textSec, borderBottom: `1px solid ${border}` }}>Elevation</th>
                  <th style={{ padding: "4px 6px", textAlign: "left", color: textSec, borderBottom: `1px solid ${border}` }}>Type</th>
                  <th style={{ padding: "4px 6px", textAlign: "right", color: textSec, borderBottom: `1px solid ${border}` }}>Lat</th>
                  <th style={{ padding: "4px 6px", textAlign: "right", color: textSec, borderBottom: `1px solid ${border}` }}>Lon</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: "3px 6px", color: text, fontFamily: "monospace" }}>
                      {r.elevation !== null ? `${r.elevation.toLocaleString()}m` : "N/A"}
                    </td>
                    <td style={{ padding: "3px 6px", color: textSec, fontSize: 10 }}>
                      {r.surfaceType || "-"}
                    </td>
                    <td style={{ padding: "3px 6px", color: textSec, textAlign: "right", fontFamily: "monospace" }}>
                      {r.lat.toFixed(4)}
                    </td>
                    <td style={{ padding: "3px 6px", color: textSec, textAlign: "right", fontFamily: "monospace" }}>
                      {r.lon.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && <span style={{ color: textSec, fontSize: 11 }}>Querying...</span>}
    </div>
  );
}
