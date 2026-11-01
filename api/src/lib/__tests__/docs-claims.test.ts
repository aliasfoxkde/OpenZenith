/**
 * Docs-claims gate: the numbers README.md and CLAUDE.md advertise about this
 * codebase are asserted against the modules that actually produce them.
 *
 * Why a vitest test rather than a standalone .mjs script: the truth lives in
 * TypeScript modules (the layer registry, the basemap registry), so the
 * existing unit-test job imports them natively — no extra CI job, no second
 * parser, and the gate runs on every `npm test`.
 *
 * When this fails, the prose is stale, not the test. Update README.md or
 * CLAUDE.md to the source truth — unless the source genuinely changed shape
 * (a different module now owns the count), in which case repoint the truth
 * constant here. Never loosen an assertion to make a stale doc pass.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYERS } from "@/lib/layers/registry";
import { BASEMAPS } from "@/lib/basemaps";
import { GEBCO_YEAR } from "@/lib/gebco/tile-math";

/** …/api/src/lib/__tests__ — four levels below the repository root. */
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: README.md and CLAUDE.md live there, not under api/. */
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..", "..");
/** api/ — this workspace. */
const API_ROOT = path.join(REPO_ROOT, "api");

/** `LAYERS` is the curated registry both clients derive their pickers from. */
const LAYER_COUNT = LAYERS.length;
/** One shared basemap registry for map, globe, studio, and the landing hero. */
const BASEMAP_COUNT = Object.keys(BASEMAPS).length;
/** Next.js route handlers under src/app/api (a file may export several verbs). */
const API_ROUTE_COUNT = countRouteFiles(path.join(API_ROOT, "src", "app", "api"));
/** Major version of the installed Next.js, straight from package.json. */
const NEXT_MAJOR = (
  JSON.parse(readFileSync(path.join(API_ROOT, "package.json"), "utf8")) as {
    dependencies: { next: string };
  }
).dependencies.next.match(/^\^?(\d+)/)?.[1];

function countRouteFiles(dir: string): number {
  let routes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes += countRouteFiles(path.join(dir, entry.name));
    } else if (entry.name === "route.ts") {
      routes += 1;
    }
  }
  return routes;
}

interface DocClaim {
  /** Human-readable name, used in failure messages. */
  readonly name: string;
  /** Capture group 1 is the advertised number. The `g` flag feeds `matchAll`. */
  readonly pattern: RegExp;
  readonly truth: number;
  /** Where the truth comes from, so a failure points at the fix. */
  readonly source: string;
}

const CLAIMS: readonly DocClaim[] = [
  {
    name: "mountable data layers",
    pattern: /(\d+) mountable data layers?/g,
    truth: LAYER_COUNT,
    source: "LAYERS in api/src/lib/layers/registry.ts",
  },
  {
    name: "curated layers",
    pattern: /(\d+) curated/g,
    truth: LAYER_COUNT,
    source: "LAYERS in api/src/lib/layers/registry.ts",
  },
  {
    name: "basemaps",
    pattern: /(\d+) basemaps?/g,
    truth: BASEMAP_COUNT,
    source: "BASEMAPS in api/src/lib/basemaps.ts",
  },
  {
    name: "API routes",
    pattern: /(\d+) API routes?/g,
    truth: API_ROUTE_COUNT,
    source: "route.ts files under api/src/app/api",
  },
];

/** Docs gated here. A claim absent from a doc is simply not checked there. */
const DOCS: readonly string[] = ["README.md", "CLAUDE.md"];

function readDoc(name: string): string {
  const abs = path.join(REPO_ROOT, name);
  expect(existsSync(abs), `${name} is missing — expected it at ${abs}`).toBe(true);
  return readFileSync(abs, "utf8");
}

