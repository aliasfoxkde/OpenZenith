import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    setupFiles: ["./src/test-setup.ts"],
    environment: "node",
    // Slow storage (NFS) + parallel transform make cold imports legitimately
    // exceed vitest's 5s default on this machine (stac's route import alone
    // measured 7.6s). A real hang still fails; it just gets 15s to prove it.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/__tests__/**/*.ts", "src/__tests__/**/*.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: [
        "src/lib/**/__tests__/**",
        // Type-only modules carry no runtime statements; counting them at 0%
        // would make the floor reward artificial runtime imports.
        "src/lib/layers/types.ts",
      ],
      thresholds: {
        // Ratchets upward only. Floors are the measured baseline, rounded
        // down ~2-3 points so ordinary variance does not flap the gate.
        // 2026-09-22: 92.22/84.01/81.84/92.22 → 92/84/81/92.
        // 2026-09-23 (task #112 route-test wave, 98 files / 1115 tests):
        // measured 95.99/88.05/85.15/95.99 → 94/86/83/94.
        // 2026-09-23 (task #113 wave 2, 98 files / 1238 tests): measured
        // 97.61 stmts / 93.04 branches / 88.23 functions / 97.61 lines
        // after +123 tests across 12 routes and the aspect/waterways/
        // arcgis/geoip/military/wms fixes. Weakest areas today: api routes'
        // remaining branch gaps; globe/** is lint-managed (#98/#99) not
        // coverage-counted.
        // 2026-09-23 (task #114 wave 3, 99 files / 1261 tests): measured
        // 97.89 stmts / 93.3 branches / 88.26 functions / 97.89 lines after
        // the OGC tiles route + gibs-tile reached 100% (CRS84 set dropped —
        // tiles are EPSG:3857 and cannot be served conformantly under it).
        statements: 96,
        branches: 91,
        functions: 86,
        lines: 96,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The real module only loads inside a Next edge build; tests inject
      // fakes via the provider seams instead of hitting a request context.
      "@cloudflare/next-on-pages": path.resolve(__dirname, "./src/test-stubs/next-on-pages.ts"),
    },
  },
});
