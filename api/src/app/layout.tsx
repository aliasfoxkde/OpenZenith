import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "OpenZenith - Free Global Elevation API",
  description:
    "Free, fast, global elevation data API. Query any point on Earth for elevation data from SRTM 30m.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"
          strategy="lazyOnload"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css"
        />
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
