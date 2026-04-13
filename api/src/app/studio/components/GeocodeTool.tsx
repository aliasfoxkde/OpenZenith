"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { GeocodeResult } from "../lib/types";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any;
  dark: boolean;
}

export function GeocodeTool({ map, dark }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.length < 3) return;
    timerRef.current = setTimeout(() => search(query), 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, search]);

  const flyTo = (lat: number, lon: number) => {
    if (map) map.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
  };

  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>Search addresses or click the map for reverse geocoding.</div>

      {/* Search input */}
      <input
        placeholder="Search address..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && search(query)}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: inputBg,
          border: `1px solid ${border}`,
          borderRadius: 6,
          color: text,
          fontSize: 13,
          boxSizing: "border-box",
        }}
      />

      {/* Forward geocode results */}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => flyTo(r.lat, r.lon)}
              style={{
                padding: "8px 10px",
                background: inputBg,
                border: `1px solid ${border}`,
                borderRadius: 4,
                cursor: "pointer",
                color: text,
                fontSize: 12,
              }}
            >
              <div style={{ marginBottom: 2, lineHeight: 1.3 }}>{r.display_name.split(",").slice(0, 2).join(",")}</div>
              <div style={{ color: textSec, fontSize: 10, fontFamily: "monospace" }}>
                {r.lat.toFixed(4)}, {r.lon.toFixed(4)} &middot; {r.type}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <span style={{ color: textSec, fontSize: 11 }}>Searching...</span>}
    </div>
  );
}
