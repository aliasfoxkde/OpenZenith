import type { Metadata } from "next";

/**
 * Next.js route metadata for the `/studio` segment: sets the page title, the
 * meta description, and the OpenGraph card fields for social link previews.
 */
export const metadata: Metadata = {
  title: "Geospatial Studio — Draw, Annotate & Analyze",
  description:
    "Geospatial studio with drawing tools, geocoding, OSM Overpass queries, NWS weather alerts, and elevation analysis on an interactive map.",
  openGraph: {
    title: "OpenZenith Geospatial Studio",
    description:
      "Draw polygons, query OSM data, analyze elevation profiles, and explore weather alerts on an interactive map.",
  },
};

/**
 * Root layout for the `/studio` geospatial-studio route segment. It is a
 * pass-through that renders its children unchanged and adds no chrome.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
