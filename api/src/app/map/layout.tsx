import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "2D Map",
  description:
    "Interactive 2D map with terrain elevation, measurement tools, and real-time data layers powered by MapLibre GL.",
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
