"use client";

import { useState } from "react";

export default function Home() {
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

  async function lookup() {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (isNaN(la) || isNaN(lo)) {
      setError("Enter valid numbers");
      return;
    }
    if (la < -56 || la > 60 || lo < -180 || lo > 180) {
      setError("Out of SRTM coverage (lat -56 to 60, lon -180 to 180)");
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

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>
          OpenZenith
        </h1>
        <p style={{ color: "#666", fontSize: "1.1rem" }}>
          Free global elevation data API
        </p>
      </div>

      <div
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 12,
          padding: "2rem",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Try it</h2>
        <p style={{ color: "#666" }}>
          Enter coordinates to look up elevation. SRTM 30m coverage: lat
          -56 to 60, lon -180 to 180.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="Latitude (e.g. 28.5)"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            style={{
              flex: 1,
              padding: "0.5rem",
              fontSize: "1rem",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
          <input
            type="text"
            placeholder="Longitude (e.g. 96.5)"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            style={{
              flex: 1,
              padding: "0.5rem",
              fontSize: "1rem",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={lookup}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "1rem",
              borderRadius: 6,
              border: "none",
              background: "#111",
              color: "#fff",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "..." : "Lookup"}
          </button>
        </div>

        {error && (
          <p style={{ color: "#c00", margin: 0 }}>{error}</p>
        )}

        {result && (
          <div
          style={{
            background: "#f8f8f8",
            borderRadius: 8,
            padding: "1rem",
            fontFamily: "monospace",
          }}
        >
            <div>
              <span style={{ color: "#666" }}>Elevation: </span>
              <strong>
                {result.elevation !== null
                  ? `${result.elevation} ${result.unit}`
                  : "No data"}
              </strong>
            </div>
            <div>
              <span style={{ color: "#666" }}>Source: </span>
              {result.srtmTile}
            </div>
            <div>
              <span style={{ color: "#666" }}>Location: </span>
              {result.location.lat}, {result.location.lon}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: "1.5rem",
          }}
        >
          <h3 style={{ marginTop: 0 }}>API</h3>
          <code
            style={{
              display: "block",
              background: "#f0f0f0",
              padding: "0.75rem",
              borderRadius: 6,
              fontSize: "0.85rem",
              wordBreak: "break-all",
            }}
          >
            GET /api/elevation?lat=28.5&amp;lon=96.5
          </code>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Returns JSON with elevation in meters.
          </p>
        </div>

        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: "1.5rem",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Interactive Map</h3>
          <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Hillshade visualization with click-to-query elevation.
          </p>
          <a
            href="/demo"
            style={{
              display: "inline-block",
              padding: "0.4rem 0.8rem",
              background: "#111",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: "0.85rem",
            }}
          >
            Open Map
          </a>
        </div>

        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: "1.5rem",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Links</h3>
          <ul style={{ paddingLeft: "1.2rem", color: "#333" }}>
            <li>
              <a href="/api/health">Health check</a>
            </li>
            <li>
              <a href="/api/docs">API documentation</a>
            </li>
          </ul>
        </div>
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "1.5rem",
          background: "#f8f8f8",
          borderRadius: 12,
          fontSize: "0.85rem",
          color: "#666",
        }}
      >
        <strong>Data source:</strong> NASA SRTM 30m Global DEM (14,296 tiles,
        65.2 GB) | <strong>Resolution:</strong> ~30 meters |{" "}
        <strong>Coverage:</strong> 80% of land surface between 56 S and 60 N
      </div>
    </div>
  );
}
