import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  compress: true,
  poweredByHeader: false,
  // Disable ESLint during builds to bypass pre-existing lint errors in studio components
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config, { isServer }) => {
    // zstd-wasm only works in Node.js/Edge, not in browser bundles
    // Provide a browser-compatible fallback for client-side code
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "zstd-wasm": path.resolve(__dirname, "src/lib/polyfills/no-zstd.ts"),
      };
    }
    return config;
  },
};

export default nextConfig;
