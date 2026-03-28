"use client";

import { Logo } from "./Logo";

interface FooterProps {
  dark: boolean;
}

export function Footer({ dark }: FooterProps) {
  const border = dark ? "#222" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSecondary = dark ? "#888" : "#737373";
  const footerBg = dark ? "#0c0c0c" : "#f8f8f8";

  return (
    <footer style={{ borderTop: `1px solid ${border}`, background: footerBg }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "3rem 1.5rem 2rem" }}>
        <div
          className="oz-footer-grid"
          style={{ marginBottom: "2rem" }}
        >
          {/* Brand */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.75rem" }}>
              <Logo />
              <span style={{ fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.02em", color: text }}>
                OpenZenith
              </span>
            </div>
            <p style={{ fontSize: "0.78rem", color: textSecondary, lineHeight: 1.55, margin: "0 0 0.75rem" }}>
              Free, fast, global elevation and geospatial API. No API key or signup required. Built with NASA SRTM 30m data,
              served on Cloudflare&apos;s edge.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <a
                href="https://github.com/aliasfoxkde/OpenZenith"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: textSecondary, display: "flex" }}
                aria-label="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
            </div>
          </div>
          {/* Product */}
          <div>
            <h4
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: textSecondary,
                margin: "0 0 0.6rem",
              }}
            >
              Product
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {[
                { label: "Map", href: "/map" },
                { label: "Globe", href: "/globe" },
                { label: "Explorer", href: "/explore" },
                { label: "API Docs", href: "/api/docs" },
                { label: "Contribute", href: "/contribute" },
                { label: "About", href: "/about" },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  style={{ color: textSecondary, textDecoration: "none", fontSize: "0.8rem" }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
          {/* Data */}
          <div>
            <h4
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: textSecondary,
                margin: "0 0 0.6rem",
              }}
            >
              Data Sources
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {[
                { label: "NASA SRTM 30m", href: "https://www.earthdata.nasa.gov/elevation" },
                { label: "USGS Earthquakes", href: "https://earthquake.usgs.gov" },
                { label: "OpenSky Network", href: "https://opensky-network.org" },
                { label: "Celestrak", href: "https://celestrak.org" },
                { label: "NASA EONET", href: "https://eonet.gsfc.nasa.gov" },
                { label: "NOAA Warnings", href: "https://www.weather.gov" },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: textSecondary, textDecoration: "none", fontSize: "0.8rem" }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
          {/* Resources */}
          <div>
            <h4
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: textSecondary,
                margin: "0 0 0.6rem",
              }}
            >
              Resources
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {[
                { label: "OpenAPI Spec", href: "/api/openapi.json" },
                { label: "Health Status", href: "/api/health" },
                { label: "GitHub", href: "https://github.com/aliasfoxkde/OpenZenith" },
                { label: "Sponsor", href: "https://github.com/sponsors/aliasfoxkde" },
                { label: "Ko-fi", href: "https://ko-fi.com/aliasfoxkde" },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target={l.href.startsWith("http") ? "_blank" : undefined}
                  rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  style={{ color: textSecondary, textDecoration: "none", fontSize: "0.8rem" }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        </div>
        {/* Bottom bar */}
        <div
          style={{
            borderTop: `1px solid ${border}`,
            paddingTop: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.72rem", color: textSecondary }}>
            NASA SRTM 30m Global DEM &middot; Cloudflare Pages &middot; Open Source (MIT)
          </span>
          <span style={{ fontSize: "0.72rem", color: textSecondary }}>
            No API key or signup required. No tracking. Just data.
          </span>
        </div>
      </div>
    </footer>
  );
}
