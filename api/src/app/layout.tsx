import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "OpenZenith - Free Global Elevation API",
  description:
    "Free, fast, global elevation data API. Query any point on Earth for elevation from NASA SRTM 30m.",
  openGraph: {
    title: "OpenZenith - Free Global Elevation API",
    description: "Query any point on Earth for elevation data from NASA SRTM 30m.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <Script
          src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"
          strategy="afterInteractive"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-inter), system-ui, -apple-system, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
