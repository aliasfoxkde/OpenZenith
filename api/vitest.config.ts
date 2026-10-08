import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest config: node-environment unit tests over `src/**` with the 99%
 * statement / 96% branch coverage floors (ratchet history inline), the
 * `@` alias, and the edge-runtime test stubs that keep route tests off a
 * real Cloudflare request context.
 */
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
        // Test-support code under the api/__tests__ tree (mockRequest,
        // bodyAs, stubFetchRoutes) is test code, not production surface —
        // mirror the lib-side __tests__ exclusion. Without this the only
        // non-*.test.ts file in the tree lands in the denominator; its
        // stubFetchRoutes body dragged statements to 98.99% (below the 99
        // floor) in Oct-2026 despite zero production regression.
        "src/app/api/__tests__/**",
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
        // 2026-09-23 (task #115 wave 4, 99 files / 1315 tests): measured
        // 98.58 stmts / 93.77 branches / 90.78 functions / 98.58 lines after
        // earthquakes/airquality/weather-warnings/dem-tile/stac/docs-md/
        // gebco-tile/openapi.json routes all reached 100% branches.
        // 2026-10-04 (task #179 wave 5, 99 files / 1446 tests): measured
        // 99.11 stmts / 97.51 branches / 93.40 functions / 99.84 lines
        // after the coverage sweep closed the remaining reachable gaps
        // (hurricanes + terrain route arms, edge-cache TTL paths, flow-path
        // zero-run slope guard). Functions floor stays under the measured
        // value because the remainder is concentrated in thin route
        // handlers whose only unexercised lines are error envelopes
        // reached solely through upstream fetch failure injection.
        statements: 99,
        branches: 96,
        functions: 92,
        lines: 99,
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
