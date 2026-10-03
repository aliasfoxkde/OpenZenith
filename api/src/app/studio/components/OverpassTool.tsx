"use client";

import { useState, useCallback } from "react";
import { OVERPASS_PRESETS } from "../lib/constants";
import { getOverpassBBox } from "../lib/map-helpers";

interface Props {
  map: maplibregl.Map | null;
  dark: boolean;
  onResult: (data: GeoJSON.FeatureCollection, name: string) => void;
}

/** Error body returned by /api/overpass (always `{ error: string }`). */
interface OverpassErrorBody {
  error?: unknown;
}

/** One `elements[]` entry of an Overpass JSON response (subset we read). */
interface OverpassElement {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  tags?: Record<string, unknown> | null;
  bounds?: {
    minlat?: unknown;
    minlon?: unknown;
    maxlat?: unknown;
    maxlon?: unknown;
  } | null;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/** [lon, lat] when the element carries a numeric node position. */
function elementPoint(el: OverpassElement): [number, number] | null {
  return typeof el.lat === "number" && typeof el.lon === "number" ? [el.lon, el.lat] : null;
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
        // Overpass upstream can stall; fail into the tool's error state.
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const err = (await res.json()) as OverpassErrorBody;
        throw new Error(typeof err.error === "string" && err.error ? err.error : "Overpass query failed");
      }

      const data = (await res.json()) as OverpassResponse;

      // Convert Overpass elements to GeoJSON
      const features: GeoJSON.Feature[] = (data.elements || [])
        .map((el): GeoJSON.Feature | null => {
          const tags = el.tags || {};
          let geometry: GeoJSON.Geometry;

          if (el.type === "node") {
            const point = elementPoint(el);
            if (!point) return null;
            geometry = { type: "Point", coordinates: point };
          } else if (el.type === "way" && el.bounds) {
            geometry = {
              type: "Point",
              coordinates: [
                (Number(el.bounds.minlon) + Number(el.bounds.maxlon)) / 2,
                (Number(el.bounds.minlat) + Number(el.bounds.maxlat)) / 2,
              ],
            };
          } else {
            const point = elementPoint(el);
            if (!point) return null;
            geometry = { type: "Point", coordinates: point };
          }

          return {
            type: "Feature",
            geometry,
            properties: { ...tags, osm_id: el.id, osm_type: el.type },
          };
        })
        .filter((feature): feature is GeoJSON.Feature => feature !== null);

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
// WCAG AAA (7:1) secondary text on both themes (matches globals.css tokens).
  const textSec = dark ? "#a3a3a3" : "#525252";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        Query OpenStreetMap data via Overpass API. Results render on the map.
      </div>

      {/* Preset selector */}
      <select
        value={presetIdx}
        onChange={(e) => { selectPreset(Number(e.target.value)); }}
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
        onChange={(e) => { setQuery(e.target.value); }}
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
        onClick={() => { void runQuery(); }}
        disabled={loading || !query.trim()}
        style={{
          padding: "8px 16px",
          /* Blue-700 fill: white on blue-500 #3b82f6 is 3.68:1 (fails AA at
             13px); on #1d4ed8 it is 6.70:1. */
          background: loading ? "#555" : "#1e40af",
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
