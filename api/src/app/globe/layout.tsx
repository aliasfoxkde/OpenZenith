import type { Metadata } from "next";

/**
 * Next.js route metadata for the `/globe` segment: sets the page title, the
 * meta description, and the OpenGraph card fields for social link previews.
 */
export const metadata: Metadata = {
  title: "3D Globe — Real-Time Geospatial Intelligence",
  description:
    "Interactive 3D globe with real-time geospatial data layers — earthquakes, flights, vessels, satellites, hurricanes, weather radar, and more powered by CesiumJS.",
  openGraph: {
    title: "OpenZenith 3D Globe — Geospatial Intelligence",
    description:
      "Explore the planet in 3D with live earthquake data, flight tracking, satellite orbits, hurricane paths, and more.",
  },
};

/**
 * Root layout for the `/globe` 3D CesiumJS route segment. It is a pass-through
 * that renders its children unchanged and adds no chrome of its own.
 */
export default function GlobeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
