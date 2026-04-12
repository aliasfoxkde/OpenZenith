import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "Geospatial studio with drawing tools, geocoding, Overpass queries, and elevation analysis on an interactive map.",
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