describe("docs claims vs source truth", () => {
  it("derives a non-empty truth for every gated claim", () => {
    expect(
      LAYER_COUNT,
      "layer registry came back empty — is api/src/lib/layers/registry.ts still exporting LAYERS?",
    ).toBeGreaterThan(0);
    expect(
      BASEMAP_COUNT,
      "basemap registry came back empty — is api/src/lib/basemaps.ts still exporting BASEMAPS?",
    ).toBeGreaterThan(0);
    expect(
      API_ROUTE_COUNT,
      "route walk came back empty — is api/src/app/api still the route tree root?",
    ).toBeGreaterThan(0);
  });

  for (const doc of DOCS) {
    it(`keeps every numeric claim in ${doc} equal to source`, () => {
      const text = readDoc(doc);
      for (const claim of CLAIMS) {
        // matchAll clones the regex, so the shared `g` regexes stay stateless.
        const matches = [...text.matchAll(claim.pattern)];
        // Absence is not a failure: a doc may simply not make that claim.
        if (matches.length === 0) continue;
        for (const match of matches) {
          expect(
            Number.parseInt(match[1]!, 10),
            `${doc} says "${match[0]}" but source has ${claim.truth} ${claim.name} (${claim.source}) — update ${doc} or fix the drift`,
          ).toBe(claim.truth);
        }
      }
    });
  }

  it("states every gated claim in at least one doc", () => {
    const texts = DOCS.map((name) => readDoc(name));
    for (const claim of CLAIMS) {
      const stated = texts.some((text) => [...text.matchAll(claim.pattern)].length > 0);
      expect(
        stated,
        `no doc states the ${claim.name} count (truth: ${claim.truth}, from ${claim.source}) — add it to README.md or CLAUDE.md`,
      ).toBe(true);
    }
  });

  it("keeps the advertised Next.js major equal to the installed dependency", () => {
    expect(NEXT_MAJOR, "could not parse next version from api/package.json").toBeTruthy();
    const texts = DOCS.map((name) => readDoc(name));
    const matches = texts.flatMap((text) => [...text.matchAll(/Next\.js (\d+)/g)]);
    // Absence is not a failure, but once a doc names Next.js it must be right.
    for (const match of matches) {
      expect(
        match[1],
        `a doc says "${match[0]}" but api/package.json installs next ${NEXT_MAJOR} — update the doc`,
      ).toBe(NEXT_MAJOR);
    }
    expect(
      matches.length,
      "no doc mentions Next.js — restore the version claim to README.md or CLAUDE.md",
    ).toBeGreaterThan(0);
  });

  it("keeps the homepage framework claim equal to the installed Next.js major", () => {
    const homepage = readFileSync(path.join(API_ROOT, "src/app/page.tsx"), "utf8");
    const matches = [...homepage.matchAll(/Next\.js (\d+)/g)];
    expect(matches.length, "homepage must state its installed Next.js major").toBeGreaterThan(0);
    for (const match of matches) {
      expect(match[1]).toBe(NEXT_MAJOR);
    }
  });

  it("distinguishes web API elevation sources from the local SDK dataset", () => {
    const footer = readFileSync(path.join(API_ROOT, "src/components/Footer.tsx"), "utf8");
    expect(footer).toContain("Copernicus GLO-30 land");
    expect(footer).toContain("GEBCO 2025 ocean");
    expect(footer).toContain("NASA SRTM 30m");
    expect(footer).toContain("Local SDK");
  });

  it("keeps README basemap display names equal to the registry labels", () => {
    const readme = readDoc("README.md");
    const labels = Object.values(BASEMAPS).map((b) => b.label);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(
        readme.includes(label),
        `README basemap list does not contain registry label "${label}" (api/src/lib/basemaps.ts) — README names and shipped UI labels drifted; fix README or the label`,
      ).toBe(true);
    }
  });

  it("keeps every GEBCO year mention in code-derived prose equal to GEBCO_YEAR", () => {
    const surfaces: readonly [string, string][] = [
      ["README.md", readDoc("README.md")],
      ["CLAUDE.md", readDoc("CLAUDE.md")],
      ["registry.ts", JSON.stringify(LAYERS.map((l) => l.description))],
      ["wmts-capabilities.ts", readFileSync(path.join(API_ROOT, "src/app/api/tiles/wmts-capabilities.ts"), "utf8")],
    ];
    for (const [where, text] of surfaces) {
      const matches = [...text.matchAll(/GEBCO (\d{4})/g)];
      if (matches.length === 0) continue;
      for (const match of matches) {
        expect(
          Number.parseInt(match[1]!, 10),
          `${where} says "${match[0]}" but the GEBCO release in use is ${GEBCO_YEAR} (GEBCO_YEAR in api/src/lib/gebco/tile-math.ts) — fix ${where} or bump GEBCO_YEAR everywhere`,
        ).toBe(GEBCO_YEAR);
      }
    }
  });
});
