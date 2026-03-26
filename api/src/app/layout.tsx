import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const baseUrl = "https://openzenith.pages.dev";

export const metadata: Metadata = {
  title: {
    default: "OpenZenith - Free Global Elevation API & Geospatial Tools",
    template: "%s | OpenZenith",
  },
  description:
    "Free, fast, global elevation data API with interactive mapping, weather data, flight tracking, earthquake monitoring, satellite data, and more. No API key required.",
  keywords: [
    "elevation API", "SRTM", "terrain data", "free elevation",
    "geospatial API", "height API", "DEM", "digital elevation model",
    "MapLibre", "terrain tiles", "hillshade", "3D terrain",
    "weather API", "flight tracking", "earthquake data", "NOAA",
    "OpenSky ADS-B", "satellite tracking", "marine data",
    "open data", "free API", "no API key",
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
    description: "Free elevation API, interactive maps, weather, flights, earthquakes, satellites. No API key required.",
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "OpenZenith",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenZenith - Free Global Elevation API & Geospatial Tools",
    description: "Free elevation API, interactive maps, weather, flights, earthquakes, satellites. No API key required.",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icon-192.png" },
    ],
  },
  manifest: "/manifest.json",
  metadataBase: new URL(baseUrl),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head />
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-inter), system-ui, -apple-system, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.setAttribute("data-theme", window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");` }} />
        {children}
      </body>
    </html>
  );
}
