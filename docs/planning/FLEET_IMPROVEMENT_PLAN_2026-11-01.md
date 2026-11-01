# Fleet Improvement Plan — 2026-11-01

Source: audit fleet run of 2026-11-01 (9 workstreams). Only **docs-claims**
completed substantively; edge-cache and frontend-audit returned skeletons and
coverage-plan / next16-plan died on gateway 502/429s — those workstreams are
re-queued below rather than their findings being fabricated.

## Phase 1 — Docs truth fixes (from docs-claims report, all file:line-verified)

All findings below come from `/var/tmp/oz-fleet/work/docs-claims-report.md`.

1. **Next.js version claims say 15, tree is on 16.4.3.** **Resolved 2026-11-01**
   (commit `1a455a8b`) — all six sites now say 16: `CLAUDE.md` (architecture +
   frontend sections), `README.md:196`, `api/README.md:3`,
   `api/src/app/about/page.tsx:178` (user-visible tech tag),
   `docs/ARCHITECTURE.md:11`. The drift class is **gated**: `docs-claims.test.ts`
   asserts every `Next.js <major>` mention in README/CLAUDE.md equals the
   `next` dependency's major in `api/package.json`.
2. **CesiumJS claims stale on two counts.** **Resolved 2026-11-01** (commit
   `1a455a8b`) — docs now state the vendored 1.146.0 loaded local-first, with
   the CDN as a fallback; the CDN fallback URLs in `cesium-init.ts:12-17` were
   bumped from 1.119 to 1.146.0 so the fallback no longer lags the vendored
   copy.
3. **GEBCO year contradiction.** Registry said 2024 (`registry.ts:68`); docs said
   2025 (`CLAUDE.md:164`, README data-sources table). **Resolved 2026-11-01** —
   the live source is GEBCO 2025 (CEDA `gebco_2025_*` quadrants), so the year is
   now a single constant `GEBCO_YEAR` in `api/src/lib/gebco/tile-math.ts`,
   consumed by the registry description, the WMTS abstract, the CEDA base URL,
   and the quadrant filename builder/parser. The drift class is **gated**:
   `docs-claims.test.ts` asserts every `GEBCO <year>` mention in README, CLAUDE.md,
   the registry description, and the WMTS source equals `GEBCO_YEAR`.
4. **README basemap labels don't match shipped UI labels.** README:255 said
   Voyager/OSM/Topo/Dark No-Labels; registry labels are
   Streets/OpenStreetMap/Topographic/Dark (no labels) (`basemaps.ts:90,116,133,80`).
   **Resolved 2026-11-01** — the registry is the naming authority and README
   now lists all ten registry labels verbatim. The drift class is **gated**:
   `docs-claims.test.ts` compares the README basemap bullet's label set against
   the registry's label set (set equality, not substring presence).
5. **Counts verified TRUE (no action):** 62 layers, 81 route files, 36 CLI
   subcommands, 15 MCP tools, 10 basemaps, 31 highlight rows.

## Phase 2 — Re-run the dead workstreams

Gateway permitting, re-run as forks (bounded, one at a time to avoid the
circuit breaker):

1. **edge-cache design review** — skeleton at
   `/var/tmp/oz-fleet/work/edge-cache-review.md`; the outline (cache-key
   collisions, freshness/SWR headers, negative caching of upstream 4xx/5xx,
   cold z11 origin-hit count) is already there — fill it.
2. **frontend map/globe audit** — skeleton at `frontend-audit.md`, same deal.
3. **coverage-plan** — died on 429/502; re-run.
4. **next16-plan** — Next.js 16/OpenNext migration plan; the migration doc
   `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md` already exists, so the ask is
   a review/update against the current 16.4.3 tree, not a fresh plan.

## Phase 3 — Gates to close the ungated drift class

**Both items closed 2026-11-01** (same `docs-claims.test.ts` file, one unit-test
job — no new CI job):

1. Next.js version gate — the test parses `next` out of `api/package.json` and
   asserts every `Next.js <major>` mention in README.md and CLAUDE.md equals
   it; a doc that stops mentioning Next.js fails (the claim must not silently
   disappear).
2. Basemap label gate — the README basemap bullet's bolded label set must
   equal the registry's label set exactly.
3. GEBCO source-attribution gate — the year is one constant
   (`GEBCO_YEAR` in `api/src/lib/gebco/tile-math.ts`), consumed by the layer
   registry description, the WMTS capabilities abstract, the CEDA base URL,
   and the quadrant filename builder/parser. The test asserts every
   `GEBCO <year>` mention in README, CLAUDE.md, the registry descriptions, and
   the WMTS source equals that constant.

## Explicitly deferred / operator-gated

- Docs-vs-reality item flagged but not decided: whether "81 API routes" should
  count distinct public URLs (>81 with dynamic segments) — current phrasing
  counts route files, which is fine if stated.
- Rust CLI subcommand list (`CLAUDE.md:146`): **verified 2026-11-01** — all six
  (`d8`, `accum`, `reconstruct`, `viewshed`, `stream-order`,
  `gradient-predict`) dispatch in `core/src/main.rs:67-72`. TRUE.
- GEBCO year gate (Phase 3 item 2) — **closed 2026-11-01**: single-source
  constant + drift gate now in place (see Phase 3 item 3).

## Receipts

- docs-claims report: `/var/tmp/oz-fleet/work/docs-claims-report.md` (complete,
  file:line-cited)
- Dead-run logs: `next16-plan.log`, `coverage-plan.log`, `edge-cache.log`,
  `frontend-audit.md` (all gateway 502/429 terminations, 2026-11-01)
