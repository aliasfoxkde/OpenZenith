import type { Metadata } from "next";

/**
 * Next.js route metadata for the `/about` segment: sets the page title and
 * the meta description used by search engines and link previews.
 */
export const metadata: Metadata = {
  title: "About",
  description:
    "About OpenZenith — a free, open-source global elevation API and geospatial intelligence platform. No API key required.",
};

/**
 * Root layout for the `/about` route segment. Next.js requires a layout to
 * wrap the segment's pages; this one is a pass-through that renders its
 * children unchanged and contributes no chrome of its own.
 */
export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
