import type { Metadata } from "next";

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

export default function GlobeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
