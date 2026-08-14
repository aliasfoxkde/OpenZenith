import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve relative to this script's location so it works from any CWD
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

// next-on-pages v1.13+ puts functions inside _worker.js/__next-on-pages-dist__/functions/
// as .func.js files (not .func/index.js)
const workerFunctionsDir = "_worker.js/__next-on-pages-dist__/functions";

// Build output is at api/.vercel/output/static (next-on-pages always runs from api/)
const apiOutputDir = path.resolve(repoRoot, "api/.vercel/output/static");

const requiredFunctions = [
  "api/health.func.js",
  "api/geocode.func.js",
  "api/elevation.func.js",
  "api/elevation-accuracy/[z]/[x]/[y].func.js",
];

const missing = [];
for (const relativePath of requiredFunctions) {
  try {
    await access(path.join(apiOutputDir, workerFunctionsDir, relativePath));
    console.log(`PASS ${relativePath}`);
  } catch {
    missing.push(relativePath);
    console.error(`FAIL ${relativePath}`);
  }
}

if (missing.length > 0) {
  console.error(`Pages artifact is missing ${missing.length} required function(s): ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Verified ${requiredFunctions.length} critical Pages functions in ${apiOutputDir}`);
