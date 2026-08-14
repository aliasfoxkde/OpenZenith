#!/usr/bin/env node

/**
 * Minimal post-deploy contract smoke test.
 *
 * Usage:
 *   BASE_URL=https://openzenith.pages.dev node scripts/smoke_public_api.mjs
 */

const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("BASE_URL is required");
  process.exit(2);
}

const checks = [
  { path: "/api/health", json: true },
  { path: "/api/geocode?query=New%20York&limit=1", json: true },
  { path: "/api/elevation?lat=40.7128&lon=-74.0060", json: true },
  { path: "/api/elevation?lat=25&lon=-40", json: true },
  { path: "/api/elevation-accuracy/0/0/0", json: false },
];

let failed = false;
for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const isHtml =
      /text\/html/i.test(contentType) || /^<!doctype html/i.test(body.trim());
    const valid =
      response.ok &&
      !isHtml &&
      (!check.json || /application\/json/i.test(contentType));
    console.log(
      `${valid ? "PASS" : "FAIL"} ${response.status} ${contentType} ${check.path}`,
    );
    if (!valid) {
      console.error(
        `  Unexpected response from ${url}: ${body.slice(0, 180).replace(/\s+/g, " ")}`,
      );
      failed = true;
    }
  } catch (error) {
    console.error(
      `FAIL ${check.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
