import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Geospatial Studio — Draw, Annotate & Analyze",
  description:
    "Geospatial studio with drawing tools, geocoding, OSM Overpass queries, NWS weather alerts, and elevation analysis on an interactive map.",
  openGraph: {
    title: "OpenZenith Geospatial Studio",
    description: "Draw polygons, query OSM data, analyze elevation profiles, and explore weather alerts on an interactive map.",
  },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
