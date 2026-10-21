import type { Metadata } from "next";

/**
 * Next.js route metadata for the `/contribute` segment: sets the page title
 * and the meta description used by search engines and link previews.
 */
export const metadata: Metadata = {
  title: "Contribute",
  description:
    "Contribute to OpenZenith — open-source geospatial intelligence platform. Report bugs, request features, or submit pull requests on GitHub.",
};

/**
 * Root layout for the `/contribute` route segment. It is a pass-through that
 * renders its children unchanged and adds no chrome of its own.
 */
export default function ContributeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
