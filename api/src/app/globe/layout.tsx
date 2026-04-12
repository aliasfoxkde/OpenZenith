import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3D Globe",
  description:
    "Interactive 3D globe with real-time geospatial data layers — earthquakes, flights, vessels, satellites, weather, and more powered by CesiumJS.",
};

export default function GlobeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
