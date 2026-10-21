import type { Metadata } from "next";

/**
 * Next.js route metadata for the `/demo` segment: sets the page title and
 * the meta description used by search engines and link previews.
 */
export const metadata: Metadata = {
  title: "Demo",
  description:
    "OpenZenith API demos — elevation queries, batch processing, geocoding, and more. Interactive examples with live data.",
};

/**
 * Root layout for the `/demo` route segment. It is a pass-through that
 * renders its children unchanged and adds no chrome of its own.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
