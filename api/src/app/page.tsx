"use client";

import { useState, useEffect } from "react";

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

const LOGO = (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
    <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
    <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
  </svg>
);

export default function Home() {
  const dark = useTheme();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [result, setResult] = useState<{
    elevation: number | null;
    unit: string;
    srtmTile: string;
    location: { lat: number; lon: number };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#888" : "#737373";
  const accent = "#22c55e";
  const accentDim = dark ? "#166534" : "#dcfce7";
  const codeBg = dark ? "#1a1a1a" : "#f5f5f5";
  const inputBg = dark ? "#111" : "#fff";
  const sectionBorder = dark ? "#1a1a1a" : "#f0f0f0";

  async function lookup() {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (isNaN(la) || isNaN(lo)) {
      setError("Enter valid coordinates");
      return;
    }
    if (la < -60 || la > 60 || lo < -180 || lo > 180) {
      setError("Out of SRTM coverage (lat -60 to 60, lon -180 to 180)");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/elevation?lat=${la}&lon=${lo}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResult(null);
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to fetch elevation data");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "0.6rem 0.8rem",
    fontSize: "0.95rem",
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: inputBg,
    color: text,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        background: bg,
        color: text,
        minHeight: "100vh",
        fontFamily: "inherit",
      }}
    >
      {/* Nav bar */}
      <nav
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "1.2rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <a
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
            color: text,
          }}
        >
          {LOGO}
          <span style={{ fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.02em" }}>
            OpenZenith
          </span>
        </a>
        <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }}>
          <a
            href="/demo"
            style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem" }}
          >
            Map
          </a>
          <a
            href="/api/docs"
            style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem" }}
          >
            Docs
          </a>
          <a
            href="/api/health"
            style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem" }}
          >
            Status
          </a>
          <a
            href="https://github.com/aliasfoxkde/OpenZenith"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: textSecondary, textDecoration: "none", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "4rem 1.5rem 3rem",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.3rem 0.8rem",
            borderRadius: 100,
            background: accentDim,
            color: accent,
            fontSize: "0.8rem",
            fontWeight: 500,
            marginBottom: "1.5rem",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, display: "inline-block" }} />
          Open source &middot; No API key required
        </div>

        <h1
          style={{
            fontSize: "clamp(2.2rem, 5vw, 3.2rem)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: "0 0 1rem",
            lineHeight: 1.15,
            color: text,
          }}
        >
          Free global elevation API
        </h1>
        <p
          style={{
            fontSize: "1.15rem",
            color: textSecondary,
            maxWidth: 560,
            margin: "0 auto 3rem",
            lineHeight: 1.7,
          }}
        >
          Query any point on Earth for elevation data. Powered by NASA SRTM 30m
          global DEM with 14,296 tiles at approximately 30 meter resolution, covering
          80% of Earth&apos;s land surface.
        </p>

        {/* Elevation lookup card */}
        <div
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 16,
            padding: "1.5rem 2rem",
            maxWidth: 560,
            margin: "0 auto",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginBottom: "1rem",
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              placeholder="Latitude (e.g. 28.0)"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
            <input
              type="text"
              placeholder="Longitude (e.g. 86.9)"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
            <button
              onClick={lookup}
              disabled={loading}
              style={{
                padding: "0.6rem 1.2rem",
                fontSize: "0.95rem",
                fontWeight: 500,
                borderRadius: 8,
                border: "none",
                background: accent,
                color: "#000",
                cursor: loading ? "wait" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "..." : "Lookup"}
            </button>
          </div>

          {error && (
            <p style={{ color: "#ef4444", margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
              {error}
            </p>
          )}

          {result && (
            <div
              style={{
                background: codeBg,
                borderRadius: 10,
                padding: "0.8rem 1rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
              }}
            >
              <div>
                <span style={{ color: textSecondary }}>elevation </span>
                <span style={{ color: accent }}>
                  {result.elevation !== null
                    ? `${result.elevation.toLocaleString()}m`
                    : "null"}
                </span>
              </div>
              <div>
                <span style={{ color: textSecondary }}>tile </span>
                <span style={{ color: text }}>{result.srtmTile}</span>
              </div>
              <div>
                <span style={{ color: textSecondary }}>coords </span>
                <span style={{ color: text }}>
                  {result.location.lat}, {result.location.lon}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Stats bar */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
          }}
        >
          {[
            { label: "Data tiles", value: "14,296" },
            { label: "Resolution", value: "~30m" },
            { label: "Land coverage", value: "80%" },
            { label: "Lat coverage", value: "60\u00b0N\u201360\u00b0S" },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: cardBg,
                border: `1px solid ${border}`,
                borderRadius: 12,
                padding: "1rem 1.2rem",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: accent, marginBottom: "0.2rem" }}>
                {s.value}
              </div>
              <div style={{ fontSize: "0.8rem", color: textSecondary }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          borderTop: `1px solid ${sectionBorder}`,
          paddingTop: "3rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 1.5rem",
            textAlign: "center",
          }}
        >
          Features
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "1rem",
          }}
        >
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
            }
            title="Elevation API"
            description="Query elevation by latitude and longitude. Returns height in meters above sea level with SRTM tile reference."
            href="/api/docs"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
            }
            title="Tile Server"
            description="Slippy map tile endpoint (z/x/y) serving raw Int16 elevation data. Compatible with MapLibre, Leaflet, and custom renderers."
            href="/demo"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
            title="Interactive Map"
            description="Hillshade visualization with click-to-query elevation. Built on MapLibre GL with terrarium-encoded elevation tiles."
            href="/demo"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            }
            title="Slippy Map Tiles"
            description="Standard z/x/y tile pyramid format. Raw binary Int16 data, 256x256 pixels per tile, seamless zoom from 0 to 12."
            href="/api/tile/8/218/135"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            title="Health Endpoint"
            description="Real-time service status with backend info, data source details, and coverage metadata."
            href="/api/health"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
          <FeatureCard
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            }
            title="No Authentication"
            description="Completely free and open. No API keys, no rate limits, no sign-up required. Just query and go."
            href="https://github.com/aliasfoxkde/OpenZenith"
            cardBg={cardBg}
            border={border}
            text={text}
            textSecondary={textSecondary}
            accent={accent}
            accentDim={accentDim}
          />
        </div>
      </section>

      {/* Data source */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          borderTop: `1px solid ${sectionBorder}`,
          paddingTop: "3rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 1.5rem",
            textAlign: "center",
          }}
        >
          Data source
        </h2>
        <div
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "2rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {[
            {
              label: "Dataset",
              value: "NASA SRTM GL1 v3",
              note: "Shuttle Radar Topography Mission",
            },
            {
              label: "Resolution",
              value: "1 arc-second (~30m)",
              note: "Global DEM at 30 meter postings",
            },
            {
              label: "Coverage",
              value: "56\u00b0S \u2013 60\u00b0N",
              note: "~80% of Earth\u2019s land surface",
            },
            {
              label: "Tiles",
              value: "14,296 files",
              note: "1\u00b0 \u00d7 1\u00b0 degree tiles, 3601\u00d73601 pixels",
            },
            {
              label: "Format",
              value: "Int16 binary",
              note: "Raw elevation in meters, -32768 = nodata",
            },
            {
              label: "Vertical accuracy",
              value: "< 16m absolute",
              note: "< 10m relative (CE90/LE90)",
            },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: "0.75rem", color: textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.3rem" }}>
                {item.label}
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: text, marginBottom: "0.15rem" }}>
                {item.value}
              </div>
              <div style={{ fontSize: "0.8rem", color: textSecondary }}>
                {item.note}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* API Quickstart */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          borderTop: `1px solid ${sectionBorder}`,
          paddingTop: "3rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 1.5rem",
            textAlign: "center",
          }}
        >
          Quick start
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Elevation endpoint */}
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: "1.5rem 2rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: text, marginBottom: "0.75rem" }}>
              Elevation lookup
            </div>
            <div
              style={{
                background: codeBg,
                borderRadius: 10,
                padding: "1rem 1.2rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.8,
                overflowX: "auto",
              }}
            >
              <div>
                <span style={{ color: accent }}>GET</span>{" "}
                <span style={{ color: textSecondary }}>/api/elevation?lat={lat}&amp;lon={lon}</span>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ color: textSecondary }}># Example: Mount Everest</span>
              </div>
              <div>
                <span style={{ color: accent }}>curl</span>{" "}
                <span style={{ color: text }}>&quot;https://openzenith.pages.dev/api/elevation?lat=28.0&amp;lon=86.9&quot;</span>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ color: textSecondary }}># Response</span>
              </div>
              <div>
                {"{"}{" "}
                <span style={{ color: "#f59e0b" }}>&quot;elevation&quot;</span>
                : <span style={{ color: accent }}>8848</span>,{" "}
                <span style={{ color: "#f59e0b" }}>&quot;unit&quot;</span>
                : <span style={{ color: "#f59e0b" }}>&quot;m&quot;</span>,{" "}
                <span style={{ color: "#f59e0b" }}>&quot;srtmTile&quot;</span>
                : <span style={{ color: "#f59e0b" }}>&quot;N28E086.tif&quot;</span>,{" "}
                <span style={{ color: "#f59e0b" }}>&quot;location&quot;</span>
                : {"{"}{" "}
                <span style={{ color: "#f59e0b" }}>&quot;lat&quot;</span>: <span style={{ color: accent }}>28.0</span>,{" "}
                <span style={{ color: "#f59e0b" }}>&quot;lon&quot;</span>: <span style={{ color: accent }}>86.9</span>
                {" "}{"}"}
                {"}"}
              </div>
            </div>
          </div>

          {/* Tile endpoint */}
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: "1.5rem 2rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: text, marginBottom: "0.75rem" }}>
              Tile endpoint
            </div>
            <div
              style={{
                background: codeBg,
                borderRadius: 10,
                padding: "1rem 1.2rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.8,
                overflowX: "auto",
              }}
            >
              <div>
                <span style={{ color: accent }}>GET</span>{" "}
                <span style={{ color: textSecondary }}>/api/tile/&#123;z&#125;/&#123;x&#125;/&#123;y&#125;</span>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ color: textSecondary }}># Returns: raw Int16 binary (256x256 grid)</span>
              </div>
              <div>
                <span style={{ color: textSecondary }}># Each pixel = 2 bytes (signed 16-bit int, meters MSL)</span>
              </div>
              <div>
                <span style={{ color: textSecondary }}># Nodata = -32768</span>
              </div>
            </div>
          </div>

          {/* JavaScript example */}
          <div
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: "1.5rem 2rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: text, marginBottom: "0.75rem" }}>
              JavaScript example
            </div>
            <div
              style={{
                background: codeBg,
                borderRadius: 10,
                padding: "1rem 1.2rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.8,
                overflowX: "auto",
              }}
            >
              <div>
                <span style={{ color: "#c678dd" }}>const</span>{" "}
                <span style={{ color: text }}>res</span>{" "}
                <span style={{ color: textSecondary }}>=</span>{" "}
                <span style={{ color: textSecondary }}>await</span>{" "}
                <span style={{ color: "#61afef" }}>fetch</span>
                <span style={{ color: textSecondary }}>(</span>
                <span style={{ color: "#98c379" }}>&apos;/api/elevation?lat=48.8566&amp;lon=2.3522&apos;</span>
                <span style={{ color: textSecondary }}>)</span>
              </div>
              <div>
                <span style={{ color: "#c678dd" }}>const</span>{" "}
                <span style={{ color: text }}>data</span>{" "}
                <span style={{ color: textSecondary }}>=</span>{" "}
                <span style={{ color: textSecondary }}>await</span>{" "}
                <span style={{ color: text }}>res</span>
                <span style={{ color: textSecondary }}>{"."}</span>
                <span style={{ color: "#61afef" }}>json</span>
                <span style={{ color: textSecondary }}>{"()"}</span>
              </div>
              <div>
                <span style={{ color: text }}>console</span>
                <span style={{ color: textSecondary }}>{"."}</span>
                <span style={{ color: "#61afef" }}>log</span>
                <span style={{ color: textSecondary }}>(</span>
                <span style={{ color: text }}>data</span>
                <span style={{ color: textSecondary }}>{"."}</span>
                <span style={{ color: text }}>elevation</span>
                <span style={{ color: textSecondary }}>)</span>
                <span style={{ color: textSecondary }}>{"; "}</span>
                <span style={{ color: textSecondary }}>{"// 35"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          borderTop: `1px solid ${sectionBorder}`,
          paddingTop: "3rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 1.5rem",
            textAlign: "center",
          }}
        >
          How it works
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {[
            {
              step: "1",
              title: "Request",
              description: "Send coordinates via the REST API or click on the interactive map.",
            },
            {
              step: "2",
              title: "Tile lookup",
              description: "Coordinates are mapped to the corresponding SRTM 1\u00b0 tile and pixel offset.",
            },
            {
              step: "3",
              title: "Fetch data",
              description: "Tile data is fetched from HuggingFace storage as compressed binary chunks.",
            },
            {
              step: "4",
              title: "Response",
              description: "Elevation value is extracted via bilinear interpolation and returned as JSON.",
            },
          ].map((item) => (
            <div key={item.step} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: accentDim,
                  color: accent,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "1rem",
                  marginBottom: "0.75rem",
                }}
              >
                {item.step}
              </div>
              <div style={{ fontWeight: 600, marginBottom: "0.3rem", fontSize: "0.95rem" }}>
                {item.title}
              </div>
              <div style={{ fontSize: "0.85rem", color: textSecondary, lineHeight: 1.5 }}>
                {item.description}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          borderTop: `1px solid ${sectionBorder}`,
          paddingTop: "3rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 1.5rem",
            textAlign: "center",
          }}
        >
          Tech stack
        </h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            justifyContent: "center",
          }}
        >
          {[
            "Next.js 15",
            "Cloudflare Pages",
            "Edge Runtime",
            "TypeScript",
            "MapLibre GL",
            "NASA SRTM",
            "HuggingFace",
            "Terrarium Encoding",
          ].map((tag) => (
            <span
              key={tag}
              style={{
                padding: "0.4rem 0.9rem",
                borderRadius: 100,
                background: cardBg,
                border: `1px solid ${border}`,
                fontSize: "0.8rem",
                color: textSecondary,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "1.5rem 1.5rem 2rem",
          borderTop: `1px solid ${sectionBorder}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            fontSize: "0.8rem",
            color: textSecondary,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {LOGO}
            <span>OpenZenith</span>
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <a
              href="https://github.com/aliasfoxkde/OpenZenith"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: textSecondary, textDecoration: "none" }}
            >
              Source code
            </a>
            <a
              href="/api/docs"
              style={{ color: textSecondary, textDecoration: "none" }}
            >
              API docs
            </a>
            <a
              href="/api/health"
              style={{ color: textSecondary, textDecoration: "none" }}
            >
              Status
            </a>
          </div>
          <span>Data: NASA SRTM 30m Global DEM</span>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  href,
  cardBg,
  border,
  text,
  textSecondary,
  accent,
  accentDim,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentDim: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      style={{
        textDecoration: "none",
        color: "inherit",
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 14,
        padding: "1.5rem",
        display: "block",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: accentDim,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "0.75rem",
          color: accent,
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          margin: "0 0 0.3rem",
          fontSize: "1rem",
          fontWeight: 600,
          color: text,
        }}
      >
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: "0.85rem", color: textSecondary, lineHeight: 1.5 }}>
        {description}
      </p>
    </a>
  );
}
