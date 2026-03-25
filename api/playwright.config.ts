import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://localhost:9006",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "npx wrangler pages dev .vercel/output/static --compatibility-date=2025-01-01 --port 9006 --ip 0.0.0.0",
    port: 9006,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
