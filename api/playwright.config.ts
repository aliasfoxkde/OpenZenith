import { defineConfig } from "@playwright/test";

// E2E_BASE_URL retargets the suite (preview deploy, localhost dev server);
// production is the default target.
const baseURL = process.env.E2E_BASE_URL ?? "https://openzenith.cyopsys.com";

/**
 * Playwright config: E2E specs live in ./e2e and default to production
 * (`E2E_BASE_URL` retargets); chromium + firefox projects, one retry with
 * a trace for diagnosis.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
