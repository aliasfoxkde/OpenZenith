// Copy the render-critical vendor assets from node_modules into public/,
// so the globe page stops depending on third-party CDNs at runtime.
//
//   node scripts/copy-vendor-assets.mjs
//
// Idempotent: skips the copy when the target already carries the pinned
// version marker. Wired as the `predev` / `prepages:build` step — the
// globe must work identically in dev and in the deployed bundle.
//
// Why: cesium-init.ts used to load CesiumJS + its Workers from unpkg/
// jsdelivr. The main script had CDN fallback, but the Workers Cesium
// dynamically imports at render time inherit CESIUM_BASE_URL from
// whichever CDN served the main script — a mid-session worker-fetch
// failure there stops the whole render loop ("An error occurred while
// rendering. Rendering has stopped."). First-party assets kill that
// failure class (same rationale as the self-hosted mono font).
import { existsSync, mkdirSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cesiumVersion = pkg.devDependencies.cesium?.replace(/[^0-9.]/g, "");
const satelliteVersion = pkg.devDependencies["satellite.js"]?.replace(/[^0-9.]/g, "");
if (!cesiumVersion) {
  console.error("cesium is not in devDependencies — install it first.");
  process.exit(2);
}

const cesiumSrc = join(root, "node_modules", "cesium", "Build", "Cesium");
const cesiumDst = join(root, "public", "cesium");
const marker = join(cesiumDst, ".copied-version");

function copyCesium() {
  if (!existsSync(cesiumSrc)) {
    console.error(`node_modules/cesium/Build/Cesium missing — run npm install.`);
    process.exit(2);
  }
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === cesiumVersion) {
    console.log(`public/cesium already at ${cesiumVersion} — skipping.`);
    return;
  }
  rmSync(cesiumDst, { recursive: true, force: true });
  mkdirSync(cesiumDst, { recursive: true });
  cpSync(cesiumSrc, cesiumDst, { recursive: true });
  // index.js/index.cjs are the Node entry points; the browser only needs
  // the shipped Build/Cesium assets — drop them to keep deploys lean.
  for (const f of ["index.js", "index.cjs"]) rmSync(join(cesiumDst, f), { force: true });
  writeFileSync(marker, `${cesiumVersion}\n`);
  console.log(`Copied cesium@${cesiumVersion} -> public/cesium/`);
}

function copySatellite() {
  if (!satelliteVersion) return;
  const src = join(root, "node_modules", "satellite.js", "dist", "satellite.min.js");
  const dst = join(root, "public", "vendor", "satellite.min.js");
  if (!existsSync(src)) return; // optional asset — CDN fallback stays
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  console.log(`Copied satellite.js@${satelliteVersion} -> public/vendor/satellite.min.js`);
}

copyCesium();
copySatellite();
