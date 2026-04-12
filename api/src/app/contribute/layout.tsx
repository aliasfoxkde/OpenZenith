import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contribute",
  description:
    "Contribute to OpenZenith — open-source geospatial intelligence platform. Report bugs, request features, or submit pull requests on GitHub.",
};

export default function ContributeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
