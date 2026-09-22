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
      thresholds: {
        statements: 70,
        branches: 50,
        functions: 70,
        lines: 70,
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
