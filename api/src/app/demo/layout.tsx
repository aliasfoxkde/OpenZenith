import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "OpenZenith API demos — elevation queries, batch processing, geocoding, and more. Interactive examples with live data.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
