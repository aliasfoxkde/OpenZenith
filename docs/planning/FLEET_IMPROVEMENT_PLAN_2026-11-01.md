# Fleet Improvement Plan — 2026-11-01

## Revalidation against current main — 2026-11-01

The Phase 1 list below is the original audit snapshot. Its four claimed
documentation defects were rechecked against the current repository tree
before implementation. They are already resolved in the current source and
must not be re-applied as blind edits:

| Original finding | Current source of truth | Revalidation |
|---|---|---|
| Next.js version prose stale | `api/package.json` pins Next.js 16.4.3; README, CLAUDE.md, `api/README.md`, `api/src/app/about/page.tsx`, and `docs/ARCHITECTURE.md` all say Next.js 16 | Resolved |
| Cesium version/load-path stale | `cesium-init.ts` loads vendored assets first; both jsDelivr and unpkg fallbacks are Cesium 1.146.0; CLAUDE.md records 1.146.0 | Resolved |
| GEBCO year contradiction | Layer registry, dataset manifest, README, CLAUDE.md, and architecture docs identify GEBCO 2025 | No current contradiction found |
| Basemap display labels stale | README's ten display labels match `BASEMAPS` in `api/src/lib/basemaps.ts` | Resolved |

The source-level docs gate already checks the Next.js major against
`api/package.json` and checks every README basemap label against the shared
registry (`api/src/lib/__tests__/docs-claims.test.ts`). Do not duplicate
those checks. The remaining improvement opportunity is to keep the source
gate comprehensive as new cross-file claims are introduced.

**Disposition:** no README, CLAUDE, registry, Cesium, or GEBCO edits are
needed for the original Phase 1 findings. The re-run workstreams and other
gaps below remain open unless their own receipts say otherwise.


Source: audit fleet run of 2026-11-01 (9 workstreams). Only **docs-claims**
completed substantively; edge-cache and frontend-audit returned skeletons and
coverage-plan / next16-plan died on gateway 502/429s — those workstreams are
re-queued below rather than their findings being fabricated.

## Phase 1 — Docs truth fixes (from docs-claims report, all file:line-verified)

All findings below come from `/var/tmp/oz-fleet/work/docs-claims-report.md`.

1. **Next.js version claims say 15, tree is on 16.4.3.** Fix all five sites:
   - `CLAUDE.md:63`, `CLAUDE.md:118`
   - `README.md:196`
   - `api/README.md:3`
   - `api/src/app/about/page.tsx:178` (user-visible tech tag)
   - `docs/ARCHITECTURE.md:11`
2. **CesiumJS claims stale on two counts.** `CLAUDE.md:121` says "1.119 —
   loaded via CDN". Actual: vendored 1.146.0 loaded local-first
   (`cesium-init.ts:11`, `copy-vendor-assets.mjs`), CDN 1.119 is only a
   fallback — and the fallback version itself lags the vendored copy
   (`cesium-init.ts:12-17`). Fix the doc, and bump the fallback URLs to 1.146.0
   (or drop the version-pinned fallback duplication).
3. **GEBCO year contradiction.** Registry says 2024 (`registry.ts:68`); docs say
   2025 (`CLAUDE.md:164`, README data-sources table). Resolve the year once —
   check the actual tile source — and fix whichever side is wrong. Note: this
   class of drift is **ungated** (docs-claims.test.ts only covers counts).
4. **README basemap labels don't match shipped UI labels.** README:255 says
   Voyager/OSM/Topo/Dark No-Labels; registry labels are
   Streets/OpenStreetMap/Topographic/Dark (no labels) (`basemaps.ts:90,116,133,80`).
   Fix README names or align registry labels — pick one naming authority.
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

1. Extend `docs-claims.test.ts` beyond counts: assert the Next.js version in
   prose matches `package.json`, and basemap labels in README match
   `basemaps.ts` labels. — **DONE 2026-11-01** (commit 1a455a8b; 2 new
   assertions, 6/6 pass)
2. Add a source-attribution check for the GEBCO year (single source constant
   consumed by both registry and test). — **DONE 2026-11-01** (commit 7ec4b300;
   `GEBCO_YEAR` in `api/src/lib/gebco/tile-math.ts` now feeds the filename
   builder, filename parser, CEDA URL, registry description, and WMTS
   abstract; `quadNameToBounds` rejects foreign-year filenames; a third gate
   assertion checks every prose surface)

## Explicitly deferred / operator-gated

- Docs-vs-reality item flagged but not decided: whether "81 API routes" should
  count distinct public URLs (>81 with dynamic segments) — current phrasing
  counts route files, which is fine if stated.
- Rust CLI subcommand list (`CLAUDE.md:146`): **verified 2026-11-01** — all six
  (`d8`, `accum`, `reconstruct`, `viewshed`, `stream-order`,
  `gradient-predict`) dispatch in `core/src/main.rs:67-72`. TRUE.

## Receipts

- docs-claims report: `/var/tmp/oz-fleet/work/docs-claims-report.md` (complete,
  file:line-cited)
- Dead-run logs: `next16-plan.log`, `coverage-plan.log`, `edge-cache.log`,
  `frontend-audit.md` (all gateway 502/429 terminations, 2026-11-01)
- Phase 1 execution: commit 1a455a8b (docs truth fixes) + 9f5ce1f5 (minimatch
  direct dep); Dependabot #93 (minimatch <11.0.1) confirmed **fixed**, 0 open
  alerts after the push
- Phase 3 execution: commit 7ec4b300 (GEBCO single-source) — full local vitest
  green at 126 files / 1772 tests; CI unit-test guard baseline updated
  1769 → 1772 in `.gitforge.yml` to match the three new gate assertions
