"use client";

import { useEffect, useRef, useState } from "react";

interface SearchBoxProps {
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  inputStyle: React.CSSProperties;
  /** Raw "lat"/"lon" strings typed as coordinates (e.g. pasting "40.7, -74"). */
  onCoords: (lat: string, lon: string) => void;
  /** A geocoder result (or coordinate entry) the user committed to. */
  onPick: (lat: number, lon: number) => void;
}

/**
 * Debounced address/place search with geocoder dropdown. Owns the query,
 * results, and error state; the page only receives committed selections.
 */
export function SearchBox({ cardBg, border, text, textSecondary, inputStyle, onCoords, onPick }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ display_name: string; lat: number; lon: number }>>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close the dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); };
  }, []);

  function handleSearch(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      setError("");
      return;
    }

    // Check if query looks like coordinates (e.g., "40.7, -74.0" or "40.7,-74.0")
    const coordMatch = value.trim().match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const parsedLat = parseFloat(coordMatch[1]);
      const parsedLon = parseFloat(coordMatch[2]);
      if (
        !isNaN(parsedLat) &&
        !isNaN(parsedLon) &&
        parsedLat >= -90 &&
        parsedLat <= 90 &&
        parsedLon >= -180 &&
        parsedLon <= 180
      ) {
        onCoords(parsedLat.toString(), parsedLon.toString());
        setResults([]);
        setOpen(false);
        setError("");
        return;
      }
    }

    const runSearch = async () => {
      try {
        const res = await fetch(`/api/geocode?query=${encodeURIComponent(value)}&limit=5`);
        if (!res.ok) {
          setResults([]);
          setError("Address search is temporarily unavailable. Try again shortly.");
          setOpen(true);
          return;
        }
        const data = await res.json();
        if (data?.ok === false || data?.error) {
          setResults([]);
          setError(data.error?.message || data.error || "Address search is temporarily unavailable.");
          setOpen(true);
          return;
        }
        setError("");
        setResults(data.results || []);
        setOpen(true);
      } catch {
        setResults([]);
        setError("Address search is temporarily unavailable. Check your connection and retry.");
        setOpen(true);
      }
    };

    timerRef.current = setTimeout(() => {
      void runSearch();
    }, 300);
  }

  function clear() {
    setQuery("");
    setResults([]);
    setOpen(false);
    setError("");
  }

  return (
    <div ref={containerRef} style={{ position: "relative", marginBottom: "0.6rem" }}>
      <div style={{ position: "relative", display: "flex" }}>
        <span
          style={{
            position: "absolute",
            left: "0.7rem",
            top: "50%",
            transform: "translateY(-50%)",
            color: textSecondary,
            fontSize: "0.85rem",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          &#128269;
        </span>
        <input
          id="address-search"
          className="oz-input oz-input-search"
          placeholder="Search address or place..."
          aria-label="Search address or place"
          value={query}
          onChange={(e) => { handleSearch(e.target.value); }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          style={{
            ...inputStyle,
            paddingLeft: "2rem",
            paddingRight: query ? "2rem" : "0.75rem",
          }}
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={clear}
            style={{
              position: "absolute",
              right: "0.5rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: textSecondary,
              cursor: "pointer",
              fontSize: "0.85rem",
              padding: "0.1rem",
              lineHeight: 1,
            }}
          >
            &#x2715;
          </button>
        )}
      </div>
      {open && (results.length > 0 || error || query.trim()) && (
        <div
          role="region"
          aria-live="polite"
          aria-label="Address search results"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 6,
            maxHeight: "12rem",
            overflowY: "auto",
            marginTop: "0.2rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {error ? (
            <div role="alert" style={{ padding: "0.65rem 0.75rem", color: textSecondary, fontSize: "0.82rem" }}>
              {error}
            </div>
          ) : results.length > 0 ? (
            results.map((r, i) => (
              <button
                key={i}
                onClick={() => {
                  setQuery(r.display_name.split(",")[0]);
                  setOpen(false);
                  onPick(r.lat, r.lon);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.5rem 0.75rem",
                  border: "none",
                  background: "none",
                  color: text,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  borderBottom: i < results.length - 1 ? `1px solid ${border}` : "none",
                }}
              >
                <div style={{ fontWeight: 500 }}>{r.display_name.split(",")[0]}</div>
                <div style={{ fontSize: "0.72rem", color: textSecondary, marginTop: "0.1rem" }}>
                  {r.display_name.split(",").slice(1).join(",").trim()}
                </div>
              </button>
            ))
          ) : (
            <div style={{ padding: "0.65rem 0.75rem", color: textSecondary, fontSize: "0.82rem" }}>
              No matching places found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
