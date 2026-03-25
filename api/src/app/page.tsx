"use client";

import { useState, useEffect, useRef } from "react";

/* ─── Helpers ─── */

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

function elevationToTerrarium(data: Int16Array): Uint8Array {
  const pixels = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const elev = data[i];
    if (elev === -32768) {
      pixels[i * 4 + 3] = 0;
    } else {
      const h = elev + 32768;
      pixels[i * 4] = (h / 256) | 0;
      pixels[i * 4 + 1] = h % 256;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 255;
    }
  }
  return pixels;
}

function waitForMapLibre(timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.maplibregl) return resolve(w.maplibregl);
    const start = Date.now();
    const iv = setInterval(() => {
      if (w.maplibregl) { clearInterval(iv); resolve(w.maplibregl); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error("MapLibre GL failed to load")); }
    }, 100);
  });
}

/* ─── Logo ─── */

const LOGO = (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
    <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
    <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
    <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
  </svg>
);

/* ─── Main Page ─── */

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
  const [mapLoading, setMapLoading] = useState(true);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const miniMapInstance = useRef<any>(null);

  const bg = dark ? "#0a0a0a" : "#fafafa";
  const cardBg = dark ? "#161616" : "#ffffff";
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#888" : "#737373";
  const accent = "#22c55e";
  const accentDim = dark ? "rgba(34,197,94,0.12)" : "#dcfce7";
  const codeBg = dark ? "#1a1a1a" : "#f5f5f5";
  const inputBg = dark ? "#111" : "#fff";

  // Init mini map
  useEffect(() => {
    if (!miniMapRef.current || miniMapInstance.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mlgl = await waitForMapLibre();
        if (cancelled || !miniMapRef.current) return;

        const map = new mlgl.Map({
          container: miniMapRef.current,
          style: {
            version: 8,
            sources: {
              osm: { type: "raster", tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"], tileSize: 256, attribution: "&copy; CartoDB" },
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
          mlgl.addProtocol("elevation", async (params: any, callback: any) => {
            const { z, x, y } = params;
            try {
              const res = await fetch(`/api/tile/${z}/${x}/${y}`);
              if (!res.ok) { callback(null, null, null); return { cancel: () => {} }; }
              const buffer = await res.arrayBuffer();
              const int16 = new Int16Array(buffer);
              const terrarium = elevationToTerrarium(int16);
              const canvas = document.createElement("canvas");
              canvas.width = 256; canvas.height = 256;
              const ctx = canvas.getContext("2d")!;
              const img = ctx.createImageData(256, 256);
              img.data.set(terrarium);
              ctx.putImageData(img, 0, 0);
              canvas.toBlob((blob: Blob | null) => {
                if (blob) callback(null, blob, null, null);
                else callback(new Error("Tile error"));
              }, "image/png");
              return { cancel: () => {} };
            } catch (err) { callback(err); return { cancel: () => {} }; }
          });

          map.addSource("elevation", { type: "raster-dem", tiles: ["elevation://{z}/{x}/{y}"], tileSize: 256, maxzoom: 6, encoding: "terrarium" });
          map.addLayer({
            id: "hillshade",
            type: "hillshade",
            source: "elevation",
            paint: { "hillshade-shadow-color": "#000", "hillshade-highlight-color": "#fff", "hillshade-exaggeration": 0.4, "hillshade-direction": 315 },
          }, "osm");
          setMapLoading(false);
        });

        miniMapInstance.current = map;
      } catch {
        setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (miniMapInstance.current) { miniMapInstance.current.remove(); miniMapInstance.current = null; }
    };
  }, []);

  async function lookup() {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (isNaN(la) || isNaN(lo)) { setError("Enter valid coordinates"); return; }
    if (la < -60 || la > 60 || lo < -180 || lo > 180) { setError("Out of SRTM coverage (lat -60 to 60)"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/elevation?lat=${la}&lon=${lo}`);
      const data = await res.json();
      if (data.error) { setError(data.error); setResult(null); } else { setResult(data); }
    } catch { setError("Failed to fetch elevation data"); setResult(null); }
    finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: "0.55rem 0.75rem", fontSize: "0.9rem", borderRadius: 6,
    border: `1px solid ${border}`, background: inputBg, color: text, outline: "none",
    fontFamily: "inherit", minWidth: 0,
  };

  return (
    <div style={{ background: bg, color: text, minHeight: "100vh", fontFamily: "inherit" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: bg, borderBottom: `1px solid ${border}`, backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0.7rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: "0.4rem", textDecoration: "none", color: text }}>
            {LOGO}
            <span style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>OpenZenith</span>
          </a>
          <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }}>
            <a href="/map" style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}>Map</a>
            <a href="/worldview" style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}>WorldView</a>
            <a href="/explore" style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}>Explore</a>
            <a href="/api/docs" style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}>Docs</a>
            <a href="/api/health" style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem" }}>Status</a>
            <a href="https://github.com/aliasfoxkde/OpenZenith" target="_blank" rel="noopener noreferrer"
              style={{ color: textSecondary, textDecoration: "none", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              GitHub
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "3rem 1.5rem 1rem", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0.7rem", borderRadius: 100, background: accentDim, color: accent, fontSize: "0.75rem", fontWeight: 500, marginBottom: "1.25rem" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, display: "inline-block" }} />
          Open source &middot; No API key required
        </div>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 0.75rem", lineHeight: 1.15 }}>
          Free global elevation API
        </h1>
        <p style={{ fontSize: "1.05rem", color: textSecondary, maxWidth: 520, margin: "0 auto 2rem", lineHeight: 1.6 }}>
          Query any point on Earth for elevation. NASA SRTM 30m, 14,296 tiles, ~30m resolution, 80% land coverage.
        </p>

        {/* Elevation lookup */}
        <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem", maxWidth: 520, margin: "0 auto", textAlign: "left" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <input type="text" placeholder="Latitude (28.0)" value={lat} onChange={(e) => setLat(e.target.value)} style={inputStyle} onKeyDown={(e) => e.key === "Enter" && lookup()} />
            <input type="text" placeholder="Longitude (86.9)" value={lon} onChange={(e) => setLon(e.target.value)} style={inputStyle} onKeyDown={(e) => e.key === "Enter" && lookup()} />
            <button onClick={lookup} disabled={loading} style={{
              padding: "0.55rem 1.1rem", fontSize: "0.9rem", fontWeight: 500, borderRadius: 6,
              border: "none", background: accent, color: "#000", cursor: loading ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}>
              {loading ? "..." : "Lookup"}
            </button>
          </div>
          {error && <p style={{ color: "#ef4444", margin: "0 0 0.4rem", fontSize: "0.85rem" }}>{error}</p>}
          {result && (
            <div style={{ background: codeBg, borderRadius: 8, padding: "0.6rem 0.8rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
              <div><span style={{ color: textSecondary }}>elevation </span><span style={{ color: accent }}>{result.elevation !== null ? `${result.elevation.toLocaleString()}m` : "null"}</span></div>
              <div><span style={{ color: textSecondary }}>tile </span><span style={{ color: text }}>{result.srtmTile}</span></div>
              <div><span style={{ color: textSecondary }}>coords </span><span style={{ color: text }}>{result.location.lat}, {result.location.lon}</span></div>
            </div>
          )}
        </div>
      </section>

      {/* Mini map */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${border}`, height: 340 }}>
          <div ref={miniMapRef} style={{ width: "100%", height: "100%" }} />
          {mapLoading && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(0,0,0,0.7)", color: "#22c55e", padding: "0.5rem 1rem", borderRadius: 6, fontSize: "0.85rem" }}>
              Loading elevation map...
            </div>
          )}
          <a href="/map" style={{
            position: "absolute", bottom: "0.75rem", right: "0.75rem",
            background: "rgba(0,0,0,0.7)", color: "#ccc", padding: "0.4rem 0.8rem",
            borderRadius: 6, fontSize: "0.8rem", textDecoration: "none",
            border: "1px solid #333", backdropFilter: "blur(8px)",
          }}>
            Open Full Map &rarr;
          </a>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "0 1.5rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem" }}>
          {[
            { label: "Data tiles", value: "14,296" },
            { label: "Resolution", value: "~30m" },
            { label: "Land coverage", value: "80%" },
            { label: "Lat range", value: "60°N–60°S" },
          ].map((s) => (
            <div key={s.label} style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 10, padding: "0.75rem 1rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 700, color: accent, marginBottom: "0.15rem" }}>{s.value}</div>
              <div style={{ fontSize: "0.75rem", color: textSecondary }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "0 1.5rem 2rem", borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`, paddingTop: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 1.25rem", textAlign: "center" }}>Features</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          {[
            { title: "Elevation API", desc: "Query elevation by lat/lon. Returns height in meters with bilinear interpolation.", href: "/api/docs" },
            { title: "Tile Server", desc: "Slippy map tiles (z/x/y) serving raw Int16 elevation data, 256x256 per tile.", href: "/map" },
            { title: "Interactive Map", desc: "Dark theme, 3D terrain, multiple basemaps, layer controls, elevation pins.", href: "/map" },
            { title: "WorldView Dashboard", desc: "Real-time geospatial intelligence: flights, earthquakes, weather radar, satellites, hurricanes.", href: "/worldview" },
            { title: "Data Explorer", desc: "Discover ArcGIS REST services and query OpenStreetMap via Overpass API.", href: "/explore" },
            { title: "No Authentication", desc: "Completely free. No API keys, no rate limits, no sign-up required.", href: "https://github.com/aliasfoxkde/OpenZenith" },
            { title: "Health Endpoint", desc: "Real-time service status with backend info and coverage metadata.", href: "/api/health" },
            { title: "Self-Hostable", desc: "Deploy anywhere with Next.js. Data on HuggingFace or your own storage.", href: "https://github.com/aliasfoxkde/OpenZenith" },
          ].map((f) => (
            <a key={f.title} href={f.href} target={f.href.startsWith("http") ? "_blank" : undefined} rel={f.href.startsWith("http") ? "noopener noreferrer" : undefined}
              style={{ textDecoration: "none", color: "inherit", background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: accentDim, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.6rem", color: accent, fontSize: "0.85rem", fontWeight: 700 }}>
                {f.title[0]}
              </div>
              <h3 style={{ margin: "0 0 0.2rem", fontSize: "0.95rem", fontWeight: 600 }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: textSecondary, lineHeight: 1.45 }}>{f.desc}</p>
            </a>
          ))}
        </div>
      </section>

      {/* API Quickstart */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "0 1.5rem 2rem", borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}`, paddingTop: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 1.25rem", textAlign: "center" }}>Quick start</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Elevation lookup</div>
            <div style={{ background: codeBg, borderRadius: 8, padding: "0.8rem 1rem", fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.7, overflowX: "auto" }}>
              <div><span style={{ color: accent }}>GET</span> <span style={{ color: textSecondary }}>/api/elevation?lat=&#123;lat&#125;&amp;lon=&#123;lon&#125;</span></div>
              <div style={{ marginTop: "0.3rem" }}><span style={{ color: textSecondary }}># Mount Everest</span></div>
              <div><span style={{ color: accent }}>curl</span> <span style={{ color: text }}>"https://openzenith.pages.dev/api/elevation?lat=28.0&amp;lon=86.9"</span></div>
              <div style={{ marginTop: "0.3rem" }}>{`{"elevation": 8848, "unit": "meters", "srtmTile": "N28E086.tif"}`}</div>
            </div>
          </div>
          <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>JavaScript</div>
            <div style={{ background: codeBg, borderRadius: 8, padding: "0.8rem 1rem", fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.7, overflowX: "auto" }}>
              <div><span style={{ color: "#c678dd" }}>const</span> res = <span style={{ color: textSecondary }}>await</span> <span style={{ color: "#61afef" }}>fetch</span>(<span style={{ color: "#98c379" }}>'/api/elevation?lat=48.8566&amp;lon=2.3522'</span>)</div>
              <div><span style={{ color: "#c678dd" }}>const</span> &#123; elevation &#125; = <span style={{ color: textSecondary }}>await</span> res.json()</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ maxWidth: 1280, margin: "0 auto", padding: "1.5rem", borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.75rem", color: textSecondary }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>{LOGO}<span>OpenZenith</span></div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <a href="https://github.com/aliasfoxkde/OpenZenith" target="_blank" rel="noopener noreferrer" style={{ color: textSecondary, textDecoration: "none" }}>Source</a>
            <a href="/api/docs" style={{ color: textSecondary, textDecoration: "none" }}>Docs</a>
            <a href="/api/health" style={{ color: textSecondary, textDecoration: "none" }}>Status</a>
            <a href="/map" style={{ color: textSecondary, textDecoration: "none" }}>Map</a>
            <a href="/worldview" style={{ color: textSecondary, textDecoration: "none" }}>WorldView</a>
            <a href="/explore" style={{ color: textSecondary, textDecoration: "none" }}>Explore</a>
          </div>
          <span>NASA SRTM 30m Global DEM</span>
        </div>
      </footer>

      {/* Support / Donate */}
      <section style={{ maxWidth: 1280, margin: "0 auto", padding: "2.5rem 1.5rem", borderTop: `1px solid ${dark ? "#1a1a1a" : "#f0f0f0"}` }}>
        <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: "2rem 2.5rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${accent}, #3b82f6, #a855f7, ${accent})` }} />
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem", letterSpacing: "-0.02em" }}>Help us push further</h2>
          <p style={{ fontSize: "0.95rem", color: textSecondary, maxWidth: 600, margin: "0 auto 1.5rem", lineHeight: 1.65 }}>
            OpenZenith runs entirely client-side on Cloudflare's free tier &mdash; no servers, no databases, no monthly costs.
            That keeps it free for everyone, but it also means we're limited to what a browser can do.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", maxWidth: 720, margin: "0 auto 2rem", textAlign: "left" }}>
            {[
              { icon: "D", title: "Dedicated Hardware", desc: "Run heavy data processing (viewshed analysis, water flow simulation, slope computation) on a real GPU server instead of trying to do it in your browser tab." },
              { icon: "S", title: "Self-Hosted Services", desc: "Deploy our own ADS-B receiver, AIS antenna, and weather stations for live, local data that doesn't depend on third-party rate limits." },
              { icon: "M", title: "Mapping Tools", desc: "Build proper elevation profiling, contour generation, flood simulation, and terrain analysis tools that go beyond what edge functions can handle." },
              { icon: "F", title: "Further Development", desc: "Time to build the cool stuff: 3D terrain flythroughs, real-time hurricane spaghetti models, vessel tracking, and all the features we have planned." },
            ].map((item) => (
              <div key={item.title} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: accentDim, display: "flex", alignItems: "center", justifyContent: "center", color: accent, fontSize: "0.8rem", fontWeight: 700, flexShrink: 0 }}>
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
            Every contribution directly funds hardware, data processing, and new features. No middlemen, no platform fees &mdash; just geospatial tools that keep getting better.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="https://github.com/sponsors/aliasfoxkde" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.4rem", borderRadius: 8,
              background: "#000", color: "#fff", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500,
              border: dark ? "1px solid #333" : "1px solid #ddd",
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              Sponsor on GitHub
            </a>
            <a href="https://ko-fi.com/aliasfoxkde" target="_blank" rel="noopener noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.4rem", borderRadius: 8,
              background: "#ff5e5b", color: "#fff", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500,
            }}>
              Ko-fi
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
