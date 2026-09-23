#!/usr/bin/env node
// Single-source generator for the OpenAPI spec served at /api/openapi.json.
//
//   node scripts/gen-openapi.mjs          regenerate src/app/api/openapi.json/spec.json
//   node scripts/gen-openapi.mjs --check  verify the committed spec is current (exit 1 if not)
//
// The spec is assembled from two sources:
//   1. src/lib/openapi/base.json — the hand-authored document (rich descriptions,
//      examples, response schemas for the endpoints that were written up first).
//   2. The route tree itself — src/app/api/**/route.ts is scanned for exported
//      handlers; every route missing from the base gets a generated skeleton
//      (summary, path parameters, 200/4xx responses) so the published spec can
//      never silently omit a live endpoint.
// A route documented in the base but absent from the tree is a hard error —
// that means the spec advertises an endpoint that no longer exists.
//
// info.version is stamped from package.json at generation time; the
// openapi tests fail if a version bump lands without regenerating.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOC_METHODS = ["get", "post", "put", "delete", "patch"];
const HTTP_METHODS = [...DOC_METHODS, "options", "head"];

// Tag assigned to generated skeleton entries. Keyed by first path segment so a
// new route family lands in a sensible section without manual mapping; the
// fallback covers one-off endpoints. Names must exist in base.json `tags`.
const SEGMENT_TAGS = {
  aod: "Imagery",
  aspect: "Terrain Analysis",
  biomass: "Imagery",
  "canopy-height": "Imagery",
  chlorophyll: "Imagery",
  contours: "Terrain Analysis",
  coverage: "Discovery",
  "dem-tile": "Tiles",
  "disturbance-alerts": "Hazards",
  "drought-hazard": "Hazards",
  "dynamic-surface-water": "Imagery",
  "elevation-accuracy": "Elevation",
  "elevation-color": "Elevation",
  "fire-temperature": "Hazards",
  "flood-hazard": "Hazards",
  "floods-tile": "Hazards",
  "gps-jamming": "Network",
  "landslide-hazard": "Hazards",
  ndvi: "Imagery",
  "no2-pollution": "Imagery",
  pm25: "Imagery",
  precipitation: "Imagery",
  profile: "Terrain Analysis",
  "sar-backscatter": "Imagery",
  "sea-height": "Imagery",
  "sea-salinity": "Imagery",
  slope: "Terrain Analysis",
  "snow-cover": "Imagery",
  "so2-volcanic": "Imagery",
  "soil-moisture": "Imagery",
  space: "Data",
  sst: "Imagery",
  stac: "Discovery",
  streams: "Terrain Analysis",
  tiles: "Tiles",
  trace: "Terrain Analysis",
  twi: "Terrain Analysis",
  watershed: "Terrain Analysis",
};
const DEFAULT_TAG = "Data";

// Route names are derived from these templates so generated entries read like
// the hand-written ones. Matched against the final path template.
const SKELETON_SUMMARIES = [
  { match: /\{z\}\/\{x\}\/\{y\}$/, summary: (name) => `Get ${name} tile layer` },
  { match: /\/items$/, summary: (name) => `List ${name} items` },
  { match: /\/\{[^}]+\}$/, summary: (name) => `Get ${name} resource` },
];
const fallbackSummary = (name) => `Query ${name}`;

// Segment names that should not go through generic title-casing.
const SPECIAL_NAMES = {
  aod: "AOD",
  "dem-tile": "DEM tile",
  "dynamic-surface-water": "Dynamic surface water",
  "elevation-accuracy": "Elevation accuracy",
  "elevation-color": "Elevation color",
  "gps-jamming": "GPS jamming",
  ndvi: "NDVI",
  "no2-pollution": "NO2 pollution",
  pm25: "PM2.5",
  "sar-backscatter": "SAR backscatter",
  so2: "SO2",
  sst: "SST",
  stac: "STAC",
  twi: "TWI",
};

function humanize(segment) {
  if (SPECIAL_NAMES[segment]) return SPECIAL_NAMES[segment];
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function walkRoutes(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walkRoutes(full));
    } else if (entry === "route.ts") {
      found.push(full);
    }
  }
  return found;
}

// Next.js route segments: [param] -> {param}, [...rest] -> {rest}.
function toTemplate(routeDir, relFile) {
  const parts = relative(routeDir, relFile).split(/[/\\]/).slice(0, -1);
  const mapped = parts.map((p) =>
    p.startsWith("[...") ? `{${p.slice(4, -1)}}` : p.startsWith("[") ? `{${p.slice(1, -1)}}` : p,
  );
  return `/api/${mapped.join("/")}`;
}

function exportedMethods(source) {
  const re = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)\s*[=(]/g;
  const found = new Set();
  for (const m of source.matchAll(re)) {
    const method = m[1].toLowerCase();
    if (HTTP_METHODS.includes(method)) found.add(method);
  }
  return [...found].sort(
    (a, b) =>
      DOC_METHODS.indexOf(a) - DOC_METHODS.indexOf(b) ||
      a.localeCompare(b),
  );
}

