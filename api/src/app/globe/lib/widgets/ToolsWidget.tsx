/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SectionHeader } from "./SectionHeader";
import type { WidgetProps } from "./types";
import type { ToolMode } from "../tools/tools";
import { createAnnotationManager, type AnnotationType } from "../tools/annotations";
import { captureScreenshot, downloadScreenshot } from "../tools/screenshot";
import { loadBookmarks, saveBookmarks, createBookmark, type Bookmark } from "../tools/bookmarks";
import { createRangeRingManager } from "../tools/range-rings";

type SectionKey = "measure" | "search" | "bookmarks" | "draw" | "screenshot" | "rangeRings" | "bgp";

export function ToolsWidget({ globe }: WidgetProps) {
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    measure: true,
    search: false,
    bookmarks: false,
    draw: false,
    screenshot: false,
    rangeRings: false,
    bgp: false,
  });

  // ─── Measurement ───
  const isMeasure = (mode: string) => globe.activeTool === mode;

  // ─── Search / Geocode ───
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ display_name: string; lat: number; lon: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(searchQuery)}&limit=5`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  }, [searchQuery]);

  // ─── Coordinate Input ───
  const [coordLat, setCoordLat] = useState("");
  const [coordLon, setCoordLon] = useState("");

  // ─── Bookmarks ───
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [bmName, setBmName] = useState("");
  const bookmarkListRef = useRef<HTMLDivElement>(null);

  const saveBookmark = () => {
    const v = globe.viewerRef.current;
    const C = globe.cesiumRef.current;
    if (!v || !C || !bmName.trim()) return;
    const cg = v.camera.positionCartographic;
    if (!cg) return;
    const bm = createBookmark(
      bmName.trim(),
      +C.Math.toDegrees(cg.latitude),
      +C.Math.toDegrees(cg.longitude),
      cg.height,
      +C.Math.toDegrees(v.camera.heading),
      +C.Math.toDegrees(v.camera.pitch),
    );
    const updated = [bm, ...bookmarks];
    setBookmarks(updated);
    saveBookmarks(updated);
    setBmName("");
  };

  // ─── Annotations ───
  const annotationRef = useRef<any>(null);
  const [annMode, setAnnMode] = useState<AnnotationType | null>(null);
  const [annCount, setAnnCount] = useState(0);
  const annActive = annMode !== null;

  useEffect(() => {
    const v = globe.viewerRef.current;
    const C = globe.cesiumRef.current;
    if (v && C && !annotationRef.current) {
      annotationRef.current = createAnnotationManager(v, C);
    }
  }, [globe.viewerRef, globe.cesiumRef]);

  // ─── Range Rings ───
  const ringRef = useRef<any>(null);
  const [ringRadii, setRingRadii] = useState("50, 100, 200, 500");
  const [ringPlacing, setRingPlacing] = useState(false);
  const [ringCount, setRingCount] = useState(0);

  useEffect(() => {
    const v = globe.viewerRef.current;
    const C = globe.cesiumRef.current;
    if (v && C && !ringRef.current) {
      ringRef.current = createRangeRingManager(v, C);
    }
  }, [globe.viewerRef, globe.cesiumRef]);

  // ─── BGP ───
  const [bgpPrefix, setBgpPrefix] = useState("");
  const [bgpResult, setBgpResult] = useState<string | null>(null);
  const [bgpLoading, setBgpLoading] = useState(false);

  const doBgp = useCallback(() => {
    if (!bgpPrefix.trim()) return;
    setBgpLoading(true);
    setBgpResult(null);
    fetch(`/api/bgp?prefix=${encodeURIComponent(bgpPrefix)}`)
      .then((r) => r.json())
      .then((d) => {
        setBgpResult(JSON.stringify(d.data || d.error, null, 2));
        setBgpLoading(false);
      })
      .catch(() => {
        setBgpResult("Query failed");
        setBgpLoading(false);
      });
  }, [bgpPrefix]);

  // ─── Screenshot ───
  const handleScreenshot = () => {
    const v = globe.viewerRef.current;
    const dataUrl = captureScreenshot(v);
    if (dataUrl) downloadScreenshot(dataUrl);
  };

  // ─── Toggle annotation/range ring click handlers on globe ───
  // These are handled via the activeTool mechanism in page.tsx

  const sectionToggle = (key: SectionKey) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const annModes: { mode: AnnotationType; label: string }[] = [
    { mode: "marker", label: "📌 Marker" },
    { mode: "line", label: "📏 Line" },
    { mode: "polygon", label: "🔷 Polygon" },
    { mode: "text", label: "📝 Text" },
  ];

  return (
    <>
      {/* ── Measurement ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-measure`}
          title="Measurement"
          open={openSections.measure}
          onToggle={() => sectionToggle("measure")}
          bodyId={`wv-section-body-measure`}
        />
        <div
          className={`wv-section-body ${openSections.measure ? "open" : ""}`}
          id={`wv-section-body-measure`}
          role="region"
          aria-labelledby={`wv-section-header-measure`}
        >
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              className={`wv-widget-bar-btn ${isMeasure("measure-distance") ? "" : ""}`}
              onClick={() => {
                const n = isMeasure("measure-distance") ? "none" : ("measure-distance" as ToolMode);
                globe.setActiveTool(n);
                globe.toolManagerRef.current?.setMode(n);
              }}
              style={isMeasure("measure-distance") ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            >
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M2 14L14 2M2 14l3-3M14 2l-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              Ruler
            </button>
            <button
              className={`wv-widget-bar-btn ${isMeasure("measure-area") ? "" : ""}`}
              onClick={() => {
                const n = isMeasure("measure-area") ? "none" : ("measure-area" as ToolMode);
                globe.setActiveTool(n);
                globe.toolManagerRef.current?.setMode(n);
              }}
              style={isMeasure("measure-area") ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            >
              <svg viewBox="0 0 16 16" width="12" height="12">
                <polygon points="2,14 8,2 14,14" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              Area
            </button>
            <button
              className={`wv-widget-bar-btn ${isMeasure("elevation-profile") ? "" : ""}`}
              onClick={() => {
                const n = isMeasure("elevation-profile") ? "none" : ("elevation-profile" as ToolMode);
                globe.setActiveTool(n);
                globe.toolManagerRef.current?.setMode("none");
                if (n === "none") globe.elevationProfileRef.current?.clear();
              }}
              style={isMeasure("elevation-profile") ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            >
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M1 12L4 8L7 10L10 4L13 6L15 2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              Profile
            </button>
            {globe.activeTool !== "none" && (
              <button
                className="wv-widget-bar-btn"
                onClick={() => {
                  globe.setActiveTool("none");
                  globe.toolManagerRef.current?.clear();
                  globe.elevationProfileRef.current?.clear();
                }}
                style={{ borderColor: "var(--err)", color: "var(--err)" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Search / Navigate ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-search`}
          title="Search / Navigate"
          open={openSections.search}
          onToggle={() => sectionToggle("search")}
          bodyId={`wv-section-body-search`}
        />
        <div
          className={`wv-section-body ${openSections.search ? "open" : ""}`}
          id={`wv-section-body-search`}
          role="region"
          aria-labelledby={`wv-section-header-search`}
        >
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              placeholder="Search location..."
              aria-label="Search location"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "4px 8px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              onClick={doSearch}
              disabled={!searchQuery.trim() || searchLoading}
              style={{
                background: "#333",
                border: "none",
                borderRadius: 4,
                padding: "4px 10px",
                color: "#ccc",
                fontSize: "11px",
                cursor: searchQuery.trim() ? "pointer" : "default",
                fontFamily: "var(--font-mono)",
              }}
            >
              {searchLoading ? "..." : "Go"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="wv-search-results">
              {searchResults.map((r, i) => (
                <button key={i} className="wv-search-item" onClick={() => globe.flyTo(r.lat, r.lon, 50000)}>
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }} />
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="text"
              placeholder="Lat"
              aria-label="Latitude"
              value={coordLat}
              onChange={(e) => setCoordLat(e.target.value)}
              style={{
                width: 80,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "3px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <input
              type="text"
              placeholder="Lon"
              aria-label="Longitude"
              value={coordLon}
              onChange={(e) => setCoordLon(e.target.value)}
              style={{
                width: 80,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "3px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              onClick={() => {
                const lat = parseFloat(coordLat);
                const lon = parseFloat(coordLon);
                if (!isNaN(lat) && !isNaN(lon)) globe.flyTo(lat, lon, 50000);
              }}
              style={{
                background: "#333",
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                color: "#ccc",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              Go
            </button>
          </div>
        </div>
      </div>

      {/* ── Bookmarks ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-bookmarks`}
          title="Bookmarks"
          open={openSections.bookmarks}
          onToggle={() => sectionToggle("bookmarks")}
          bodyId={`wv-section-body-bookmarks`}
        />
        <div
          className={`wv-section-body ${openSections.bookmarks ? "open" : ""}`}
          id={`wv-section-body-bookmarks`}
          role="region"
          aria-labelledby={`wv-section-header-bookmarks`}
        >
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              type="text"
              placeholder="Bookmark name..."
              aria-label="Bookmark name"
              value={bmName}
              onChange={(e) => setBmName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveBookmark();
              }}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "3px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              onClick={saveBookmark}
              disabled={!bmName.trim()}
              style={{
                background: "#333",
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                color: "#ccc",
                fontSize: "11px",
                cursor: bmName.trim() ? "pointer" : "default",
                fontFamily: "var(--font-mono)",
              }}
            >
              Save
            </button>
          </div>
          <div ref={bookmarkListRef}>
            {bookmarks.map((bm) => (
              <div className="wv-bookmark-item" key={bm.id}>
                <button
                  className="wv-bookmark-name wv-bookmark-name-btn"
                  onClick={() => globe.flyTo(bm.lat, bm.lon, bm.alt)}
                  title={`${bm.lat}, ${bm.lon} @ ${bm.alt.toLocaleString()}m`}
                >
                  {bm.name}
                </button>
                <button
                  className="wv-bookmark-del"
                  onClick={() => {
                    const updated = bookmarks.filter((b) => b.id !== bm.id);
                    setBookmarks(updated);
                    saveBookmarks(updated);
                  }}
                  title="Delete"
                  aria-label={`Delete bookmark ${bm.name}`}
                >
                  ×
                </button>
              </div>
            ))}
            {bookmarks.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: "10px", padding: "4px 0" }}>No bookmarks saved</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Draw / Annotate ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-draw`}
          title="Draw / Annotate"
          open={openSections.draw}
          onToggle={() => sectionToggle("draw")}
          bodyId={`wv-section-body-draw`}
        />
        <div
          className={`wv-section-body ${openSections.draw ? "open" : ""}`}
          id={`wv-section-body-draw`}
          role="region"
          aria-labelledby={`wv-section-header-draw`}
        >
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {annModes.map(({ mode, label }) => (
              <button
                key={mode}
                className={`wv-widget-bar-btn ${annActive && annMode === mode ? "" : ""}`}
                onClick={() => {
                  const newMode = annActive && annMode === mode ? null : mode;
                  setAnnMode(newMode);
                  if (annotationRef.current) {
                    annotationRef.current.setMode(newMode);
                    setAnnCount(annotationRef.current.annotations.length);
                  }
                }}
                style={annActive && annMode === mode ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
              >
                {label}
              </button>
            ))}
            {annActive && (
              <button
                className="wv-widget-bar-btn"
                onClick={() => {
                  setAnnMode(null);
                  if (annotationRef.current) {
                    annotationRef.current.finish();
                    setAnnCount(annotationRef.current.annotations.length);
                  }
                }}
                style={{ borderColor: "var(--err)", color: "var(--err)" }}
              >
                Finish
              </button>
            )}
          </div>
          {(annActive || annCount > 0) && (
            <button
              className="wv-widget-bar-btn"
              onClick={() => {
                setAnnMode(null);
                if (annotationRef.current) {
                  annotationRef.current.clearAll();
                  setAnnCount(0);
                }
              }}
              style={{ marginTop: 4, borderColor: "var(--err)", color: "var(--err)", fontSize: "9px" }}
            >
              Clear All ({annCount})
            </button>
          )}
          {annCount > 0 && (
            <button
              className="wv-widget-bar-btn"
              onClick={() => {
                if (annotationRef.current) {
                  const geojson = annotationRef.current.exportGeoJSON();
                  navigator.clipboard.writeText(geojson);
                }
              }}
              style={{ marginTop: 4, fontSize: "9px" }}
            >
              Copy GeoJSON
            </button>
          )}
        </div>
      </div>

      {/* ── Screenshot ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-screenshot`}
          title="Screenshot"
          open={openSections.screenshot}
          onToggle={() => sectionToggle("screenshot")}
          bodyId={`wv-section-body-screenshot`}
        />
        <div
          className={`wv-section-body ${openSections.screenshot ? "open" : ""}`}
          id={`wv-section-body-screenshot`}
          role="region"
          aria-labelledby={`wv-section-header-screenshot`}
        >
          <button
            className="wv-widget-bar-btn"
            onClick={handleScreenshot}
            style={{ width: "100%", justifyContent: "center" }}
          >
            📸 Capture View
          </button>
        </div>
      </div>

      {/* ── Range Rings ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-rangeRings`}
          title="Range Rings"
          open={openSections.rangeRings}
          onToggle={() => sectionToggle("rangeRings")}
          bodyId={`wv-section-body-rangeRings`}
        />
        <div
          className={`wv-section-body ${openSections.rangeRings ? "open" : ""}`}
          id={`wv-section-body-rangeRings`}
          role="region"
          aria-labelledby={`wv-section-header-rangeRings`}
        >
          <div className="wv-row" style={{ gap: 4 }}>
            <label style={{ fontSize: "10px" }}>Radii (km)</label>
            <input
              type="text"
              value={ringRadii}
              placeholder="50, 100, 200"
              aria-label="Ring radii in kilometers"
              onChange={(e) => setRingRadii(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (ringRef.current)
                    ringRef.current.setRadii(
                      ringRadii
                        .split(",")
                        .map(Number)
                        .filter((n) => !isNaN(n) && n > 0),
                    );
                }
              }}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "2px 6px",
                color: "#ccc",
                fontSize: "10px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              className={`wv-widget-bar-btn ${ringPlacing ? "" : ""}`}
              onClick={() => setRingPlacing(!ringPlacing)}
              style={ringPlacing ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            >
              {ringPlacing ? "Click Globe to Place" : "Place Rings"}
            </button>
            {ringCount > 0 && (
              <button
                className="wv-widget-bar-btn"
                onClick={() => {
                  if (ringRef.current) {
                    ringRef.current.clear();
                    setRingCount(0);
                  }
                  setRingPlacing(false);
                }}
                style={{ borderColor: "var(--err)", color: "var(--err)" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── BGP Lookup ── */}
      <div className="wv-section">
        <SectionHeader
          id={`wv-section-header-bgp`}
          title="BGP Lookup"
          open={openSections.bgp}
          onToggle={() => sectionToggle("bgp")}
          bodyId={`wv-section-body-bgp`}
        />
        <div
          className={`wv-section-body ${openSections.bgp ? "open" : ""}`}
          id={`wv-section-body-bgp`}
          role="region"
          aria-labelledby={`wv-section-header-bgp`}
        >
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              placeholder="e.g. 8.8.8.0/24"
              aria-label="BGP prefix"
              value={bgpPrefix}
              onChange={(e) => setBgpPrefix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doBgp();
              }}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "2px 6px",
                color: "#ccc",
                fontSize: "11px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              onClick={doBgp}
              disabled={!bgpPrefix.trim() || bgpLoading}
              style={{
                background: "#333",
                border: "none",
                borderRadius: 4,
                padding: "2px 8px",
                color: "#ccc",
                fontSize: "11px",
                cursor: bgpPrefix.trim() ? "pointer" : "default",
                fontFamily: "var(--font-mono)",
              }}
            >
              {bgpLoading ? "..." : "Go"}
            </button>
          </div>
          {bgpResult && (
            <pre
              style={{
                color: "#888",
                fontSize: "10px",
                fontFamily: "monospace",
                maxHeight: 120,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: "6px 0 0",
                padding: 0,
              }}
            >
              {bgpResult}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}
