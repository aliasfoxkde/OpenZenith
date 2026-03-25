"use client";

import { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GetInTouch } from "@/components/GetInTouch";

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

const S = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
.ab-wrap{position:relative;width:100vw;min-height:100vh;overflow-x:hidden;font-family:system-ui,-apple-system,sans-serif}
.ab-body{max-width:800px;margin:0 auto;padding:2rem 2rem 4rem}
.ab-body h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
.ab-body .sub{color:#888;font-size:0.85rem;margin:0 0 2.5rem;line-height:1.6}
.ab-body h2{font-size:1.05rem;font-weight:600;margin:2rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.ab-body h3{font-size:0.9rem;font-weight:600;margin:1.25rem 0 0.5rem}
.ab-body p{font-size:0.85rem;color:#888;line-height:1.7;margin:0.5rem 0}
.ab-body a{color:#4a9eff;text-decoration:none}
.ab-body a:hover{text-decoration:underline}
.ab-body code{background:rgba(74,158,255,0.1);color:#4a9eff;padding:0.1rem 0.3rem;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:0.82rem}
.ab-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:1.25rem;margin-bottom:0.75rem;transition:border-color .15s}
.ab-card:hover{border-color:rgba(255,255,255,0.12)}
.ab-card .icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.9rem;margin-bottom:0.5rem}
.ab-card .icon.green{background:rgba(34,197,94,0.12);color:#22c55e}
.ab-card .icon.blue{background:rgba(74,158,255,0.12);color:#4a9eff}
.ab-card .icon.purple{background:rgba(168,85,247,0.12);color:#a855f7}
.ab-card .icon.amber{background:rgba(234,179,8,0.12);color:#eab308}
.ab-card .icon.rose{background:rgba(244,63,94,0.12);color:#f43f5e}
.ab-card .icon.cyan{background:rgba(6,182,212,0.12);color:#06b6d4}
.ab-card h3{margin:0 0 0.2rem;font-size:0.9rem;font-weight:600}
.ab-card p{margin:0;color:#888;font-size:0.82rem;line-height:1.5}
.ab-stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.75rem;margin:1rem 0 2rem}
.ab-stat{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;text-align:center}
.ab-stat .num{font-size:1.5rem;font-weight:700;font-family:'JetBrains Mono',monospace;color:#22c55e}
.ab-stat .label{font-size:0.72rem;color:#666;margin-top:0.25rem}
.ab-timeline{position:relative;padding-left:2rem;margin:1rem 0}
.ab-timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.08)}
.ab-timeline-item{position:relative;margin-bottom:1.5rem}
.ab-timeline-item::before{content:'';position:absolute;left:-2rem;top:0.35rem;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #0a0a0a}
.ab-timeline-item h4{margin:0 0 0.15rem;font-size:0.85rem;font-weight:600;color:#ccc}
.ab-timeline-item p{margin:0;font-size:0.8rem;color:#666;line-height:1.5}
.ab-tech-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.5rem;margin:0.75rem 0}
.ab-tech-tag{padding:0.4rem 0.7rem;font-size:0.78rem;background:rgba(255,255,255,0.03);color:#888;border:1px solid rgba(255,255,255,0.06);border-radius:6px;text-align:center;font-family:'JetBrains Mono',monospace}
@media(max-width:768px){
  .ab-body{padding:1rem 1.25rem 3rem}
  .ab-stat-grid{grid-template-columns:repeat(2,1fr)}
}
`;

export default function AboutPage() {
  const dark = useTheme();

  return (
    <div className="ab-wrap" style={{ background: dark ? "#0a0a0a" : "#fafafa", color: dark ? "#e5e5e5" : "#171717" }}>
      <style dangerouslySetInnerHTML={{ __html: S }} />

      <Navbar dark breadcrumb="About" />

      <div className="ab-body">
        <h1>About OpenZenith</h1>
        <p className="sub">
          A free, open-source geospatial platform providing global elevation data, interactive maps, and geospatial APIs
          &mdash; powered by NASA SRTM 30m data and served on Cloudflare&apos;s global edge network.
        </p>

        {/* Stats */}
        <div className="ab-stat-grid">
          <div className="ab-stat">
            <div className="num">30m</div>
            <div className="label">Resolution</div>
          </div>
          <div className="ab-stat">
            <div className="num">Global</div>
            <div className="label">Coverage</div>
          </div>
          <div className="ab-stat">
            <div className="num">Free</div>
            <div className="label">No API Key</div>
          </div>
          <div className="ab-stat">
            <div className="num">Edge</div>
            <div className="label">Cloudflare CDN</div>
          </div>
          <div className="ab-stat">
            <div className="num">Open</div>
            <div className="label">MIT License</div>
          </div>
        </div>

        {/* Mission */}
        <h2>Mission</h2>
        <p>
          OpenZenith exists to make elevation and geospatial data accessible to everyone. No API keys, no rate limits on
          basic queries, no paywalls. Whether you&apos;re building a hiking app, researching terrain, or just curious
          about the elevation where you stand &mdash; the data is free and fast.
        </p>

        {/* Core Features */}
        <h2>What We Offer</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <div className="ab-card">
            <div className="icon green">E</div>
            <h3>Elevation API</h3>
            <p>
              Single-point and batch elevation queries. Bilinear interpolation for smooth results from NASA SRTM 30m DEM
              tiles.
            </p>
          </div>
          <div className="ab-card">
            <div className="icon blue">M</div>
            <h3>Interactive Map</h3>
            <p>
              Full-featured map with multiple basemaps, hillshade layer, 3D terrain, pins with elevation data, and
              shareable URLs.
            </p>
          </div>
          <div className="ab-card">
            <div className="icon purple">W</div>
            <h3>WorldView (3D Globe)</h3>
            <p>
              CesiumJS-powered 3D globe with real-time data overlays: earthquakes, flights, satellites, natural events,
              and weather.
            </p>
          </div>
          <div className="ab-card">
            <div className="icon amber">D</div>
            <h3>Data Explorer</h3>
            <p>
              Multi-tab data explorer with NOAA, USGS, Celestrak, OpenSky, ArcGIS, Overpass/OSM, and marine weather
              integrations.
            </p>
          </div>
        </div>

        {/* Tech Stack */}
        <h2>Technology</h2>
        <p>The platform is built with modern, lightweight tools:</p>
        <div className="ab-tech-grid">
          <span className="ab-tech-tag">Next.js 15</span>
          <span className="ab-tech-tag">TypeScript</span>
          <span className="ab-tech-tag">MapLibre GL</span>
          <span className="ab-tech-tag">CesiumJS</span>
          <span className="ab-tech-tag">Cloudflare Pages</span>
          <span className="ab-tech-tag">Edge Runtime</span>
          <span className="ab-tech-tag">Python (OZT1)</span>
          <span className="ab-tech-tag">NASA SRTM</span>
          <span className="ab-tech-tag">R2 Storage</span>
          <span className="ab-tech-tag">Vitest</span>
          <span className="ab-tech-tag">ESLint</span>
          <span className="ab-tech-tag">Prettier</span>
        </div>

        {/* Data Sources */}
        <h2>Data Sources</h2>
        <p>
          Elevation data comes from NASA&apos;s{" "}
          <a href="https://www.earthdata.nasa.gov/elevation" target="_blank" rel="noopener noreferrer">
            Shuttle Radar Topography Mission (SRTM)
          </a>{" "}
          at 30-meter resolution, stored as OZT1-compressed tiles on Cloudflare R2. Additional real-time data is proxied
          from:
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <div className="ab-card">
            <div className="icon blue">US</div>
            <h3>USGS Earthquakes</h3>
            <p>Real-time and historical earthquake feeds with magnitude, depth, and GeoJSON geometry.</p>
          </div>
          <div className="ab-card">
            <div className="icon green">OS</div>
            <h3>OpenSky Network</h3>
            <p>Real-time ADS-B flight tracking with position, altitude, speed, and callsign data.</p>
          </div>
          <div className="ab-card">
            <div className="icon purple">CE</div>
            <h3>Celestrak</h3>
            <p>Satellite TLE data for active, visual, communication, navigation, and weather satellites.</p>
          </div>
          <div className="ab-card">
            <div className="icon amber">NA</div>
            <h3>NASA EONET</h3>
            <p>Natural event tracking: wildfires, volcanoes, icebergs, landslides, and severe storms.</p>
          </div>
          <div className="ab-card">
            <div className="icon rose">NW</div>
            <h3>NWS / NOAA</h3>
            <p>Weather warnings, forecasts, and marine conditions via the National Weather Service.</p>
          </div>
          <div className="ab-card">
            <div className="icon cyan">OM</div>
            <h3>Open-Meteo</h3>
            <p>Marine weather API: wave height, direction, period, wind speed, and temperature.</p>
          </div>
        </div>

        {/* Author */}
        <h2>Author &amp; Team</h2>
        <div className="ab-card" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "linear-gradient(135deg, #22c55e, #3b82f6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.4rem",
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            Z
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.15rem" }}>aliasfoxkde</h3>
            <p style={{ margin: 0, fontSize: "0.82rem" }}>
              Creator &amp; maintainer of OpenZenith. Full-stack developer with a passion for geospatial data,
              open-source software, and making elevation data freely accessible.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <a
                href="https://github.com/aliasfoxkde"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: dark ? "#888" : "#737373", display: "flex" }}
                aria-label="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
              <a
                href="https://github.com/aliasfoxkde/OpenZenith"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: dark ? "#888" : "#737373", fontSize: "0.8rem" }}
              >
                OpenZenith
              </a>
            </div>
          </div>
        </div>

        {/* History */}
        <h2>Project History</h2>
        <div className="ab-timeline">
          <div className="ab-timeline-item">
            <h4>SRTM Data Processing</h4>
            <p>
              Converted NASA SRTM HGT files into OZT1-compressed terrain tiles, optimized for edge delivery via
              Cloudflare R2.
            </p>
          </div>
          <div className="ab-timeline-item">
            <h4>API Launch</h4>
            <p>
              Built the elevation API on Cloudflare Edge Runtime with bilinear interpolation, tile caching, and
              CORS-free access.
            </p>
          </div>
          <div className="ab-timeline-item">
            <h4>Interactive Map</h4>
            <p>
              Added a full-featured MapLibre GL map with hillshade, 3D terrain, multiple basemaps, and elevation pin
              queries.
            </p>
          </div>
          <div className="ab-timeline-item">
            <h4>WorldView Globe</h4>
            <p>
              Integrated CesiumJS for a 3D globe with real-time overlays: earthquakes, flights, satellites, and natural
              events.
            </p>
          </div>
          <div className="ab-timeline-item">
            <h4>Data Explorer</h4>
            <p>Built a multi-tab data explorer integrating NOAA, USGS, Celestrak, OpenSky, ArcGIS, and Overpass API.</p>
          </div>
          <div className="ab-timeline-item">
            <h4>Platform Expansion</h4>
            <p>
              Expanded with shared components, quality infrastructure (ESLint, Prettier, Vitest), and comprehensive API
              documentation.
            </p>
          </div>
        </div>

        {/* Contributing */}
        <h2>Get Involved</h2>
        <p>
          OpenZenith is open source under the MIT license. Contributions are welcome &mdash; whether it&apos;s new data
          sources, bug fixes, feature requests, or documentation improvements. Visit the{" "}
          <a href="/contribute">Contribute</a> page to learn how to submit data or open a pull request.
        </p>

        {/* License */}
        <h2>License</h2>
        <p>
          This project is licensed under the{" "}
          <a
            href="https://github.com/aliasfoxkde/OpenZenith/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT License
          </a>
          . Elevation data is sourced from NASA SRTM, which is public domain.
        </p>
      </div>

      <GetInTouch
        dark={dark}
        heading="Get in Touch"
        description="Questions, feedback, or want to collaborate? Send a message."
      />

      <Footer dark={dark} />
    </div>
  );
}
