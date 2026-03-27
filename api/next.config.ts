import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  compress: true,
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
