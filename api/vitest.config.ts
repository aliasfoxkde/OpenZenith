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
        // Ratchets upward only. Floors are the measured baseline
        // (2026-09-22: 92.3 stmts / 83.15 branches / 81.28 functions),
        // rounded down so ordinary variance does not flap the gate.
        // Raised branches 83→84 the same day after vessels/reverse-geocode/
        // sentinel2-zxy route tests re-measured 92.22/84.01/81.84/92.22
        // (95 files, 1000 tests). Weakest areas today: api routes' branch
        // coverage; globe/** is lint-managed (#98/#99) not coverage-counted.
        statements: 92,
        branches: 84,
        functions: 81,
        lines: 92,
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
