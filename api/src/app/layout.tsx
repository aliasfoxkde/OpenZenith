import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SkipLink } from "@/components/SkipLink";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const baseUrl = "https://openzenith.pages.dev";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "OpenZenith - Free Global Elevation API & Geospatial Tools",
    template: "%s | OpenZenith",
  },
  description:
    "Free, fast, global elevation data API with interactive mapping, weather data, flight tracking, earthquake monitoring, satellite data, and more. No API key required.",
  keywords: [
    "elevation API",
    "SRTM",
    "terrain data",
    "free elevation",
    "geospatial API",
    "height API",
    "DEM",
    "digital elevation model",
    "MapLibre",
    "terrain tiles",
    "hillshade",
    "3D terrain",
    "weather API",
    "flight tracking",
    "earthquake data",
    "NOAA",
    "OpenSky ADS-B",
    "satellite tracking",
    "marine data",
    "open data",
    "free API",
    "no API key",
  ],
  authors: [{ name: "OpenZenith" }],
  creator: "OpenZenith",
  publisher: "OpenZenith",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "OpenZenith - Free Global Elevation API & Geospatial Tools",
    description:
      "Free elevation API, interactive maps, weather, flights, earthquakes, satellites. No API key required.",
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "OpenZenith",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "OpenZenith - Global Geospatial Intelligence Platform",
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenZenith - Free Global Elevation API & Geospatial Tools",
    description:
      "Free elevation API, interactive maps, weather, flights, earthquakes, satellites. No API key required.",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.json",
  metadataBase: new URL(baseUrl),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OpenZenith",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Cesium assets are loaded by /globe's cesium-init.ts — a global
            preload here fires a "preloaded but not used" console warning on
            every other page. `preconnect` alone keeps the CDN handshake warm. */}
        <link rel="preconnect" href="https://unpkg.com" crossOrigin="anonymous" />
        {/* JetBrains Mono is self-hosted (public/fonts, OFL — see the
            license beside it). Pages used to @import it from Google Fonts in
            four injected <style> blocks, a discover→download serial chain
            before first paint; the preload starts the fetch with the
            document instead. Latin subset covers the app; non-latin glyphs
            fall back to monospace. */}
        <link
          rel="preload"
          href="/fonts/jetbrains-mono-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-inter), system-ui, -apple-system, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  try{var m=localStorage.getItem("openzenith-theme")||"system";
  var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme:dark)").matches);
  document.documentElement.setAttribute("data-theme",d?"dark":"light");
  }catch(e){document.documentElement.setAttribute("data-theme",window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");}
})();`,
          }}
        />
        {/* WCAG 2.4.1 (Bypass Blocks): first focusable element on every
            page jumps past the repeated chrome to that page's
            <main id="main-content">. Client component — fragment nav alone
            does not move focus in Firefox/Safari (see SkipLink). */}
        <SkipLink />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
