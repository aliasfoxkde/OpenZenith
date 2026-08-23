"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GetInTouch } from "@/components/GetInTouch";
import { CodeBlock } from "@/components/CodeBlock";
import { LOCATIONS, latLonToTile, pickRandomLocations } from "./landing/locations";
import { useTheme, setThemeMode, getThemeMode, initTheme } from "./landing/useTheme";
import { waitForMapLibre } from "./landing/maplibre-loader";
import { FlipCard } from "./landing/FlipCard";
import { addOrUpdatePin, flyToWithPadding } from "./landing/map-helpers";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function Home() {
  const dark = useTheme();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [sampleLocations, setSampleLocations] = useState(() => LOCATIONS.slice(0, 5));
  const [result, setResult] = useState<{
    elevation: number | null;
    unit: string;
    srtmTile: string;
    tile: string;
    source: string;
    resolution: number;
    location: { lat: number; lon: number };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mapLoading, setMapLoading] = useState(true);
  const [showTop, setShowTop] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<"url" | "tile" | "curl" | "js" | "python" | "result">("url");
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [userGeo, setUserGeo] = useState<{
    city: string | null;
    region: string | null;
    country: string | null;
  } | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: number; lon: number }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroMapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heroMapInstance = useRef<any>(null);
  const heroMapFlyRef = useRef<{ lat: number; lon: number } | null>(null);
  const geoInitDone = useRef(false);

  // Close search dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Randomize sample locations on mount (client-only to avoid hydration mismatch)
  useEffect(() => {
    setSampleLocations(pickRandomLocations(5));
    initTheme();
  }, []);

  // Auto-detect user location via GeoIP and pre-populate
  useEffect(() => {
    if (geoInitDone.current) return;
    geoInitDone.current = true;
    let cancelled = false;
    (async () => {
      try {
        const geoRes = await fetch("/api/geoip");
        if (cancelled) return;
        const geo = await geoRes.json();

        const userLat = geo?.latitude;
        const userLon = geo?.longitude;

        setUserGeo({
          city: geo?.city || null,
          region: geo?.regionName || null,
          country: geo?.countryName || null,
        });

        if (typeof userLat !== "number" || typeof userLon !== "number") return;

        // Clamp to valid coordinate range
        const clampedLat = Math.max(-90, Math.min(90, userLat));
        const clampedLon = Math.max(-180, Math.min(180, userLon));
        const latStr = clampedLat.toFixed(4);
        const lonStr = clampedLon.toFixed(4);

        if (cancelled) return;
        setLat(latStr);
        setLon(lonStr);

        // Fetch elevation and address for user location
        const eRes = await fetch(`/api/query?lat=${clampedLat}&lon=${clampedLon}&include=elevation,address`);
        if (cancelled) return;
        const eData = await eRes.json();
        if (!eData.error) {
          if (eData.elevation) setResult(eData.elevation);
          setSnippetTab("result");
          heroMapFlyRef.current = { lat: clampedLat, lon: clampedLon };
          if (eData.address) {
            const addr = eData.address.address;
            const parts = [
              addr?.city || addr?.town || addr?.village || addr?.county,
              addr?.state,
              addr?.country,
            ].filter(Boolean);
            if (parts.length > 0) setPlaceName(parts.join(", "));
          }
        }
      } catch {
        // GeoIP unavailable — silent fallback, user can type manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#9CA3AF" : "#6B7280";
  const accent = "#22c55e";
  const accentDim = dark ? "rgba(34,197,94,0.12)" : "#dcfce7";
  const inputBg = dark ? "#111" : "#fff";
  const W = 1400;

  // Back-to-top scroll listener
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  // Init hero map — deferred one tick so initTheme() sets correct dark state first
  const heroMapReady = useRef(false);
  useEffect(() => {
    if (!heroMapReady.current) {
      heroMapReady.current = true;
      return; // skip first render; initTheme() runs in parallel, next tick has correct dark
    }
    if (!heroMapRef.current || heroMapInstance.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled || !heroMapRef.current) return;

        const basemapUrl = dark
          ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
          : "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png";

        const map = new mlgl.Map({
          container: heroMapRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [basemapUrl],
                tileSize: 256,
                attribution: "&copy; CartoDB",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          },
          center: [0, 25],
          zoom: 1.5,
          interactive: false,
          attributionControl: false,
        });

        map.on("load", () => {
          if (cancelled) return;

          // Add DEM terrain source (Terrarium PNG tiles from R2)
          // Admin boundary glow layers
          try {
            map.addSource("boundaries", {
              type: "vector",
              tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"],
              maxzoom: 6,
            });
            const boundaryColor = dark ? "0, 229, 255" : "0, 80, 180";
            map.addLayer(
              {
                id: "boundary-glow",
                type: "line",
                source: "boundaries",
                "source-layer": "boundary",
                paint: {
                  "line-color": `rgba(${boundaryColor}, 0.12)`,
                  "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 3, 2, 6, 3],
                  "line-blur": 2,
                },
              },
              "osm",
            );
            map.addLayer(
              {
                id: "boundary-line",
                type: "line",
                source: "boundaries",
                "source-layer": "boundary",
                paint: {
                  "line-color": `rgba(${boundaryColor}, 0.25)`,
                  "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 3, 0.8, 6, 1],
                  "line-opacity": 0.6,
                },
              },
              "boundary-glow",
            );
          } catch {
            // Boundary tiles unavailable — continue without
          }

          // Elevation accuracy overlay (shows data resolution)
          try {
            map.addSource("elevation-accuracy", {
              type: "raster",
              tiles: ["/api/elevation-accuracy/{z}/{x}/{y}"],
              tileSize: 256,
              maxzoom: 5,
            });
            map.addLayer(
              {
                id: "elevation-accuracy",
                type: "raster",
                source: "elevation-accuracy",
                paint: {
                  "raster-opacity": 0.4,
                  "raster-fade-duration": 300,
                },
              },
              "osm",
            );
          } catch {
            // Accuracy layer unavailable
          }

          setMapLoading(false);
        });

        heroMapInstance.current = map;

        // If GeoIP resolved before map loaded, fly now
        if (heroMapFlyRef.current) {
          const pending = heroMapFlyRef.current;
          heroMapFlyRef.current = null;
          setTimeout(() => {
            if (!map || !map.getSource) return;
            flyToWithPadding(map, pending.lon, pending.lat, 8);
            addOrUpdatePin(map, pending.lon, pending.lat);
          }, 500);
        }
      } catch {
        setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (heroMapInstance.current) {
        heroMapInstance.current.remove();
        heroMapInstance.current = null;
      }
    };
  }, [dark]); // depends on dark — deferred first render, then stable

  // Update hero map basemap when theme changes
  useEffect(() => {
    const map = heroMapInstance.current;
    if (!map) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MapLibre untyped getSource
      const source = map.getSource("osm") as any;
      if (source && source.setTiles) {
        const url = dark
          ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
          : "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png";
        source.setTiles([url]);
      }
      // Update boundary colors
      const bc = dark ? "0, 229, 255" : "0, 80, 180";
      if (map.getLayer("boundary-glow")) {
        map.setPaintProperty("boundary-glow", "line-color", `rgba(${bc}, 0.12)`);
      }
      if (map.getLayer("boundary-line")) {
        map.setPaintProperty("boundary-line", "line-color", `rgba(${bc}, 0.25)`);
      }
    } catch {
      // Map not ready or source unavailable
    }
  }, [dark]);

  // Fly hero map to location after lookup
  useEffect(() => {
    const target = heroMapFlyRef.current;
    if (!target || !heroMapInstance.current) return;
    const map = heroMapInstance.current;
    flyToWithPadding(map, target.lon, target.lat, 8);
    addOrUpdatePin(map, target.lon, target.lat);
    heroMapFlyRef.current = null;
  }, [result]);

  function handleSearch(query: string) {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      setSearchError("");
      return;
    }

    // Check if query looks like coordinates (e.g., "40.7, -74.0" or "40.7,-74.0")
    const coordMatch = query.trim().match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
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
        setLat(parsedLat.toString());
        setLon(parsedLon.toString());
        setSearchResults([]);
        setSearchOpen(false);
        setSearchError("");
        return;
      }
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?query=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) {
          setSearchResults([]);
          setSearchError("Address search is temporarily unavailable. Try again shortly.");
          setSearchOpen(true);
          return;
        }
        const data = await res.json();
        if (data?.ok === false || data?.error) {
          setSearchResults([]);
          setSearchError(data.error?.message || data.error || "Address search is temporarily unavailable.");
          setSearchOpen(true);
          return;
        }
        setSearchError("");
        setSearchResults(data.results || []);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
        setSearchError("Address search is temporarily unavailable. Check your connection and retry.");
        setSearchOpen(true);
      }
    }, 300);
  }

  async function lookup() {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (isNaN(la) || isNaN(lo)) {
      setError("Enter valid coordinates");
      return;
    }
    if (la < -90 || la > 90 || lo < -180 || lo > 180) {
      setError("Invalid coordinates (-90 to 90 lat, -180 to 180 lon)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/query?lat=${la}&lon=${lo}&include=elevation,address`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResult(null);
      } else {
        // Extract elevation for backward compat
        if (data.elevation) {
          setResult(data.elevation);
        } else {
          setResult(null);
        }
        setSnippetTab("result");
        heroMapFlyRef.current = { lat: la, lon: lo };
        // Extract address from unified response
        if (data.address) {
          const addr = data.address.address;
          const parts = [addr?.city || addr?.town || addr?.village || addr?.county, addr?.state, addr?.country].filter(
            Boolean,
          );
          setPlaceName(parts.length > 0 ? parts.join(", ") : data.address.display_name || null);
        } else {
          setPlaceName(null);
        }
      }
    } catch {
      setError("Failed to fetch data");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: inputBg,
    color: text,
    outline: "none",
    fontFamily: "inherit",
    minWidth: 0,
  };

  return (
    <ErrorBoundary>
      <div id="page-root" className="oz-page" data-theme={dark ? "dark" : "light"}>
        <Navbar
          dark={dark}
          extra={
            <button
              onClick={() => {
                const current = getThemeMode();
                const next = current === "dark" ? "light" : "dark";
                setThemeMode(next);
              }}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                background: "none",
                border: `1px solid ${border}`,
                borderRadius: 6,
                padding: "0.35rem",
                cursor: "pointer",
                color: text,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                transition: "opacity 0.15s",
                opacity: 0.7,
              }}
            >
              {dark ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          }
        />

        {/* Hero: Map background + Elevation lookup */}
        <section
          id="hero"
          className="oz-hero"
          style={{ position: "relative", height: 660, overflow: "hidden", marginBottom: "2rem" }}
        >
          {/* Map background */}
          <div
            id="hero-map"
            ref={heroMapRef}
            className="oz-hero-map"
            style={{
              position: "absolute",
              inset: 0,
              filter: dark ? "brightness(1.4) contrast(0.9) saturate(0.6)" : undefined,
            }}
          />
          {/* Subtle overlay — lets map texture show through */}
          <div
            className="oz-hero-overlay"
            style={{
              position: "absolute",
              inset: 0,
              background: dark
                ? "linear-gradient(180deg, rgba(10,10,10,0.72) 0%, rgba(10,10,10,0.22) 40%, rgba(10,10,10,0.62) 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0.40) 40%, rgba(255,255,255,0.80) 100%)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
          {/* Loading indicator */}
          {mapLoading && (
            <div
              id="hero-loading"
              className="oz-hero-loading"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                background: "rgba(0,0,0,0.7)",
                color: "#22c55e",
                padding: "0.5rem 1rem",
                borderRadius: 6,
                fontSize: "0.85rem",
                zIndex: 4,
              }}
            >
              Loading elevation map...
            </div>
          )}
          {/* Content overlay */}
          <div
            id="hero-content"
            className="oz-hero-content"
            style={{
              position: "relative",
              zIndex: 3,
              maxWidth: 600,
              margin: "0 auto",
              padding: "2.5rem 1.5rem 2rem",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <h1
              id="hero-title"
              className="oz-hero-title"
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                margin: "0 0 0.25rem",
                lineHeight: 1.2,
              }}
            >
              Free global geospatial API
            </h1>
            <p
              id="hero-subtitle"
              className="oz-hero-subtitle"
              style={{ fontSize: "0.88rem", color: textSecondary, margin: "0 0 1.25rem", lineHeight: 1.5 }}
            >
              Elevation, weather, tides, and address data for any point on Earth. No API key or signup required.
            </p>

            {/* User location badge from GeoIP */}
            {userGeo && (userGeo.city || userGeo.country) && (
              <div
                id="user-location-badge"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  marginBottom: "0.75rem",
                  fontSize: "0.78rem",
                  color: textSecondary,
                }}
              >
                <span style={{ color: accent, fontSize: "0.7rem" }}>&#9679;</span>
                <span>{[userGeo.city, userGeo.region, userGeo.country].filter(Boolean).join(", ")}</span>
              </div>
            )}

            {/* Address search */}
            <div ref={searchRef} style={{ position: "relative", marginBottom: "0.6rem" }}>
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
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onFocus={() => {
                    if (searchResults.length > 0) setSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchOpen(false);
                  }}
                  style={{
                    ...inputStyle,
                    paddingLeft: "2rem",
                    paddingRight: searchQuery ? "2rem" : "0.75rem",
                  }}
                />
                {searchQuery && (
                  <button
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                      setSearchOpen(false);
                      setSearchError("");
                    }}
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
              {searchOpen && (searchResults.length > 0 || searchError || searchQuery.trim()) && (
                <div
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
                  {searchError ? (
                    <div role="alert" style={{ padding: "0.65rem 0.75rem", color: textSecondary, fontSize: "0.82rem" }}>
                      {searchError}
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setLat(r.lat.toString());
                          setLon(r.lon.toString());
                          setSearchQuery(r.display_name.split(",")[0]);
                          setSearchOpen(false);
                          lookup();
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
                          borderBottom: i < searchResults.length - 1 ? `1px solid ${border}` : "none",
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

            {/* Lookup inputs */}
            <div
              id="lookup-form"
              className="oz-lookup-form"
              style={{ display: "flex", gap: "0.5rem", marginBottom: "0.6rem" }}
            >
              <input
                id="lookup-lat"
                className="oz-input oz-input-lat"
                placeholder="Latitude"
                aria-label="Latitude"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                style={inputStyle}
              />
              <input
                id="lookup-lon"
                className="oz-input oz-input-lon"
                placeholder="Longitude"
                aria-label="Longitude"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                style={inputStyle}
              />
              <button
                id="lookup-btn"
                className="oz-lookup-btn"
                onClick={lookup}
                disabled={loading}
                style={{
                  padding: "0 1rem",
                  borderRadius: 6,
                  border: "none",
                  background: accent,
                  color: "#000",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading ? 0.7 : 1,
                  flexShrink: 0,
                }}
              >
                {loading ? "..." : "Go"}
              </button>
            </div>

            {/* Sample locations */}
            <div id="sample-locations" className="oz-sample-locations">
              <span style={{ fontSize: "0.75rem", color: "var(--oz-text-secondary)", flexShrink: 0 }}>Try:</span>
              {sampleLocations.map((loc) => (
                <button
                  key={loc.name}
                  className="oz-sample-btn"
                  onClick={() => {
                    setLat(loc.lat);
                    setLon(loc.lon);
                  }}
                  style={{
                    padding: "0.15rem 0.45rem",
                    borderRadius: 4,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: textSecondary,
                    fontSize: "0.72rem",
                    cursor: "pointer",
                  }}
                >
                  {loc.name}
                </button>
              ))}
              <button
                id="shuffle-btn"
                className="oz-shuffle-btn"
                onClick={() => setSampleLocations(pickRandomLocations(4))}
                title="Shuffle locations"
                style={{
                  padding: "0.1rem 0.3rem",
                  borderRadius: 4,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: textSecondary,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                &#x21bb;
              </button>
            </div>

            {/* Error */}
            {error && (
              <div id="lookup-error" className="oz-lookup-error">
                {error}
              </div>
            )}

            {/* Combined Result + Code Snippets panel */}
            <div id="snippets-panel" className="oz-snippets">
              <div className="oz-snippet-bar">
                <div className="oz-snippet-tabs">
                  {result && (
                    <button
                      className={`oz-snippet-tab ${snippetTab === "result" ? "active" : ""}`}
                      onClick={() => setSnippetTab("result")}
                    >
                      Result
                    </button>
                  )}
                  <button
                    className={`oz-snippet-tab ${snippetTab === "url" ? "active" : ""}`}
                    onClick={() => setSnippetTab("url")}
                  >
                    API URL
                  </button>
                  <button
                    className={`oz-snippet-tab ${snippetTab === "tile" ? "active" : ""}`}
                    onClick={() => setSnippetTab("tile")}
                  >
                    Tile
                  </button>
                  <button
                    className={`oz-snippet-tab ${snippetTab === "curl" ? "active" : ""}`}
                    onClick={() => setSnippetTab("curl")}
                  >
                    cURL
                  </button>
                  <button
                    className={`oz-snippet-tab ${snippetTab === "js" ? "active" : ""}`}
                    onClick={() => setSnippetTab("js")}
                  >
                    JS
                  </button>
                  <button
                    className={`oz-snippet-tab ${snippetTab === "python" ? "active" : ""}`}
                    onClick={() => setSnippetTab("python")}
                  >
                    Python
                  </button>
                </div>
                <button
                  className="oz-snippet-copy"
                  onClick={() => {
                    const la = lat || "28.0";
                    const lo = lon || "86.9";
                    const t = latLonToTile(Number(la), Number(lo), 8);
                    const snippetText =
                      snippetTab === "result" && result
                        ? `${result.elevation !== null ? `${result.elevation}m (${(result.elevation * 3.28084).toFixed(2)} ft)` : "No data"}`
                        : snippetTab === "url"
                          ? `https://openzenith.cyopsys.com/api/elevation?lat=${la}&lon=${lo}`
                          : snippetTab === "tile"
                            ? `https://openzenith.cyopsys.com/api/tile/8/${t.x}/${t.y}`
                            : snippetTab === "curl"
                              ? `curl "https://openzenith.cyopsys.com/api/elevation?lat=${la}&lon=${lo}"`
                              : snippetTab === "js"
                                ? `const res = await fetch('/api/elevation?lat=${la}&lon=${lo}')\nconst { elevation } = await res.json()`
                                : `import requests\nres = requests.get("https://openzenith.cyopsys.com/api/elevation", params={"lat": ${la}, "lon": ${lo}})\nprint(res.json()["elevation"])`;
                    navigator.clipboard.writeText(snippetText);
                    setSnippetCopied(true);
                    setTimeout(() => setSnippetCopied(false), 1500);
                  }}
                >
                  {snippetCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <CodeBlock
                dark={dark}
                code={
                  snippetTab === "result" && result
                    ? result.elevation !== null
                      ? `${result.elevation}m (${(result.elevation * 3.28084).toFixed(2)} ft)`
                      : "No data"
                    : snippetTab === "url"
                      ? `https://openzenith.cyopsys.com/api/elevation?lat=${lat || "28.0"}&lon=${lon || "86.9"}`
                      : snippetTab === "tile"
                        ? (() => {
                            const t = latLonToTile(Number(lat || "28.0"), Number(lon || "86.9"), 8);
                            return `https://openzenith.cyopsys.com/api/tile/8/${t.x}/${t.y}`;
                          })()
                        : snippetTab === "curl"
                          ? `curl "https://openzenith.cyopsys.com/api/elevation?lat=${lat || "28.0"}&lon=${lon || "86.9"}"`
                          : snippetTab === "js"
                            ? `const res = await fetch('/api/elevation?lat=${lat || "28.0"}&lon=${lon || "86.9"}')\nconst { elevation } = await res.json()`
                            : `import requests\nres = requests.get("https://openzenith.cyopsys.com/api/elevation", params={"lat": ${lat || "28.0"}, "lon": ${lon || "86.9"}})\nprint(res.json()["elevation"])`
                }
              >
                {snippetTab === "result" && result && (
                  <div>
                    <div className="oz-result-value">
                      {result.elevation !== null ? `${result.elevation.toLocaleString()}m` : "No data"}
                      {result.elevation !== null && (
                        <span className="oz-result-ft">({(result.elevation * 3.28084).toFixed(2)} ft)</span>
                      )}
                    </div>
                    <div className="oz-result-meta">
                      {result.location.lat.toFixed(4)}, {result.location.lon.toFixed(4)} &middot;{" "}
                      {result.tile || result.srtmTile} &middot; {result.resolution}m
                    </div>
                    {placeName && (
                      <div
                        style={{ fontSize: "0.72rem", color: textSecondary, marginTop: "0.15rem", fontStyle: "italic" }}
                      >
                        near {placeName}
                      </div>
                    )}
                  </div>
                )}
                {snippetTab === "url" && (
                  <a
                    id="snippet-api-url"
                    className="oz-snippet-url"
                    href={`https://openzenith.cyopsys.com/api/elevation?lat=${lat || "28.0"}&lon=${lon || "86.9"}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://openzenith.cyopsys.com/api/elevation?lat={lat || "28.0"}&amp;lon={lon || "86.9"}
                  </a>
                )}
                {snippetTab === "tile" &&
                  (() => {
                    const t = latLonToTile(Number(lat || "28.0"), Number(lon || "86.9"), 8);
                    const tileUrl = `/api/tile/8/${t.x}/${t.y}`;
                    const mapUrl = `/map#lng=${lat || "86.9"}&lat=${lat || "28.0"}&zoom=10`;
                    return (
                      <>
                        <a
                          className="oz-snippet-url"
                          href={`https://openzenith.cyopsys.com${tileUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          https://openzenith.cyopsys.com{tileUrl}
                        </a>
                        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <a
                            href={mapUrl}
                            style={{
                              fontSize: "0.68rem",
                              color: "var(--oz-accent, #00e5ff)",
                              textDecoration: "none",
                              fontFamily: "var(--oz-font-mono, monospace)",
                            }}
                          >
                            Open in Map &rarr;
                          </a>
                          <span
                            style={{
                              fontSize: "0.65rem",
                              color: "var(--oz-text-secondary, #64748b)",
                              fontFamily: "var(--oz-font-mono, monospace)",
                            }}
                          >
                            z8 &middot; {t.x}/{t.y} &middot; 256&times;256 Int16
                          </span>
                        </div>
                      </>
                    );
                  })()}
                {snippetTab === "curl" && (
                  <div>
                    <span className="oz-syn-method">curl</span>{" "}
                    <span style={{ color: text }}>
                      "https://openzenith.cyopsys.com/api/elevation?lat={lat || "28.0"}&amp;lon={lon || "86.9"}"
                    </span>
                  </div>
                )}
                {snippetTab === "js" && (
                  <>
                    <div>
                      <span className="oz-syn-keyword">const</span> res ={" "}
                      <span style={{ color: textSecondary }}>await</span> <span className="oz-syn-function">fetch</span>
                      (
                      <span className="oz-syn-string">
                        &apos;/api/elevation?lat={lat || "28.0"}&amp;lon={lon || "86.9"}&apos;
                      </span>
                      )
                    </div>
                    <div>
                      <span className="oz-syn-keyword">const</span> &#123; elevation &#125; ={" "}
                      <span style={{ color: textSecondary }}>await</span> res.json()
                    </div>
                  </>
                )}
                {snippetTab === "python" && (
                  <>
                    <div>
                      <span className="oz-syn-keyword">import</span> requests
                    </div>
                    <div>
                      res = requests.<span className="oz-syn-function">get</span>(
                      <span className="oz-syn-string">"https://openzenith.cyopsys.com/api/elevation"</span>,
                    </div>
                    <div>
                      &nbsp;&nbsp;&nbsp;&nbsp;params=&#123;<span className="oz-syn-string">"lat"</span>:{" "}
                      <span className="oz-syn-number">{lat || "28.0"}</span>,{" "}
                      <span className="oz-syn-string">"lon"</span>:{" "}
                      <span className="oz-syn-number">{lon || "86.9"}</span>&#125;)
                    </div>
                    <div>
                      <span className="oz-syn-keyword">print</span>(res.json()[
                      <span className="oz-syn-string">"elevation"</span>])
                    </div>
                  </>
                )}
              </CodeBlock>
            </div>
          </div>

          {/* Open Full Map button */}
          <a
            href="/map"
            style={{
              position: "absolute",
              bottom: "0.75rem",
              right: "0.75rem",
              background: "rgba(0,0,0,0.7)",
              color: "#ccc",
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              fontSize: "0.8rem",
              textDecoration: "none",
              border: "1px solid #333",
              backdropFilter: "blur(8px)",
              zIndex: 2,
            }}
          >
            Open Full Map &rarr;
          </a>
        </section>

        {/* Stats */}
        <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.75rem" }}>
            {[
              {
                label: "Terrain tiles",
                value: "33M+",
                tip: "Multi-resolution pyramid: 87K tiles at z0\u20138, 1.1M at z10 on Cloudflare R2, plus 32M Quantized Mesh tiles at z13 (~1m precision) generated. Copernicus GLO-30 land + GEBCO 2025 ocean bathymetry.",
              },
              {
                label: "Storage",
                value: "Cloudflare R2",
                tip: "Tiles served from Cloudflare R2 object storage via edge runtime with cache-aside (130\u2013190ms TTFB). Full Cloudflare Pages deployment \u2014 no Node.js dependency.",
              },
              {
                label: "Resolution",
                value: "1.7km \u2192 156m",
                tip: "Multi-resolution pyramid: zoom 0\u20138 (\u22481.7km/pixel) for global context + zoom 10 (\u2248156m/pixel) for regional detail. 32M Quantized Mesh tiles at z13 (\u22481m) generated for land. Copernicus GLO-30 + GEBCO 2025.",
              },
              {
                label: "Coverage",
                value: "100%",
                tip: "Global coverage \u2014 all land and ocean. Copernicus GLO-30 covers global landmass. GEBCO 2025 provides full ocean bathymetry including polar regions.",
              },
              {
                label: "Ocean depth",
                value: "~11km",
                tip: "GEBCO 2025 bathymetry covers ocean depths up to ~11km (Mariana Trench). The merged dataset provides continuous elevation from deepest ocean to highest mountain.",
              },
              {
                label: "Lat range",
                value: "90\u00b0N\u201390\u00b0S",
                tip: "Full latitude coverage from pole to pole. Copernicus GLO-30 extends beyond SRTM\u2019s 60\u00b0 limit. GEBCO covers all ocean areas.",
              },
              {
                label: "API endpoints",
                value: "47",
                tip: "Elevation, DEM tiles, bathymetry, GEBCO, flights, vessels, military, weather warnings, geocoding, reverse geocoding, BGP, NLNOG, waterways, overpass, proxy, and more. OpenAPI 3.0 spec at /api/docs.",
              },
              {
                label: "Data layers",
                value: "37",
                tip: "Map and globe integrate 37 data layers including earthquakes, flights, vessels, satellites, hurricanes, weather radar, wildfires, lightning, space weather, air quality, volcanoes, GDACS, and more.",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: cardBg,
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  padding: "0.75rem 1rem",
                  textAlign: "center",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: "1.3rem", fontWeight: 700, color: accent, marginBottom: "0.15rem" }}>
                  {s.value}
                </div>
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
                  <span
                    onMouseEnter={(e) => {
                      setTooltip(s.tip);
                      (e.target as HTMLElement).style.cursor = "help";
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: `1px solid ${border}`,
                      fontSize: "0.6rem",
                      color: textSecondary,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    &#63;
                  </span>
                </div>
                {tooltip === s.tip && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 8px)",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: dark ? "#222" : "#1a1a1a",
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
                        borderTopColor: dark ? "#222" : "#1a1a1a",
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section
          style={{
            maxWidth: W,
            margin: "0 auto",
            padding: "3rem 1.5rem 3rem",
            borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
          }}
        >
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.5rem", textAlign: "center" }}>Features</h2>
          <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.75rem", textAlign: "center" }}>
            Core API &amp; Map Tools
          </p>
          <div className="oz-features-grid">
            {[
              {
                emoji: "\u26F0\uFE0F",
                title: "Elevation API",
                desc: "Query elevation at any lat/lon. Global coverage with Copernicus GLO-30 land + GEBCO 2025 ocean.",
                back: "Copernicus GLO-30 (land) merged with GEBCO 2025 (ocean). Bilinear interpolation, surface type detection, tile metadata.",
                href: "/api/docs",
                btn: "View API Docs",
              },
              {
                emoji: "\uD83D\uDDFA\uFE0F",
                title: "Tile Server",
                desc: "Multi-resolution terrain tiles served from Cloudflare R2 via edge runtime. z0\u201310 Terrarium PNG + z13 Quantized Mesh.",
                back: "Multi-resolution pyramid: z0\u20138 (1.7km) + z10 (156m) Terrarium PNG on R2. 32M z13 QM tiles (~1m) generated. Edge runtime with <50ms global latency.",
                href: "/map",
                btn: "Open Map",
              },
              {
                emoji: "\uD83D\uDDFA\uFE0F",
                title: "Interactive Map",
                desc: "MapLibre GL dark theme, 3D terrain, 9 basemaps, annotations, bookmarks, elevation profile, offline support.",
                back: "Click any point for elevation. Drag to draw profile. Right-click context menu with copy coordinates and tile info.",
                href: "/map",
                btn: "Open Map",
              },
              {
                emoji: "\uD83C\uDF0D",
                title: "Globe 3D",
                desc: "CesiumJS 3D globe with 3D/Columbus/2D view modes, terrain elevation, and 37 real-time data layers.",
                back: "Switch between 3D globe, Columbus 3D, and 2D map. Five built-in themes from Dark to Classified Intel HUD.",
                href: "/globe",
                btn: "Launch Globe",
              },
              {
                emoji: "\u2708\uFE0F",
                title: "Flight Tracking",
                desc: "OpenSky ADS-B live flights plus military aircraft via ADS-B Exchange. Altitudes, callsigns, speeds.",
                back: "Real-time positions from OpenSky Network. Military and unfiltered aircraft from ADS-B Exchange. Auto-refresh.",
                href: "/globe",
                btn: "Track Flights",
              },
              {
                emoji: "\uD83D\uDD0D",
                title: "Data Explorer",
                desc: "Discover ArcGIS REST services and query OpenStreetMap via Overpass API. Built-in query builder.",
                back: "ArcGIS service discovery with layer metadata. Overpass QL query builder with syntax help and examples.",
                href: "/explore",
                btn: "Explore Data",
              },
              {
                emoji: "\uD83D\uDD17",
                title: "CORS Proxy",
                desc: "Universal CORS proxy for external geospatial APIs. Pass any allowed URL and get proxied JSON.",
                back: "10s timeout, 30s cache. Supports USGS, NWS, OpenSky, Overpass, and custom whitelisted domains.",
                href: "/api/docs",
                btn: "View Proxy Docs",
              },
              {
                emoji: "\u26C8\uFE0F",
                title: "Weather Data",
                desc: "NWS warnings with polygon boundaries, NOAA NEXRAD radar mosaic, and hurricane track history.",
                back: "Color-coded NWS watches/warnings/advisories. Live radar mosaic. IBTrACS hurricane history with tracks.",
                href: "/globe",
                btn: "View Weather",
              },
              {
                emoji: "\uD83D\uDEF0\uFE0F",
                title: "Satellite Tracking",
                desc: "1,500+ active satellites from Celestrak TLE data, propagated to real-time positions using satellite.js.",
                back: "Real-time orbital propagation from TLE elements. Visible, communication, navigation, and more satellite groups.",
                href: "/globe",
                btn: "Track Satellites",
              },
              {
                emoji: "\uD83D\uDD13",
                title: "No Authentication",
                desc: "Completely free. No API keys, no rate limits, no sign-up or account required. Just query and go.",
                back: "Zero friction. No accounts, no tokens, no billing, no signup. Every endpoint is open and free to use.",
                href: "https://github.com/aliasfoxkde/OpenZenith",
                btn: "View on GitHub",
              },
              {
                emoji: "\uD83D\uDC68\u200D\uD83D\uDCBB",
                title: "Open Source",
                desc: "MIT-licensed, fully open source. Browse the code, submit PRs, or fork and self-host your own instance.",
                back: "MIT license on GitHub. Full transparency — every line of code is public. Contributions welcome.",
                href: "https://github.com/aliasfoxkde/OpenZenith",
                btn: "View Source",
              },
            ].map((f) => (
              <FlipCard
                key={f.title}
                cardBg={cardBg}
                border={border}
                height={150}
                front={
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.6rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem" }}>{f.emoji}</div>
                      <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, textAlign: "center" }}>
                        {f.title}
                      </h3>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8rem",
                        color: textSecondary,
                        lineHeight: 1.45,
                        textAlign: "center",
                      }}
                    >
                      {f.desc}
                    </p>
                  </>
                }
                back={
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}
                    >
                      {f.back}
                    </div>
                    <a
                      href={f.href}
                      target={f.href.startsWith("http") ? "_blank" : undefined}
                      rel={f.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      style={{
                        display: "inline-block",
                        padding: "0.4rem 1rem",
                        borderRadius: 6,
                        background: accent,
                        color: "#000",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {f.btn}
                    </a>
                  </div>
                }
              />
            ))}
            {/* No Ads, OpenAPI, Self-Hostable — same FlipCard pattern */}
            {[
              {
                emoji: "\uD83D\uDEAB",
                title: "No Ads Ever",
                desc: "Clean, distraction-free experience. No ads, no trackers, no popups. Just data and tools.",
                back: "Zero ads, zero tracking, zero popups. Focused on the data and tools, not monetization.",
                href: "https://github.com/aliasfoxkde/OpenZenith",
                btn: "View on GitHub",
              },
              {
                emoji: "\uD83D\uDCD6",
                title: "OpenAPI Spec",
                desc: "Full OpenAPI 3.0.3 documentation with interactive try-it panel, editable parameters, and code examples.",
                back: "Interactive docs with editable params and live Try-It. Code examples in cURL, JavaScript, and Python.",
                href: "/api/docs",
                btn: "Read the Docs",
              },
              {
                emoji: "\uD83D\uDEE0\uFE0F",
                title: "Self-Hostable",
                desc: "Deploy anywhere with Next.js + Cloudflare Pages. Data stored on HuggingFace or your own backend.",
                back: "Open source MIT license. Next.js 14 edge runtime. HuggingFace or custom chunk backend. One-click deploy.",
                href: "https://github.com/aliasfoxkde/OpenZenith",
                btn: "Get Source",
              },
            ].map((f) => (
              <FlipCard
                key={f.title}
                cardBg={cardBg}
                border={border}
                height={150}
                front={
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.6rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem" }}>{f.emoji}</div>
                      <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, textAlign: "center" }}>
                        {f.title}
                      </h3>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8rem",
                        color: textSecondary,
                        lineHeight: 1.45,
                        textAlign: "center",
                      }}
                    >
                      {f.desc}
                    </p>
                  </>
                }
                back={
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}
                    >
                      {f.back}
                    </div>
                    <a
                      href={f.href}
                      target={f.href.startsWith("http") ? "_blank" : undefined}
                      rel={f.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      style={{
                        display: "inline-block",
                        padding: "0.4rem 1rem",
                        borderRadius: 6,
                        background: accent,
                        color: "#000",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {f.btn}
                    </a>
                  </div>
                }
              />
            ))}
          </div>

          <p className="oz-disclaimer">This Application was Developed with TaskWizer AI technologies.</p>
        </section>
        <section style={{ maxWidth: W, margin: "0 auto", padding: "2.5rem 1.5rem 2.5rem" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.5rem", textAlign: "center" }}>
            Globe Data Layers
          </h2>
          <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.5rem", textAlign: "center" }}>
            Real-time geospatial intelligence overlays
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem" }}>
            {[
              {
                emoji: "\uD83D\uDD27",
                title: "Earthquakes",
                desc: "USGS real-time seismic data with magnitude, depth, and event details.",
                back: "Auto-refreshes every 60s. Color-coded by magnitude. Click for event details including depth and location.",
                color: "#ef4444",
              },
              {
                emoji: "\uD83C\uDF27\uFE0F",
                title: "Weather Radar",
                desc: "RainViewer NEXRAD radar mosaic with precipitation intensity overlays.",
                back: "Live NEXRAD composite radar with transparency. Zoom-dependent tile resolution for performance.",
                color: "#3b82f6",
              },
              {
                emoji: "\u2708\uFE0F",
                title: "Flight Tracking",
                desc: "OpenSky ADS-B live aircraft positions, altitudes, call signs.",
                back: "15-second refresh cycle. Shows altitude, speed, heading, callsign. Hover for flight details.",
                color: "#f59e0b",
              },
              {
                emoji: "\uD83D\uDEE1\uFE0F",
                title: "Military Flights",
                desc: "ADS-B Exchange unfiltered aircraft data. Military, government, private.",
                back: "Includes military, government, and private aircraft not visible on commercial trackers.",
                color: "#ec4899",
              },
              {
                emoji: "\uD83D\uDEA2",
                title: "Vessel Tracking",
                desc: "AIS vessel positions and marine weather data from Open-Meteo API.",
                back: "Marine vessel positions from AIS data. Wave height, wind speed, and temperature overlays.",
                color: "#3b82f6",
              },
              {
                emoji: "\u26A0\uFE0F",
                title: "Weather Warnings",
                desc: "NWS watches, warnings, and advisories with polygon boundaries.",
                back: "Color-coded by severity. Polygon boundaries from NOAA via ArcGIS. US-only coverage.",
                color: "#a855f7",
              },
              {
                emoji: "\uD83C\uDF0B",
                title: "Natural Events",
                desc: "NASA EONET events: volcanoes, wildfires, icebergs, landslides.",
                back: "Volcanoes, wildfires, icebergs, landslides, floods, droughts, and more from NASA Earth Observatory.",
                color: "#f97316",
              },
              {
                emoji: "\uD83D\uDEF0\uFE0F",
                title: "Satellites",
                desc: "1,500+ active satellites from Celestrak. Real-time orbital positions.",
                back: "SGP4 propagation via satellite.js. Grouped by type: visible, communication, navigation, science.",
                color: "#06b6d4",
              },
              {
                emoji: "\uD83C\uDF2A\uFE0F",
                title: "Hurricanes",
                desc: "IBTrACS tropical cyclone tracks with category-based color coding.",
                back: "Historical and active tropical cyclone tracks. Category 1\u20135 color coding with wind speed data.",
                color: "#ff6600",
              },
              {
                emoji: "\u26F0\uFE0F",
                title: "Hillshade & 3D",
                desc: "Terrain hillshade rendering with Copernicus GLO-30 land elevation and 3D globe.",
                back: "Client-side hillshade from our elevation tiles. 3D terrain extrusion on the CesiumJS globe.",
                color: "#22c55e",
              },
              {
                emoji: "\uD83C\uDFA8",
                title: "Elevation Color",
                desc: "Color-coded elevation grid sampled from the global elevation API.",
                back: "Low-to-high gradient from deep green through yellow to brown and white for peaks.",
                color: "#8b5cf6",
              },
              {
                emoji: "\uD83D\uDCF8",
                title: "NASA Satellite",
                desc: "MODIS Terra true-color imagery from NASA GIBS. Global daily coverage.",
                back: "Daily true-color composite from MODIS Terra satellite. Global coverage via NASA GIBS tiles.",
                color: "#0ea5e9",
              },
            ].map((d) => (
              <FlipCard
                key={d.title}
                cardBg={cardBg}
                border={border}
                height={130}
                front={
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                      <div style={{ fontSize: "1.3rem" }}>{d.emoji}</div>
                      <h3 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600 }}>{d.title}</h3>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.78rem", color: textSecondary, lineHeight: 1.4 }}>{d.desc}</p>
                  </>
                }
                back={
                  <>
                    <div
                      style={{ fontSize: "0.78rem", color: textSecondary, lineHeight: 1.5, marginBottom: "0.75rem" }}
                    >
                      {d.back}
                    </div>
                    <a
                      href="/worldview"
                      style={{
                        display: "inline-block",
                        padding: "0.35rem 0.85rem",
                        borderRadius: 6,
                        background: d.color,
                        color: "#fff",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        textDecoration: "none",
                        textAlign: "center",
                      }}
                    >
                      View on Globe
                    </a>
                  </>
                }
              />
            ))}
          </div>
        </section>

        {/* Contribute & Integrations */}
        <section style={{ maxWidth: W, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
            <FlipCard
              key="contribute"
              cardBg={cardBg}
              border={border}
              height={120}
              front={
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                    <div style={{ fontSize: "1.5rem" }}>\uD83D\uDCE4</div>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Contribute Data</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.82rem", color: textSecondary, lineHeight: 1.5 }}>
                    Add your own geospatial data to OpenZenith. Upload files, integrate data sources, or submit pull
                    requests. Supports GeoJSON, GeoTIFF, CSV, and more.
                  </p>
                </>
              }
              back={
                <>
                  <div style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}>
                    Submit data via the contribute page, open a GitHub issue, or send a pull request. We support
                    GeoJSON, GeoTIFF, CSV, Shapefile, and custom formats.
                  </div>
                  <a
                    href="/contribute"
                    style={{
                      display: "inline-block",
                      padding: "0.4rem 1rem",
                      borderRadius: 6,
                      background: accent,
                      color: "#000",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      textAlign: "center",
                    }}
                  >
                    Contribute Now
                  </a>
                </>
              }
            />
            <FlipCard
              key="integrations"
              cardBg={cardBg}
              border={border}
              height={120}
              front={
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                    <div style={{ fontSize: "1.5rem" }}>\uD83D\uDD27</div>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Integrations &amp; Tools</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.82rem", color: textSecondary, lineHeight: 1.5 }}>
                    OpenAPI spec, CORS proxy, MapLibre GL elevation tiles, and Overpass API proxy. Integrate elevation
                    into your own maps and apps in minutes.
                  </p>
                </>
              }
              back={
                <>
                  <div style={{ fontSize: "0.82rem", color: textSecondary, lineHeight: 1.55, marginBottom: "0.85rem" }}>
                    MapLibre GL JS, Leaflet, deck.gl, CesiumJS &mdash; any map library works with our Terrarium-encoded
                    tiles. Full OpenAPI spec for programmatic access.
                  </div>
                  <a
                    href="/api/docs"
                    style={{
                      display: "inline-block",
                      padding: "0.4rem 1rem",
                      borderRadius: 6,
                      background: "#a855f7",
                      color: "#fff",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      textAlign: "center",
                    }}
                  >
                    View API Docs
                  </a>
                </>
              }
            />
          </div>
        </section>

        {/* Community */}
        <section
          id="community"
          style={{
            maxWidth: W,
            margin: "0 auto",
            padding: "0 1.5rem 2rem",
            borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
            paddingTop: "2rem",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.4rem", textAlign: "center" }}>Community</h2>
          <p style={{ fontSize: "0.85rem", color: textSecondary, margin: "0 0 1.25rem", textAlign: "center" }}>
            Share your tools, maps, and projects
          </p>
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: "2rem 2.5rem",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: `linear-gradient(90deg, #22c55e, #3b82f6, #f59e0b)`,
              }}
            />
            <p
              style={{
                fontSize: "0.92rem",
                color: textSecondary,
                maxWidth: 680,
                margin: "0 auto 1.75rem",
                textAlign: "center",
                lineHeight: 1.65,
              }}
            >
              Built something with OpenZenith? We want to see it. Whether it's a custom map visualization, a mobile app,
              a research tool, or an integration with another platform &mdash; share it with the community.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
                marginBottom: "1.75rem",
              }}
            >
              {[
                {
                  icon: "\uD83D\uDDFA\uFE0F",
                  title: "Maps & Visualizations",
                  desc: "Custom web maps, dashboards, terrain renderings, 3D flythroughs, or any visual project using our elevation or tile data.",
                },
                {
                  icon: "\uD83D\uDCF1",
                  title: "Apps & Integrations",
                  desc: "Mobile apps, desktop tools, CLI utilities, or plugins that query the API or display elevation data.",
                },
                {
                  icon: "\uD83D\uDCCA",
                  title: "Research & Analysis",
                  desc: "Scientific papers, environmental studies, geology surveys, or academic projects leveraging the dataset.",
                },
                {
                  icon: "\uD83D\uDC68\u200D\uD83C\uDFA8",
                  title: "Tutorials & Guides",
                  desc: "Blog posts, YouTube videos, notebooks, or documentation that helps others use OpenZenith.",
                },
              ].map((item) => (
                <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: accentDim,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.1rem",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.1rem" }}>{item.title}</div>
                    <div style={{ fontSize: "0.8rem", color: textSecondary, lineHeight: 1.45 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a
                href="https://github.com/aliasfoxkde/OpenZenith/discussions"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.6rem 1.4rem",
                  borderRadius: 8,
                  background: cardBg,
                  color: text,
                  textDecoration: "none",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  border: `1px solid ${border}`,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Share on GitHub
              </a>
              <a
                href="https://github.com/aliasfoxkde/OpenZenith/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.6rem 1.4rem",
                  borderRadius: 8,
                  background: accent,
                  color: "#000",
                  textDecoration: "none",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                Submit an Issue
              </a>
            </div>
          </div>
        </section>

        {/* API Quickstart */}
        <section
          style={{
            maxWidth: W,
            margin: "0 auto",
            padding: "0 1.5rem 2rem",
            borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
            paddingTop: "2rem",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 1.25rem", textAlign: "center" }}>
            Quick start
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div
              style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
            >
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Elevation lookup</div>
              <CodeBlock
                dark={dark}
                code={`GET /api/elevation?lat={lat}&lon={lon}\n\n# Mount Everest\ncurl "https://openzenith.cyopsys.com/api/elevation?lat=28.0&lon=86.9"\n\n{"elevation": 8233, "unit": "meters", "surface_type": "land", "tile": "8/217/151"}`}
              >
                <div>
                  <span style={{ color: accent }}>GET</span>{" "}
                  <span style={{ color: textSecondary }}>
                    /api/elevation?lat=&#123;lat&#125;&amp;lon=&#123;lon&#125;
                  </span>
                </div>
                <div style={{ marginTop: "0.3rem" }}>
                  <span style={{ color: textSecondary }}># Mount Everest</span>
                </div>
                <div>
                  <span style={{ color: accent }}>curl</span>{" "}
                  <span style={{ color: text }}>
                    "https://openzenith.cyopsys.com/api/elevation?lat=28.0&amp;lon=86.9"
                  </span>
                </div>
                <div
                  style={{ marginTop: "0.3rem" }}
                >{`{"elevation": 8233, "unit": "meters", "surface_type": "land", "tile": "8/217/151"}`}</div>
              </CodeBlock>
            </div>
            <div
              style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
            >
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>JavaScript</div>
              <CodeBlock
                dark={dark}
                code={`const res = await fetch('/api/elevation?lat=48.8566&lon=2.3522')\nconst { elevation } = await res.json()`}
              >
                <div>
                  <span style={{ color: "#c678dd" }}>const</span> res ={" "}
                  <span style={{ color: textSecondary }}>await</span> <span style={{ color: "#61afef" }}>fetch</span>(
                  <span style={{ color: "#98c379" }}>'/api/elevation?lat=48.8566&amp;lon=2.3522'</span>)
                </div>
                <div>
                  <span style={{ color: "#c678dd" }}>const</span> &#123; elevation &#125; ={" "}
                  <span style={{ color: textSecondary }}>await</span> res.json()
                </div>
              </CodeBlock>
            </div>
            <div
              style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}
            >
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Python</div>
              <CodeBlock
                dark={dark}
                code={`import requests\n\nres = requests.get(\n    "https://openzenith.cyopsys.com/api/elevation",\n    params={"lat": 48.8566, "lon": 2.3522})\ndata = res.json()\nprint(data["elevation"])  # 35`}
              >
                <div>
                  <span style={{ color: "#c678dd" }}>import</span> requests
                </div>
                <div style={{ marginTop: "0.3rem" }}>
                  res = requests.<span style={{ color: "#61afef" }}>get</span>(
                  <span style={{ color: "#98c379" }}>"https://openzenith.cyopsys.com/api/elevation"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;&nbsp;&nbsp;params=&#123;<span style={{ color: "#98c379" }}>"lat"</span>:{" "}
                  <span style={{ color: "#d19a66" }}>48.8566</span>, <span style={{ color: "#98c379" }}>"lon"</span>:{" "}
                  <span style={{ color: "#d19a66" }}>2.3522</span>&#125;)
                </div>
                <div>data = res.json()</div>
                <div>
                  <span style={{ color: "#c678dd" }}>print</span>(data[
                  <span style={{ color: "#98c379" }}>"elevation"</span>])&nbsp;{" "}
                  <span style={{ color: textSecondary }}># 35</span>
                </div>
              </CodeBlock>
            </div>
          </div>
        </section>

        {/* Contact Form */}
        <GetInTouch dark={dark} />

        {/* Back to top */}
        {showTop && (
          <button
            onClick={scrollToTop}
            aria-label="Back to top"
            style={{
              position: "fixed",
              bottom: "1.5rem",
              right: "1.5rem",
              zIndex: 200,
              width: 40,
              height: 40,
              borderRadius: 10,
              background: cardBg,
              border: `1px solid ${border}`,
              color: text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
              transition: "opacity 0.2s",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M8 12V4M4 7l4-4 4 4" />
            </svg>
          </button>
        )}

        {/* Support / Donate */}
        <section
          style={{
            maxWidth: W,
            margin: "0 auto",
            padding: "2.5rem 1.5rem",
            borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`,
          }}
        >
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: "2rem 2.5rem",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: `linear-gradient(90deg, ${accent}, #3b82f6, #a855f7, ${accent})`,
              }}
            />
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem", letterSpacing: "-0.02em" }}>
              Help us push further
            </h2>
            <p
              style={{
                fontSize: "0.95rem",
                color: textSecondary,
                maxWidth: 640,
                margin: "0 auto 1.5rem",
                lineHeight: 1.65,
              }}
            >
              OpenZenith runs on Cloudflare's free tier &mdash; no servers to maintain, minimal monthly costs. Elevation
              tiles live in Cloudflare R2 (~1.7GB), API responses are cached at the edge, and everything else executes
              in your browser. That keeps it free for everyone, but it also means we're limited by what edge functions
              and client-side compute can do.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
                maxWidth: 720,
                margin: "0 auto 2rem",
                textAlign: "left",
              }}
            >
              {[
                {
                  icon: "D",
                  title: "Dedicated Hardware",
                  desc: "Run heavy data processing (viewshed analysis, water flow simulation, slope computation) on a real GPU server instead of trying to do it in your browser tab.",
                },
                {
                  icon: "S",
                  title: "Self-Hosted Services",
                  desc: "Deploy our own ADS-B receiver, AIS antenna, and weather stations for live, local data that doesn't depend on third-party rate limits.",
                },
                {
                  icon: "M",
                  title: "Mapping Tools",
                  desc: "Build proper elevation profiling, contour generation, flood simulation, and terrain analysis tools that go beyond what edge functions can handle.",
                },
                {
                  icon: "U",
                  title: "User Accounts",
                  desc: "Save preferences, bookmarks, and custom maps across devices. Higher API rate limits for registered users. Requires a database and auth infrastructure.",
                },
                {
                  icon: "F",
                  title: "Further Development",
                  desc: "3D terrain flythroughs, real-time hurricane spaghetti models, vessel tracking, and all the features we have planned.",
                },
              ].map((item) => (
                <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: accentDim,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: accent,
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.15rem" }}>{item.title}</div>
                    <div style={{ fontSize: "0.78rem", color: textSecondary, lineHeight: 1.45 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: "0.8rem", color: textSecondary, marginBottom: "1.25rem", lineHeight: 1.5 }}>
              Every contribution directly funds hardware, data processing, and new features. No middlemen, no platform
              fees &mdash; just geospatial tools that keep getting better. User accounts and persistence are on the
              roadmap once we prove out the platform and understand what people need.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a
                href="https://github.com/sponsors/aliasfoxkde"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.6rem 1.4rem",
                  borderRadius: 8,
                  background: "#000",
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  border: dark ? "1px solid #333" : "1px solid #ddd",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Sponsor on GitHub
              </a>
              <a
                href="https://ko-fi.com/aliasfoxkde"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.6rem 1.4rem",
                  borderRadius: 8,
                  background: "#ff5e5b",
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                Ko-fi
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <Footer dark={dark} />
      </div>
    </ErrorBoundary>
  );
}
