"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { traceDownstream, traceUpstream, computeElevationProfile, type FlowPathResult } from "@/lib/flow-path";

interface FlowPathFeature {
  id: string;
  mode: "downstream" | "upstream";
  result: FlowPathResult;
  geojson: GeoJSON.Feature;
}

interface Props {
  dark: boolean;
  map: maplibregl.Map | null;
  cursorPos: { lat: number; lon: number } | null;
  imperial?: boolean;
  /** Shared ref — set by FlowPathTool, read by Studio page click handler */
  flowPathClickRef?: React.MutableRefObject<((lat: number, lon: number) => void) | null>;
}

const FLOW_SOURCE = "flowpath-source";
const FLOW_LAYER = "flowpath-line";
const FLOW_LABEL_LAYER = "flowpath-label";

export function FlowPathTool({ dark, map, cursorPos, imperial, flowPathClickRef }: Props) {
  const [mode, setMode] = useState<"none" | "downstream" | "upstream">("none");
  const [precision, setPrecision] = useState<number>(0.001);
  const [directions, setDirections] = useState<number>(16);
  const [maxPoints, setMaxPoints] = useState<number>(2000);
  const [loading, setLoading] = useState(false);
  const [paths, setPaths] = useState<FlowPathFeature[]>([]);

  // Refs to avoid stale closures in the click handler
  const modeRef = useRef(mode);
  const mapRef2 = useRef(map);
  const precisionRef = useRef(precision);
  const directionsRef = useRef(directions);
  const maxPointsRef = useRef(maxPoints);
  const pathsRef = useRef(paths);

  // Keep refs in sync with state
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    mapRef2.current = map;
  }, [map]);
  useEffect(() => {
    precisionRef.current = precision;
  }, [precision]);
  useEffect(() => {
    directionsRef.current = directions;
  }, [directions]);
  useEffect(() => {
    maxPointsRef.current = maxPoints;
  }, [maxPoints]);
  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  const bg = dark ? "#141414" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const _inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  /** Add or remove flow path GeoJSON layer on the map */
  const syncLayer = useCallback((features: FlowPathFeature[]) => {
    if (!mapRef2.current || !mapRef2.current.getSource(FLOW_SOURCE)) return;

    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features.map((p) => p.geojson as GeoJSON.Feature),
    };
    (mapRef2.current.getSource(FLOW_SOURCE) as unknown as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(
      fc,
    );
  }, []);

  /** Remove flow path layer from map */
  const removeLayer = useCallback(() => {
    if (!mapRef2.current) return;
    try {
      if (mapRef2.current.getLayer(FLOW_LABEL_LAYER)) mapRef2.current.removeLayer(FLOW_LABEL_LAYER);
    } catch {}
    try {
      if (mapRef2.current.getLayer(FLOW_LAYER)) mapRef2.current.removeLayer(FLOW_LAYER);
    } catch {}
    try {
      if (mapRef2.current.getSource(FLOW_SOURCE)) mapRef2.current.removeSource(FLOW_SOURCE);
    } catch {}
  }, []);

  /** Add flow path layer to map */
  const addLayer = useCallback(() => {
    if (!mapRef2.current) return;
    if (!mapRef2.current.getSource(FLOW_SOURCE)) {
      mapRef2.current.addSource(FLOW_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Elevation-colored line
      mapRef2.current.addLayer({
        id: FLOW_LAYER,
        type: "line",
        source: FLOW_SOURCE,
        paint: {
          "line-color": ["get", "lineColor"],
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });

      // Start marker
      mapRef2.current.addLayer({
        id: FLOW_LABEL_LAYER,
        type: "symbol",
        source: FLOW_SOURCE,
        filter: ["==", ["get", "marker"], true],
        layout: {
          "text-field": ["format", ["get", "label"], { "font-scale": 0.8 }],
          "text-size": 11,
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "#000",
          "text-halo-width": 1.5,
        },
      });
    }
  }, [map]);

  /** Color a path segment by elevation gradient (blue=low → brown/green=high) */
  function elevationColor(minElev: number, maxElev: number, elev: number): string {
    const t = maxElev > minElev ? (elev - minElev) / (maxElev - minElev) : 0.5;
    // Blue (#3b82f6) → Teal (#22c55e) → Yellow (#eab308) → Brown (#92400e)
    if (t < 0.33) {
      const r = Math.round(59 + (34 - 59) * (t / 0.33));
      const g = Math.round(130 + (197 - 130) * (t / 0.33));
      const b = Math.round(246 + (8 - 246) * (t / 0.33));
      return `rgb(${r},${g},${b})`;
    } else if (t < 0.66) {
      const r = Math.round(34 + (234 - 34) * ((t - 0.33) / 0.33));
      const g = Math.round(197 + (179 - 197) * ((t - 0.33) / 0.33));
      const b = Math.round(8 + (8 - 8) * ((t - 0.33) / 0.33));
      return `rgb(${r},${g},${b})`;
    } else {
      const r = Math.round(234 + (146 - 234) * ((t - 0.66) / 0.34));
      const g = Math.round(179 + (64 - 179) * ((t - 0.66) / 0.34));
      const b = Math.round(8 + (14 - 8) * ((t - 0.66) / 0.34));
      return `rgb(${r},${g},${b})`;
    }
  }

  /** Trace path from a map click */
  const handleClick = useCallback(
    async (lat: number, lon: number) => {
      if (modeRef.current === "none" || !mapRef2.current) return;
      const currentMap = mapRef2.current;
      setLoading(true);

      try {
        const result =
          modeRef.current === "downstream"
            ? await traceDownstream(lat, lon, undefined, {
                precision: precisionRef.current,
                directions: directionsRef.current,
                maxPoints: maxPointsRef.current,
              })
            : await traceUpstream(lat, lon, undefined, {
                precision: precisionRef.current,
                directions: directionsRef.current,
                maxPoints: maxPointsRef.current,
              });

        if (result.coordinates.length < 2) {
          setLoading(false);
          return;
        }

        // Build multi-segment GeoJSON with per-segment colors
        const minElev = Math.min(...result.elevations);
        const maxElev = Math.max(...result.elevations);

        const segments: GeoJSON.Feature[] = [];
        for (let i = 0; i < result.coordinates.length - 1; i++) {
          const elev = result.elevations[i];
          segments.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [result.coordinates[i], result.coordinates[i + 1]],
            },
            properties: {
              lineColor: elevationColor(minElev, maxElev, elev),
              marker: false,
              label: "",
            },
          });
        }

        // Start marker
        const startFeature: GeoJSON.Feature = {
          type: "Feature",
          geometry: { type: "Point", coordinates: result.coordinates[0] },
          properties: {
            marker: true,
            label: `${result.elevations[0].toFixed(0)}m`,
            lineColor: "transparent",
          },
        };

        const geojson = {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: result.coordinates },
          properties: {
            mode: modeRef.current,
            startLat: lat,
            startLon: lon,
            pointCount: result.elevations.length,
            totalDistanceM: computeTotalDist(result),
            minElevM: minElev,
            maxElevM: maxElev,
            elevRangeM: maxElev - minElev,
            elevations: result.elevations,
          },
        };

        const pathFeature: FlowPathFeature = { id: crypto.randomUUID(), mode: modeRef.current, result, geojson };
        const newPaths = [...pathsRef.current, pathFeature];
        setPaths(newPaths);

        // Add to map
        addLayer();
        const fc: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [...segments, startFeature],
        };
        const src = currentMap.getSource(FLOW_SOURCE) as unknown as
          { setData: (d: GeoJSON.FeatureCollection) => void } | undefined;
        if (src) {
          src.setData(fc);
        }

        // Fit map to path bounds
        if (result.coordinates.length > 0) {
          const lons = result.coordinates.map((c) => c[0]);
          const lats = result.coordinates.map((c) => c[1]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (currentMap.fitBounds as (bounds: any, options?: any) => void)(
            [
              [Math.min(...lons), Math.min(...lats)],
              [Math.max(...lons), Math.max(...lats)],
            ],
            { padding: 50, maxZoom: 14, duration: 800 },
          );
        }
      } catch (err) {
        console.error("Flow path error:", err);
      } finally {
        setLoading(false);
      }
    },
    [addLayer],
  );

  // Expose click handler to parent page
  useEffect(() => {
    if (!flowPathClickRef) return;
    flowPathClickRef.current = mode !== "none" ? handleClick : null;
    return () => {
      if (flowPathClickRef) flowPathClickRef.current = null;
    };
  }, [handleClick, mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer();
    };
  }, [removeLayer]);

  const handleClear = () => {
    setPaths([]);
    removeLayer();
  };

  const handleExport = () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: paths.map((p) => p.geojson as GeoJSON.Feature),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flow-paths.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDist = (m: number) => {
    if (imperial) {
      const ft = m * 3.28084;
      return ft > 5280 ? `${(ft / 5280).toFixed(2)} mi` : `${ft.toFixed(0)} ft`;
    }
    return m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
  };

  const handleModeToggle = (m: "downstream" | "upstream") => {
    setMode((prev) => (prev === m ? "none" : m));
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        {mode === "none"
          ? "Select Downstream or Upstream, then click the map to trace a flow path."
          : `Click anywhere on the map to trace ${mode}. Click again to add more paths.`}
      </div>

      {/* Mode buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => handleModeToggle("downstream")}
          style={{
            flex: 1,
            padding: "8px 4px",
            background: mode === "downstream" ? "#3b82f6" : bg,
            border: `1px solid ${mode === "downstream" ? "#3b82f6" : border}`,
            borderRadius: 4,
            color: mode === "downstream" ? "#fff" : text,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ↓ Downstream
        </button>
        <button
          onClick={() => handleModeToggle("upstream")}
          style={{
            flex: 1,
            padding: "8px 4px",
            background: mode === "upstream" ? "#f59e0b" : bg,
            border: `1px solid ${mode === "upstream" ? "#f59e0b" : border}`,
            borderRadius: 4,
            color: mode === "upstream" ? "#fff" : text,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ↑ Upstream
        </button>
      </div>

      {/* Options */}
      {mode !== "none" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: textSec, minWidth: 70 }}>Precision</span>
            <input
              type="range"
              min={0.0001}
              max={0.01}
              step={0.0001}
              value={precision}
              onChange={(e) => setPrecision(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ color: text, fontFamily: "monospace", minWidth: 50, textAlign: "right" }}>
              {precision.toFixed(4)}°
            </span>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: textSec, minWidth: 70 }}>Directions</span>
            <input
              type="range"
              min={4}
              max={90}
              step={1}
              value={directions}
              onChange={(e) => setDirections(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ color: text, fontFamily: "monospace", minWidth: 30, textAlign: "right" }}>{directions}</span>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: textSec, minWidth: 70 }}>Max Points</span>
            <input
              type="range"
              min={100}
              max={10000}
              step={100}
              value={maxPoints}
              onChange={(e) => setMaxPoints(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ color: text, fontFamily: "monospace", minWidth: 50, textAlign: "right" }}>
              {maxPoints.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Cursor position */}
      {mode !== "none" && cursorPos && (
        <div style={{ fontSize: 11, color: textSec }}>
          Cursor: ({cursorPos.lat.toFixed(5)}, {cursorPos.lon.toFixed(5)})
        </div>
      )}

      {loading && <div style={{ color: "#3b82f6", fontSize: 11 }}>Tracing path... (batching elevation queries)</div>}

      {/* Results list */}
      {paths.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: textSec, fontSize: 11 }}>
              {paths.length} path{paths.length > 1 ? "s" : ""}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={handleExport}
                style={{
                  padding: "2px 8px",
                  background: "transparent",
                  border: `1px solid ${border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                  color: textSec,
                  fontSize: 10,
                }}
              >
                Export
              </button>
              <button
                onClick={handleClear}
                style={{
                  padding: "2px 8px",
                  background: "transparent",
                  border: `1px solid ${border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                  color: "#ef4444",
                  fontSize: 10,
                }}
              >
                Clear All
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 280, overflow: "auto", border: `1px solid ${border}`, borderRadius: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: bg }}>
                  <th
                    style={{
                      padding: "4px 6px",
                      textAlign: "left",
                      color: textSec,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    Mode
                  </th>
                  <th
                    style={{
                      padding: "4px 6px",
                      textAlign: "right",
                      color: textSec,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    Distance
                  </th>
                  <th
                    style={{
                      padding: "4px 6px",
                      textAlign: "right",
                      color: textSec,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    Min
                  </th>
                  <th
                    style={{
                      padding: "4px 6px",
                      textAlign: "right",
                      color: textSec,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    Max
                  </th>
                  <th
                    style={{
                      padding: "4px 6px",
                      textAlign: "right",
                      color: textSec,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    Pts
                  </th>
                  <th style={{ padding: "4px 6px", color: "transparent" }}></th>
                </tr>
              </thead>
              <tbody>
                {paths.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: "3px 6px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: p.mode === "downstream" ? "#3b82f6" : "#f59e0b",
                          marginRight: 4,
                        }}
                      />
                    </td>
                    <td style={{ padding: "3px 6px", color: text, textAlign: "right", fontFamily: "monospace" }}>
                      {formatDist(p.geojson.properties.totalDistanceM)}
                    </td>
                    <td style={{ padding: "3px 6px", color: "#3b82f6", textAlign: "right", fontFamily: "monospace" }}>
                      {p.geojson.properties.minElevM.toFixed(0)}m
                    </td>
                    <td style={{ padding: "3px 6px", color: "#92400e", textAlign: "right", fontFamily: "monospace" }}>
                      {p.geojson.properties.maxElevM.toFixed(0)}m
                    </td>
                    <td style={{ padding: "3px 6px", color: textSec, textAlign: "right", fontFamily: "monospace" }}>
                      {p.geojson.properties.pointCount}
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <button
                        onClick={() => {
                          const newPaths = paths.filter((_, idx) => idx !== i);
                          setPaths(newPaths);
                          syncLayer(newPaths);
                          if (newPaths.length === 0) removeLayer();
                        }}
                        style={{
                          padding: "1px 4px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "#ef4444",
                          fontSize: 10,
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Elevation profile mini-chart */}
          <ElevationMiniChart paths={paths} dark={dark} imperial={imperial} />
        </div>
      )}
    </div>
  );
}

/* ─── Mini elevation profile chart ─── */

function ElevationMiniChart({
  paths,
  dark,
  imperial,
}: {
  paths: FlowPathFeature[];
  dark: boolean;
  imperial?: boolean;
}) {
  const textSec = dark ? "#888" : "#737373";
  const _text = dark ? "#e5e5e5" : "#171717";
  const gridColor = dark ? "#2a2a2a" : "#e5e5e5";

  if (paths.length === 0) return null;

  // Build a merged elevation profile across all paths
  const allProfiles = paths.map((p) => computeElevationProfile(p.result));
  const allElevs = allProfiles.flatMap((pr) => pr.map((p) => p.elevationM));
  const maxDist = Math.max(...allProfiles.map((pr) => pr[pr.length - 1]?.distanceM ?? 0));
  const minElev = Math.min(...allElevs);
  const maxElev = Math.max(...allElevs);
  const elevRange = maxElev - minElev || 1;

  const W = 280;
  const H = 60;
  const pad = { top: 4, right: 4, bottom: 16, left: 36 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const toX = (dist: number) => pad.left + (dist / maxDist) * chartW;
  const toY = (elev: number) => pad.top + chartH - ((elev - minElev) / elevRange) * chartH;

  // Grid lines
  const elevSteps = 4;
  const gridLines = [];
  for (let i = 0; i <= elevSteps; i++) {
    const elev = minElev + (elevRange * i) / elevSteps;
    const y = toY(elev);
    gridLines.push({ y, label: imperial ? `${(elev * 3.28084).toFixed(0)}ft` : `${elev.toFixed(0)}m` });
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: textSec, marginBottom: 4 }}>Elevation Profile</div>
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* Grid lines */}
        {gridLines.map((gl, i) => (
          <g key={i}>
            <line x1={pad.left} y1={gl.y} x2={W - pad.right} y2={gl.y} stroke={gridColor} strokeWidth={0.5} />
            <text x={pad.left - 3} y={gl.y + 3} textAnchor="end" fontSize={8} fill={textSec}>
              {gl.label}
            </text>
          </g>
        ))}

        {/* Path lines */}
        {allProfiles.map((profile, pi) => {
          const path = profile
            .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.distanceM).toFixed(1)} ${toY(p.elevationM).toFixed(1)}`)
            .join(" ");
          const color = paths[pi].mode === "downstream" ? "#3b82f6" : "#f59e0b";
          return <path key={pi} d={path} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />;
        })}

        {/* X axis label */}
        <text x={pad.left + chartW / 2} y={H - 2} textAnchor="middle" fontSize={8} fill={textSec}>
          {imperial ? "distance (ft)" : "distance (m)"}
        </text>
      </svg>
    </div>
  );
}

function computeTotalDist(result: FlowPathResult): number {
  let total = 0;
  for (let i = 1; i < result.coordinates.length; i++) {
    const [lon1, lat1] = result.coordinates[i - 1];
    const [lon2, lat2] = result.coordinates[i];
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}
