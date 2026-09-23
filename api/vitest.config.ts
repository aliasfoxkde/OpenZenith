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
        // down ~2 points so ordinary variance does not flap the gate.
        // 2026-09-22: 92.22/84.01/81.84/92.22 → 92/84/81/92.
        // 2026-09-23 (task #112 route-test wave, 98 files / 1115 tests):
        // measured 95.99 stmts / 88.05 branches / 85.15 functions / 95.99
        // lines after +83 route tests, watershed/streams geo-coordinate fix
        // and removal of watershed dead code. Weakest areas today: api
        // routes' branch coverage; globe/** is lint-managed (#98/#99) not
        // coverage-counted.
        statements: 94,
        branches: 86,
        functions: 83,
        lines: 94,
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
