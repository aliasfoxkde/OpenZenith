import type { NextConfig } from "next";
import path from "path";

/**
 * Slice of the webpack config this file touches. Next types `webpack` as
 * `any`, so the callback annotates its own parameter to keep the alias merge
 * inside the type system.
 */
interface NextWebpackConfig {
  resolve: { alias?: Record<string, string | undefined> };
}

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  compress: true,
  poweredByHeader: false,
  eslint: {
    // ESLint errors should fail the build in production
    ignoreDuringBuilds: false,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config: NextWebpackConfig, { isServer }) => {
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
