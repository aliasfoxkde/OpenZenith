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
      {/* Hero */}
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "5rem 1.5rem 3rem",
          textAlign: "center",
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.6rem",
            marginBottom: "1.5rem",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path
              d="M16 2L28 28H4L16 2Z"
              fill={accent}
              opacity="0.9"
            />
            <path
              d="M16 2L22 15H10L16 2Z"
              fill={accent}
              opacity="0.5"
            />
            <path d="M4 28L16 18L28 28H4Z" fill={accent} opacity="0.3" />
          </svg>
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: text,
            }}
          >
            OpenZenith
          </span>
        </div>

        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3rem)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            margin: "0 0 0.75rem",
            lineHeight: 1.15,
            color: text,
          }}
        >
          Free global elevation API
        </h1>
        <p
          style={{
            fontSize: "1.1rem",
            color: textSecondary,
            maxWidth: 520,
            margin: "0 auto 3rem",
            lineHeight: 1.6,
          }}
        >
          Query any point on Earth for elevation data. Powered by NASA SRTM 30m
          global DEM — 14,296 tiles, ~30 meter resolution, 80% land coverage.
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
      </div>

      {/* Feature cards */}
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
        }}
      >
        {/* API */}
        <a
          href="/api/docs"
          style={{
            textDecoration: "none",
            color: "inherit",
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "1.5rem",
            display: "block",
            transition: "border-color 0.15s",
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
              fontSize: "1.1rem",
              fontWeight: 700,
            }}
          >
            /
          </div>
          <h3
            style={{
              margin: "0 0 0.3rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: text,
            }}
          >
            REST API
          </h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: textSecondary, lineHeight: 1.5 }}>
            Query elevation by coordinates. Returns JSON with meters MSL.
          </p>
        </a>

        {/* Map */}
        <a
          href="/demo"
          style={{
            textDecoration: "none",
            color: "inherit",
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "1.5rem",
            display: "block",
            transition: "border-color 0.15s",
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
              fontSize: "1.1rem",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </div>
          <h3
            style={{
              margin: "0 0 0.3rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: text,
            }}
          >
            Interactive Map
          </h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: textSecondary, lineHeight: 1.5 }}>
            Hillshade visualization with click-to-query elevation.
          </p>
        </a>

        {/* Health */}
        <a
          href="/api/health"
          style={{
            textDecoration: "none",
            color: "inherit",
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "1.5rem",
            display: "block",
            transition: "border-color 0.15s",
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <h3
            style={{
              margin: "0 0 0.3rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: text,
            }}
          >
            Health Check
          </h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: textSecondary, lineHeight: 1.5 }}>
            Service status, data source, and backend info.
          </p>
        </a>
      </div>

      {/* API Quickstart */}
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
        }}
      >
        <div
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: "1.5rem 2rem",
          }}
        >
          <h3
            style={{
              margin: "0 0 1rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: text,
            }}
          >
            Quick start
          </h3>
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
              <span style={{ color: textSecondary }}># Elevation lookup</span>
            </div>
            <div>
              <span style={{ color: accent }}>curl</span>{" "}
              <span style={{ color: text }}>&quot;https://openzenith.pages.dev/api/elevation?lat=28.0&amp;lon=86.9&quot;</span>
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <span style={{ color: textSecondary }}># Tile endpoint (slippy map z/x/y)</span>
            </div>
            <div>
              <span style={{ color: accent }}>curl</span>{" "}
              <span style={{ color: text }}>&quot;https://openzenith.pages.dev/api/tile/8/218/135&quot;</span>
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
              : <span style={{ color: "#f59e0b" }}>&quot;N28E086.tif&quot;</span> {"}"}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
        }}
      >
        <div
          style={{
            borderTop: `1px solid ${border}`,
            paddingTop: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
            fontSize: "0.8rem",
            color: textSecondary,
          }}
        >
          <span>
            Data: NASA SRTM 30m Global DEM &middot; 14,296 tiles &middot; ~30m resolution
          </span>
          <span>
            Hosted on Cloudflare Pages
          </span>
        </div>
      </div>
    </div>
  );
}
