import type { Metadata } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Interactive 2D Map — Terrain, Elevation & Live Data",
  description:
    "Interactive 2D map with 37 data layers: terrain elevation, earthquakes, flights, satellites, hurricanes, wildfires, weather radar, and more. Powered by MapLibre GL.",
  openGraph: {
    title: "OpenZenith 2D Map — 37 Real-Time Data Layers",
    description:
      "Explore the world with terrain elevation, earthquakes, flights, satellites, and 33 more live data layers on an interactive map.",
  },
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistration />
      {children}
    </>
  );
}