// Description for generated entries: the JSDoc block or // comment run sitting
// directly above the first documented handler, if the route has one.
function leadingDocComment(source) {
  const handler = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const)\\s+(${DOC_METHODS.join("|")})\\b`,
  ).exec(source);
  if (!handler) return undefined;
  const before = source.slice(0, handler.index).trimEnd();
  const jsdoc = /\*\*([\s\S]*?)\*/.exec(before);
  if (jsdoc && before.endsWith("*/")) {
    return jsdoc[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
  }
  const lineRe = /^\s*\/\/\s?(.*)$/gm;
  const lines = [];
  let m;
  while ((m = lineRe.exec(before)) !== null) lines.push(m[1].trim());
  if (lines.length && lines.length === before.trimEnd().split("\n").length) {
    return lines.join(" ");
  }
  return undefined;
}

const ZXYY_PARAM = {
  z: {
    description: "Tile zoom level",
    schema: { type: "integer", minimum: 0, maximum: 15 },
  },
  x: {
    description: "Tile x coordinate (slippy map)",
    schema: { type: "integer", minimum: 0 },
  },
  y: {
    description: "Tile y coordinate (slippy map)",
    schema: { type: "integer", minimum: 0 },
  },
};

function pathParameters(template) {
  const names = [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: "path",
    required: true,
    ...(ZXYY_PARAM[name] ?? { schema: { type: "string" } }),
    ...(ZXYY_PARAM[name] ? {} : { description: `${name} path parameter` }),
  }));
}

function skeletonFor(template, source) {
  const segments = template.split("/").filter(Boolean);
  const first = segments[1] ?? "api";
  const name = humanize(first);
  const hit = SKELETON_SUMMARIES.find((s) => s.match.test(template));
  const summary = hit ? hit.summary(name) : fallbackSummary(name);
  const params = pathParameters(template);
  const operation = {
    summary,
    ...(source ? { description: leadingDocComment(source) } : {}),
    ...(params.length ? { parameters: params } : {}),
    responses: {
      "200": { description: "Successful response" },
      "400": { description: "Invalid parameters" },
    },
    tags: [SEGMENT_TAGS[first] ?? DEFAULT_TAG],
  };
  return operation;
}

function buildSpec() {
  const base = JSON.parse(readFileSync(join(API_ROOT, "src/lib/openapi/base.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(API_ROOT, "package.json"), "utf8"));

  const routeDir = join(API_ROOT, "src/app/api");
  const spec = {
    openapi: base.openapi,
    info: { ...base.info, version: pkg.version },
    servers: base.servers,
    paths: {},
    tags: base.tags,
  };

  const knownTags = new Set(base.tags.map((t) => t.name));
  for (const tag of new Set(Object.values(SEGMENT_TAGS))) {
    if (!knownTags.has(tag)) {
      throw new Error(`generated tag "${tag}" is not declared in base.json tags`);
    }
  }

  const onDisk = new Map(); // template -> sorted documented methods
  for (const file of walkRoutes(routeDir)) {
    const template = toTemplate(routeDir, file);
    const source = readFileSync(file, "utf8");
    const methods = exportedMethods(source).filter((m) => DOC_METHODS.includes(m));
    if (methods.length === 0) continue;
    onDisk.set(template, methods);

    const baseEntry = base.paths[template];
    const entry = {};
    for (const method of methods) {
      const documented = baseEntry?.[method];
      if (documented) {
        entry[method] = documented;
      } else {
        entry[method] = skeletonFor(template, source);
        spec.__generated__ = spec.__generated__ || {};
        spec.__generated__[template] = true;
      }
    }
    spec.paths[template] = entry;
  }

  for (const template of Object.keys(base.paths)) {
    if (!onDisk.has(template)) {
      throw new Error(
        `spec documents "${template}" but no route.ts implements it — remove the stale path from base.json`,
      );
    }
  }

  // Deterministic output: sorted path keys, generated-marker hoisted into a
  // non-standard extension the tooling tolerates.
  const paths = {};
  for (const k of Object.keys(spec.paths).sort()) paths[k] = spec.paths[k];
  const out = {
    openapi: spec.openapi,
    info: spec.info,
    servers: spec.servers,
    paths,
    "x-generated": {
      note: "Paths without rich documentation in base.json carry generated skeleton entries.",
      skeleton_paths: Object.keys(spec.__generated__ ?? {}).sort(),
    },
    tags: spec.tags,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

const check = process.argv.includes("--check");
const outFile = join(API_ROOT, "src/app/api/openapi.json/spec.json");
const generated = buildSpec();

if (check) {
  const current = readFileSync(outFile, "utf8");
  if (current !== generated) {
    console.error(
      "spec.json is stale. Run `npm run openapi:generate` and commit the result.\n" +
        "(routes or package version changed without regenerating)",
    );
    process.exit(1);
  }
  console.log("spec.json is up to date.");
} else {
  writeFileSync(outFile, generated);
  const spec = JSON.parse(generated);
  const skeletons = spec["x-generated"].skeleton_paths.length;
  console.log(
    `spec.json written: ${Object.keys(spec.paths).length} paths ` +
      `(${Object.keys(spec.paths).length - skeletons} documented, ${skeletons} generated).`,
  );
}
