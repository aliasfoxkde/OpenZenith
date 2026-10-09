// Bundle-size budget gate for the OpenZenith web app.
//
//   node scripts/perf-budget.mjs           check the current pages:build
//                                          output against perf-budget-baseline.json
//   node scripts/perf-budget.mjs --update  rewrite the baseline from the
//                                          current output (deliberate moves only)
//
// Run AFTER `npm run pages:build`. The baseline is committed; CI
// (.gitforge.yml bundle-budget job) fails when tracked metrics grow beyond
// tolerance, so a bundle regression surfaces in the pipeline instead of in a
// prod measurement. Baseline + tolerances are deliberately coarse (5% or
// 2 KB, whichever is larger) — this is a tripwire for accidental bloat, not
// a byte-exact contract. See docs/planning/PERFORMANCE_PLAN_2026-10-02.md.
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATIC = ".vercel/output/static";
const BASELINE = new URL("../perf-budget-baseline.json", import.meta.url);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function measure() {
  const chunksDir = join(STATIC, "_next/static/chunks");
  if (!existsSync(chunksDir)) {
    console.error("No build output found — run `npm run pages:build` first.");
    process.exit(2);
  }
  const js = walk(join(STATIC, "_next/static")).filter((f) => f.endsWith(".js"));
  const totalJs = js.reduce((a, f) => a + statSync(f).size, 0);

  const chunks = js.map((f) => [f.replace(chunksDir + "/", ""), statSync(f).size]);
  const polyfills = chunks.find(([n]) => n.startsWith("polyfills-"))?.[1] ?? 0;

  // Per-route page chunks (hash in the name — match by prefix). The root
  // route emits `app/page-<hash>.js` (no extra segment).
  const pageChunk = (route) =>
    chunks
      .filter(([n]) => (route === "page" ? n.startsWith("app/page-") : n.startsWith(`app/${route}/page-`)))
      .reduce((a, [, s]) => a + s, 0);

  // Structural invariants that should never regress silently.
  const indexHtml = readFileSync(join(STATIC, "index.html"), "utf8");
  const globeHtml = readFileSync(join(STATIC, "globe.html"), "utf8");
  const checks = {
    selfHostedMono: indexHtml.includes("/fonts/jetbrains-mono-latin.woff2"),
    noGoogleFontsImport: !indexHtml.includes("fonts.googleapis"),
    heroTilePreconnect: indexHtml.includes("server.arcgisonline.com"),
    cesiumPreload: globeHtml.includes('"/cesium/Cesium.js"'),
    flipCardMarker: chunks.some(
      ([n]) => n.startsWith("app/page-") && readFileSync(join(chunksDir, n)).includes("oz-flip-card"),
    ),
  };

  return {
    totalJs,
    polyfills,
    landing: pageChunk("page"),
    map: pageChunk("map"),
    globe: pageChunk("globe"),
    explore: pageChunk("explore"),
    studio: pageChunk("studio"),
    checks,
  };
}

const allow = (name, now, base) => {
  const tol = Math.max(base * 0.05, 2048);
  if (now > base + tol) {
    console.error(`  FAIL ${name}: ${now} > baseline ${base} + ${Math.round(tol)} tolerance (+${now - base} bytes)`);
    return false;
  }
  console.log(`  ok   ${name}: ${now} (baseline ${base})`);
  return true;
};

const update = process.argv.includes("--update");
if (update) {
  const m = measure();
  writeFileSync(BASELINE, JSON.stringify(m, null, 2) + "\n");
  console.log(`Baseline updated: ${BASELINE.pathname}`);
  console.log(JSON.stringify(m, null, 1));
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("No baseline — run `node scripts/perf-budget.mjs --update` after a known-good build.");
  process.exit(2);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const now = measure();

console.log("Bundle budget check (build output vs committed baseline):");
let ok = true;
for (const key of ["totalJs", "polyfills", "landing", "map", "globe", "explore", "studio"]) {
  if (base[key] > 0) ok = allow(key, now[key], base[key]) && ok;
}
for (const [name, expected] of Object.entries(now.checks)) {
  const pass = base.checks?.[name] === expected;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}: ${expected}`);
  ok = pass && ok;
}
console.log(ok ? "Bundle budget: PASS" : "Bundle budget: FAIL");
process.exit(ok ? 0 : 1);
