import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Explore real-time geospatial data — earthquakes, flights, vessels, satellites, hurricanes, wildfires, and more on an interactive map.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
