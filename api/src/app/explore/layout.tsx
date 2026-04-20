import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Explorer — Real-Time Geospatial Data",
  description:
    "Explore real-time geospatial data — earthquakes, flights, vessels, satellites, hurricanes, wildfires, weather, and OSM building footprints on an interactive map.",
  openGraph: {
    title: "OpenZenith Data Explorer",
    description: "Query and explore live geospatial data from USGS, Celestrak, NOAA, NASA, and OpenStreetMap.",
  },
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
