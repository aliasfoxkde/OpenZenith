"use client";

import { useState, useCallback } from "react";
import { OVERPASS_PRESETS } from "../lib/constants";
import { getOverpassBBox } from "../lib/map-helpers";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any;
  dark: boolean;
  onResult: (data: GeoJSON.FeatureCollection, name: string) => void;
}

export function OverpassTool({ map, dark, onResult }: Props) {
  const [presetIdx, setPresetIdx] = useState(0);
  const [query, setQuery] = useState(OVERPASS_PRESETS[0].query);
  const [loading, setLoading] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectPreset = useCallback((idx: number) => {
    setPresetIdx(idx);
    setQuery(OVERPASS_PRESETS[idx].query);
    setResultCount(null);
    setError(null);
  }, []);

  const runQuery = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResultCount(null);

    try {
      // Replace {{bbox}} with current map bounds
      const bbox = map ? getOverpassBBox(map) : "-1,-1,1,1";
      const finalQuery = query.replace(/\{\{bbox\}\}/g, bbox);

      const res = await fetch("/api/overpass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: finalQuery }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Overpass query failed");
      }

      const data = await res.json();

      // Convert Overpass elements to GeoJSON
      const features: GeoJSON.Feature[] = (data.elements || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((el: any) => {
          const tags = el.tags || {};
          let geometry: GeoJSON.Geometry;

          if (el.type === "node" && el.lat !== undefined) {
            geometry = { type: "Point", coordinates: [el.lon, el.lat] };
          } else if (el.type === "way" && el.bounds) {
            geometry = {
              type: "Point",
              coordinates: [(el.bounds.minlon + el.bounds.maxlon) / 2, (el.bounds.minlat + el.bounds.maxlat) / 2],
            };
          } else if (el.lat !== undefined) {
            geometry = { type: "Point", coordinates: [el.lon, el.lat] };
          } else {
            return null;
          }

          return {
            type: "Feature",
            geometry,
            properties: { ...tags, osm_id: el.id, osm_type: el.type },
          };
        })
        .filter(Boolean);

      const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
      setResultCount(features.length);
      onResult(fc, OVERPASS_PRESETS[presetIdx].label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, [query, map, presetIdx, onResult]);

  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        Query OpenStreetMap data via Overpass API. Results render on the map.
      </div>

      {/* Preset selector */}
      <select
        value={presetIdx}
        onChange={(e) => selectPreset(Number(e.target.value))}
        style={{
          width: "100%",
          padding: "6px 8px",
          background: inputBg,
          border: `1px solid ${border}`,
          borderRadius: 4,
          color: text,
          fontSize: 12,
          boxSizing: "border-box",
        }}
      >
        {OVERPASS_PRESETS.map((p, i) => (
          <option key={i} value={i}>
            {p.label}
          </option>
        ))}
      </select>

      {OVERPASS_PRESETS[presetIdx].description && (
        <div style={{ color: textSec, fontSize: 11 }}>{OVERPASS_PRESETS[presetIdx].description}</div>
      )}

      {/* Query editor */}
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={6}
        spellCheck={false}
        style={{
          width: "100%",
          padding: "8px",
          background: inputBg,
          border: `1px solid ${border}`,
          borderRadius: 4,
          color: text,
          fontSize: 11,
          fontFamily: "monospace",
          resize: "vertical",
          boxSizing: "border-box",
          lineHeight: 1.4,
        }}
      />

      {/* Run button */}
      <button
        onClick={runQuery}
        disabled={loading || !query.trim()}
        style={{
          padding: "8px 16px",
          background: loading ? "#555" : "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: loading ? "wait" : "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {loading ? "Running..." : "Run Query"}
      </button>

      {/* Results */}
      {resultCount !== null && (
        <div style={{ color: "#22c55e", fontSize: 12, fontWeight: 600 }}>
          {resultCount.toLocaleString()} features found
        </div>
      )}
      {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
