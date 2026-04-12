import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "About OpenZenith — a free, open-source global elevation API and geospatial intelligence platform. No API key required.",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
