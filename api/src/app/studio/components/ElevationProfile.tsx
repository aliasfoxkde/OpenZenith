"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ElevationPoint {
  lat: number;
  lon: number;
  elevation: number | null;
  distance: number;
}

interface Props {
  dark: boolean;
  onClose: () => void;
  coordinates: [number, number][];
}

export function ElevationProfile({ dark, onClose, coordinates }: Props) {
  const [points, setPoints] = useState<ElevationPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const bg = dark ? "#0f0f0f" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#ccc" : "#333";
  const textSec = dark ? "#666" : "#999";
  const lineColor = "#3b82f6";
  const fillColor = dark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.1)";

  useEffect(() => {
    if (coordinates.length < 2) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Compute distances between consecutive points
        const pointsWithDist: ElevationPoint[] = [{ lat: coordinates[0][1], lon: coordinates[0][0], elevation: null, distance: 0 }];
        for (let i = 1; i < coordinates.length; i++) {
          const prev = pointsWithDist[i - 1];
          const d = haversine(prev.lat, prev.lon, coordinates[i][1], coordinates[i][0]);
          pointsWithDist.push({ lat: coordinates[i][1], lon: coordinates[i][0], elevation: null, distance: pointsWithDist[i - 1].distance + d });
        }

        // Sample points for batch API (max 500)
        const maxPoints = 500;
        const step = Math.max(1, Math.floor(pointsWithDist.length / maxPoints));
        const sampled = pointsWithDist.filter((_, i) => i % step === 0 || i === pointsWithDist.length - 1);

        const res = await fetch("/api/elevation/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: sampled.map((p) => ({ lat: p.lat, lon: p.lon })) }),
        });

        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        if (!data.results) throw new Error("No results from API");

        // Interpolate elevations back onto all points
        const results = data.results as { lat: number; lon: number; elevation: number | null }[];
        for (const p of pointsWithDist) {
          const match = results.find(
            (r) => Math.abs(r.lat - p.lat) < 0.0001 && Math.abs(r.lon - p.lon) < 0.0001,
          );
          p.elevation = match?.elevation ?? null;
        }

        if (!cancelled) setPoints(pointsWithDist);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load elevation data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [coordinates]);

  const totalDist = points.length > 0 ? points[points.length - 1].distance : 0;
  const elevations = points.map((p) => p.elevation).filter((e): e is number => e !== null);
  const minElev = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElev = elevations.length > 0 ? Math.max(...elevations) : 0;

  const width = 600;
  const height = 180;
  const pad = { top: 20, right: 15, bottom: 30, left: 50 };

  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const xScale = totalDist > 0 ? chartW / totalDist : 1;
  const elevRange = maxElev - minElev || 1;
  const yScale = elevRange > 0 ? chartH / elevRange : 1;

  const formatDist = useCallback((d: number) => {
    if (d >= 1000) return `${(d / 1000).toFixed(1)} km`;
    return `${Math.round(d)} m`;
  }, []);

  const formatElev = useCallback((e: number) => {
    if (Math.abs(e) >= 1000) return `${(e / 1000).toFixed(1)} km`;
    return `${Math.round(e)} m`;
  }, []);

  const handleMouse = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left - pad.left;
    const my = e.clientY - rect.top - pad.top;
    const dist = Math.max(0, Math.min(totalDist, mx / xScale));
    const elev = Math.max(minElev, Math.min(maxElev, maxElev - my / yScale));
    // Update tooltip via title element
    const titleEl = svg.querySelector("title");
    if (titleEl) titleEl.textContent = `${formatDist(dist)}, ${formatElev(elev)}`;
  }, [points, xScale, yScale, totalDist, minElev, maxElev, formatDist, formatElev]);

  if (coordinates.length < 2) return null;

  return (
    <div
      style={{
        position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)",
        width, background: bg, border: `1px solid ${border}`, borderRadius: 8,
        padding: 8, zIndex: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Elevation Profile</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: textSec, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          aria-label="Close profile"
        >
          &times;
        </button>
      </div>

      {loading && (
        <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: textSec, fontSize: 12 }}>Loading elevation data...</span>
        </div>
      )}

      {error && (
        <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#ef4444", fontSize: 12 }}>{error}</span>
        </div>
      )}

      {!loading && !error && points.length > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={handleMouse}
          style={{ display: "block" }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = pad.top + frac * chartH;
            const elev = maxElev - frac * elevRange;
            return (
              <g key={frac}>
                <line x1={pad.left} y1={y} x2={pad.left + chartW} y2={y} stroke={border} strokeWidth={0.5} />
                <text x={pad.left - 6} y={y + 4} textAnchor="end" fill={textSec} fontSize={9}>{formatElev(elev)}</text>
              </g>
            );
          })}

          {/* Distance axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const x = pad.left + frac * chartW;
            const dist = frac * totalDist;
            return (
              <g key={frac}>
                <line x1={x} y1={pad.top} x2={x} y2={pad.top + chartH} stroke={border} strokeWidth={0.5} />
                <text x={x} y={height - 5} textAnchor="middle" fill={textSec} fontSize={9}>{formatDist(dist)}</text>
              </g>
            );
          })}

          {/* Fill area under curve */}
          <polygon
            points={[
              `${pad.left},${pad.top + chartH}`,
              ...points.map((p) => `${pad.left + (totalDist > 0 ? p.distance * xScale : 0)},${pad.top + (maxElev - (p.elevation ?? minElev)) * yScale}`),
              `${pad.left + (totalDist > 0 ? points[points.length - 1].distance * xScale : 0)},${pad.top + chartH}`,
            ].join(" ")}
            fill={fillColor}
            stroke="none"
          />

          {/* Elevation line */}
          <polyline
            points={points.map((p) => `${pad.left + (totalDist > 0 ? p.distance * xScale : 0)},${pad.top + (maxElev - (p.elevation ?? minElev)) * yScale}`).join(" ")}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Min/max labels */}
          <text x={pad.left + chartW + 4} y={pad.top + 10} fill={lineColor} fontSize={9} fontWeight={600}>
            {formatElev(maxElev)}
          </text>
          <text x={pad.left + chartW + 4} y={pad.top + chartH} fill={lineColor} fontSize={9} fontWeight={600}>
            {formatElev(minElev)}
          </text>

          {/* Distance label */}
          <text x={width / 2} y={height - 2} textAnchor="middle" fill={textSec} fontSize={9}>
            Distance: {formatDist(totalDist)}
          </text>
        </svg>
      )}
    </div>
  );
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
