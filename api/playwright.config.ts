import { defineConfig } from "@playwright/test";

// E2E_BASE_URL retargets the suite (preview deploy, localhost dev server);
// production is the default target.
const baseURL = process.env["E2E_BASE_URL"] ?? "https://openzenith.cyopsys.com";

/**
 * Playwright config: E2E specs live in ./e2e and default to production
 * (`E2E_BASE_URL` retargets); chromium + firefox projects, one retry with
 * a trace for diagnosis. Webkit is observe-only (EXCELLENCE_PLAN_X C-2):
 * run explicitly via `--project=webkit`; it is not a merge gate until it
 * proves green across two consecutive full runs on this host.
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
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
