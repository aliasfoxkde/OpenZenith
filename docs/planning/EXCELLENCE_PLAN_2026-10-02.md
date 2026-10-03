# Excellence Plan — 2026-10-02 (quality, docs, coverage, hygiene)

**Mandate:** systematic repo excellence pass — honest gap analysis, phased
execution: cleanup, strictest linting, 99% test/code/docs coverage, WCAG 2.1
AAA, code smells, E2E + GitForge CI validation, Aegis scanning, release +
deploy. No placeholders, no fake data, no fake metrics: every target below is
defined so it can be *measured*, and every exclusion is justified in writing.

**Inputs:** four parallel audits (lint/type strictness, documentation
coverage, code smells & structure, a11y/E2E coverage) plus live gate runs and
a sibling-repo best-practices scan (GitForge, StationAware, kubix). Audit
evidence is cited as `file:line` where it anchors a work item.

---

## 1. Baseline (verified 2026-10-02, `main` = 36a65d8, all three remotes in sync)

| Gate | State | Source |
|---|---|---|
| eslint (api/) | **0 errors**, **3,759 warnings** — the CI baseline (≤3,744) is now RED by +15 from the 2026-10-02 perf/landing work (first GitForge run caught it; fix in Phase 2 entry) | `api/eslint.config.mjs:42-51`, `.gitforge.yml` lint job, live run + local run 2026-10-02 |
| tsc (api/) | clean (`strict: true` only; `noUncheckedIndexedAccess` etc. absent) | audit §2 |
| vitest (api/) | floors 97/92/89/97; coverage **counts only `src/lib/**` + `src/app/api/**`** — globe/map/landing/studio/components/hooks are outside the instrumented set entirely | `api/vitest.config.ts:16-22` |
| pytest (openzenith/) | **1,479 passed / 14 deselected, 98.82% lines** (floor 97; 171 uncovered lines stand between here and the 99% target) | `pyproject.toml:103`, live run 2026-10-02 |
| cargo (core/) | fmt OK · clippy `-D warnings` OK · **51/51 tests pass** | live run 2026-10-02 |
| aegis | baseline 1,716 in `docs/security/aegis-baseline.json`; **local-only gate — not wired into the pipeline** | `.gitforge.yml` header |
| GitForge CI | `openzenith-ci` pipeline exists; push trigger materializes it; **no run had ever executed** until this pass; CLI `--run` POST decode error (platform CLI/server mismatch, see §5 P7) | live probe 2026-10-02 |
| OpenAPI | 80/80 routes in spec, version-locked, machine-gated (`openapi:check`) | audit §5 |
| a11y | axe `wcag2a+aa+aaa+best-practice` on 8 pages, green; **canvases unlabelled, 3 pages unaudited, zero keyboard/target-size checks** | `api/e2e/a11y.spec.ts` |
| npm audit | 5 dev-only residuals (esbuild, undici via miniflare) — accepted with rationale | memory + TRIAGE |

**Honest coverage statement:** "99% coverage" today is true only of the
*instrumented* surface (`src/lib` + API routes; Python SDK; Rust core). The
frontend (React components, page shells) has no harness at all (jsdom present,
no @testing-library). This plan measures and raises the instrumented surface
to ≥99% lines and *explicitly documents* the frontend boundary rather than
claiming a repo-wide number that doesn't exist.

---

## 2. Gap register (ranked; F-IDs referenced by phases)

| ID | Finding (evidence) | Impact |
|---|---|---|
| F-1 | `no-explicit-any` is nominal: **108 inline waivers**, 183 prod type escapes, ambient `Response.json(): Promise<any>` (`api/src/global.d.ts:5-9`) | type safety decorative at fetch/Cesium/MapLibre boundaries |
| F-2 | eslint warning ceiling 3,744 codified in CI as a ratchet | no pressure toward zero |
| F-3 | **9,887 LOC parallel globe/map layer stacks**, 8 near-identical pairs; ~24 copy-pasted raster layer files (map side) with drift already present (`ndvi.ts` forked guards) | 2× work per layer; drift |
| F-4 | root `tests/` is dead (never run: `pyproject.toml:102`, `ci.yml:49` target `openzenith/tests/`) and stale-diverged from `openzenith/tests/` (223–392-line diffs) | false test surface |
| F-5 | Placeholder-stub behaviors shipped: `api/src/app/api/gps-jamming/route.ts:16` ("placeholder stub" synthetic data); `openzenith/terrain/raster.py:277` (silent `0.0` for unimplemented metric) | violates repo no-placeholder policy; zeros read as data |
| F-6 | Layer catalog maintained 3 ways (`registry.ts` 664 lines + 56-entry hand-written loader map + 28 globe files) | silent divergence |
| F-7 | 7 copy-pasted `stubFetch` test helpers (2 byte-identical) | hermeticity fixes must be applied 7× |
| F-8 | mcp-server: ungoverned island — no lint, no typecheck script, no CI job, **tracked `.next/trace` artifacts**, hardcoded prod BASE_URL | contract drift undetectable |
| F-9 | Root strays tracked with **zero references**: `Dockerfile`, `docker-compose.yml`, `examples/` (only a README with a broken import), root `package.json` (Vercel-era) | repo noise; broken snippet |
| F-10 | Docs drift: README layer count 54 (actual 62), basemaps 9 (actual 10), test counts stale, R2 shown as active (deleted 2026-09-27); `CLAUDE.md` "54 layers / `terrain.py` / Click CLI / OZT2R2Backend" all stale; ARCHITECTURE.md 12 stale refs; `.gitforce.yml` misspelling in CHANGELOG+MASTER_PLAN | agents and contributors read wrong facts |
| F-11 | docs/CLAUDE.md canonical list missing 4 active docs; false claim that all archive files carry archival headers (18/21 don't); `docs/globe/README.md` stale + uncategorised | doc index not trustworthy |
| F-12 | TS JSDoc ~65% on sampled lib surface; 28/80 route files have no header comment; Python 97.6% (6 missing); rustdoc missing 4 `pub mod` docs, no `missing_docs` lint | docs coverage target unmet |
| F-13 | A11y: `/api/docs`, `/wasm-demo`, `/not-found` unaudited; `<main>` missing on `/api/docs` + `/wasm-demo`; all map/globe/hero/studio canvases lack `role`/`aria-label` (axe blind); no keyboard-traversal, focus-appearance, or target-size checks anywhere | real AAA gaps axe cannot see |
| F-14 | ruff far from ALL-adjacent (no S/ANN/PL/PERF/RET/ARG/N/TC/ERA groups; 286 errors under current config incl. 12 commented-out-code); **mypy not configured at all** | Python strictness gap |
| F-15 | GitHub `ci.yml` **auto-deploys to prod**, contradicting `.gitforge.yml`'s documented no-auto-deploy policy; no "non-authoritative mirror" header on any workflow | policy contradiction; two deploy paths |
| F-16 | No `.github/SECURITY.md`, CONTRIBUTING, CODEOWNERS; no findings register with stable IDs; no aegis CI job (kubix pattern) | governance gaps |
| F-17 | `console.log` residue in `dem-tile` route handler; 30 `print()` sites in SDK library modules (embedded CLI `main()`s in `converter.py`/`merged.py`) | log hygiene |
| F-18 | Perf residue from 2026-10-02 pass (task #174): abort-on-teardown typed slice, quiet-host re-measure, toggle crawl | open follow-ups |

---

## 3. Phases

Ordering rationale: hygiene first (cheap, de-risks everything after), then
lint/type strictness (its fixes touch many files — do before coverage/docs so
tests and docs describe the final shape), then coverage, docs, a11y, smells,
and validation/release last. Each phase ends committed+pushed (gitforge first)
and Aegis-scanned.

### Phase 0 — Audit (complete)
F-1…F-18 recorded above; live baselines in §1.

### Phase 1 — Repository cleanup (F-4, F-9, part F-8)
1. Remove tracked dead files (each zero-reference, verified by audit):
   root `Dockerfile`, `docker-compose.yml`, `examples/` (README with broken
   `marching_squares` import is its only content), root `tests/` (stale
   ancestors of `openzenith/tests/`, never executed). `git rm` — history
   preserves them; no `rm -rf` of anything untracked-and-unneeded without
   trash-dir move.
2. Untrack `mcp-server/.next/trace*` (gitignored pattern already exists at
   `.gitignore:9`; files predate the rule) + add `.gitignore` entries for
   `.smoke-persist-*/`, `.pkgprobe/` if still absent.
3. Root `package.json`: verify no consumer (Vercel-era `vercel-build`); if
   Pages deploy path (`api/` + wrangler) is confirmed sole path, remove it and
   root `node_modules` reference in docs.
4. `scripts/__init__.py` (0 bytes) + `__pycache__`: drop if unreferenced.
5. Decide `docs/globe/README.md`: archive with header (stalest doc, refs two
   deleted files) — refresh is not worth it while globe architecture is
   documented in MASTER_PLAN + code.
6. Aegis scan after the deletion slice (expected: fewer findings, baseline
   update only if legit).

**Verify:** `git status` clean; all gates re-run green; grep proves removed
paths have no dangling references in docs/CI.

### Phase 2 — Strictest linting (F-1, F-2, F-14, part F-8)
The big lift. Slices, each independently green (tsc + eslint + vitest):
1. **Slices to zero eslint warnings** — the 3,744 are `no-unsafe-*` +
   `restrict-template-expressions` on globe/map/landing boundaries. Work
   module-family by module-family (data-fetchers → layers → widgets →
   components → routes residue), typing fetch responses at the boundary
   (kills the `global.d.ts` `Promise<any>` ambient escape last, once callers
   are typed). Budget a tsc + focused-lint fixup pass per file (established
   recipe: graduating warnings surfaces new error classes that `any` hid).
2. Promote `no-unsafe-*` to **error**; re-tune `restrict-template-expressions`
   explicitly; lower CI baseline to 0 (make it a hard zero gate).
3. tsconfig strict flags in slices: `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
   `noUnusedLocals`/`noUnusedParameters`; evaluate
   `exactOptionalPropertyTypes` last (most invasive; if the blast radius is
   disproportionate, record the decision here with counts).
4. Resolve the 108 `no-explicit-any` waivers file-by-file (type it, or convert
   to a justified narrow escape with reason). Remove dead devDeps
   (`eslint-config-next`, `eslint-config-prettier`) **or** wire
   eslint-config-prettier in if prettier is a real gate (`format:check`).
5. ruff: adopt strict groups in slices with measured counts first
   (S/ANN/PL/PERF/RET/ARG/N/TC/ERA ≈ 3,000+ raw hits — triage: fix, configure
   (e.g. ANN for tests), or per-file-ignore with justification; no bulk
   noqa). Add `ERA001` (12 commented-out-code) immediately.
6. mypy: introduce `[tool.mypy]` (start `disallow_untyped_defs` on
   `openzenith/`, non-test), fix findings incrementally, wire into a gate.
7. clippy: add `clippy::pedantic` as warn→fix→deny where measured-cheap
   (core is 1,722 LOC; documented cast declines stay); add
   `missing_docs` warn + document the 4 `pub mod`s.
8. mcp-server: add eslint + `typecheck` scripts, strict tsconfig flags, its
   own lint/typecheck/test jobs in `.gitforge.yml`; untrack `.next/trace*`.
9. Update `.gitforge.yml` baselines as slices land (3744 → 0; vitest counts
   when tests are added in Phase 3).

**Verify:** eslint `-W 0` style gate (warnings=errors), tsc clean per flag,
ruff/mypy green under new config, CI green.

### Phase 3 — Coverage to ≥99% of the instrumented surface (target: lines)
1. Fresh vitest coverage run → per-file uncovered report; add **real** tests
   (route handlers, lib edge cases) until lines ≥99%, functions ≥95 within
   the existing instrumented set; no mock-only tests that assert mocks.
2. Python: coverage report → close the gap to ≥99% lines (98.8% now);
   `raster.py` metric work in F-5 may add covered code paths naturally.
3. Rust: identify the uncovered fraction (CLI main error branches expected);
   add integration tests; target ≥99%.
4. Raise the floors to match reality: vitest thresholds 99/…, pytest
   `--cov-fail-under=99`, cargo gate documented; update `.gitforge.yml`
   completeness guard counts (99 files / N tests → new truth).
5. Explicitly out-of-scope, documented: component-test harness
   (@testing-library + jsdom) for globe/map/landing React trees — a harness
   decision with its own plan; NOT silently claimed in any coverage number.

**Verify:** coverage reports in the plan's progress log; floors enforced in
config so the number cannot regress.

### Phase 4 — Documentation coverage (F-10, F-11, F-12)
Definition of "documentation coverage" for this repo (measured, not vibes):
(a) Python docstrings ≥99% of public symbols (97.6% now — 6 missing);
(b) rustdoc 100% incl. `pub mod` lines + `missing_docs` warn (Phase 2);
(c) TS JSDoc ≥95% on exported symbols of `src/lib/**` + `app/**/lib/**`
(65% sampled now — count precisely, then fill);
(d) route header docs 80/80 (52/80 now);
(e) zero stale references in active docs (12 known, list in F-10);
(f) docs index accurate with swept-date.
Work items:
1. Fix README.md + root `CLAUDE.md` + `docs/ARCHITECTURE.md` drift (counts,
   R2 removal, terrain/ packages, argparse CLI, `.gitforce.yml` spellings).
2. docs/CLAUDE.md: add the 3 unlisted planning docs, resolve
   `docs/globe/README.md` (Phase 1), fix the archive-headers claim **by
   adding the 18 missing headers**.
3. Mechanical docstring fills (Python 6, rust 4, TS JSDoc, 28 route headers).
4. Create `api/README.md` (scripts, dev server, deploy path, env vars) and
   `.github/SECURITY.md` (points at `docs/security/TRIAGE.md` policy).
5. Add a **docs-claims gate** (`scripts/check-doc-claims.mjs`): README/CLAUDE
   numeric claims (layer count, basemap count, route count) are asserted
   against the registry/config truth in CI — the "99% docs coverage"
   enforcement mechanism, modeled on perf-budget.mjs.
6. `docs/README.md` numbered reading-order index with last-swept date
   (StationAware pattern).
7. `OPZENITH_DATA_REPO.md`: header marking it as a spec/proposal, not current
   state.

**Verify:** doc-claims gate green; grep sweep for stale paths returns only
archive/; docstring counters re-run and recorded.

### Phase 5 — WCAG 2.1 AAA expansion (F-13)
1. Add `/api/docs`, `/wasm-demo`, `/not-found` to `a11y.spec.ts` PAGES;
   add `<main>` landmarks to `/api/docs` + `/wasm-demo` (real axe findings
   once audited).
2. Label all first-party canvases (`role="img"` + `aria-label` describing the
   live map/globe) — closes the 1.1.1 blind spot axe cannot see.
3. New keyboard-traversal checks: Tab-order smoke per page, focus-visible on
   first-party controls, no-keyboard-trap on the flip card + tabs (2.1.1,
   2.4.3, 2.4.7).
4. Programmatic target-size check for first-party interactive controls
   (≥24×24 enforced; 44×44 reported as AAA delta per MASTER_PLAN §Phase C).
5. landing.spec.ts: uniform hydration marker wait (RELIABILITY_GAPS open
   item; a11y spec already has the pattern).
6. Keep the vendor-scope filter (log-not-fail) and the animation freeze;
   document both in the spec header.

**Verify:** full a11y suite green on chromium+firefox (load-permitting — the
suite is a local gate; NAS load flake discipline applies).

### Phase 6 — Code smells (F-3 partial, F-5, F-6 partial, F-7, F-17, F-18)
1. **Raster-layer factory** (map side): collapse ~24 identical 22–43-line
   layer files to one `createRasterLayer(config)` + data table; delete the
   `ndvi.ts` fork. Verified by map E2E + layer-by-layer toggle smoke.
2. Test-helper dedup: one `stubFetch` family in `__tests__/helpers.ts`.
3. `gps-jamming` route: investigate a real upstream (daily GPS jamming maps
   exist publicly); if none is licensable/reliable, the honest fix is a
   clearly-labeled simulated dataset — the route comment and the UI layer
   description must say "simulated" (no more "placeholder stub" language),
   recorded here as a product decision.
4. `terrain/raster.py:277`: implement the local-I metric properly or return
   documented NaN + raise in the docstring what's unimplemented — never
   silent zeros.
5. `dem-tile` route `console.log` → structured diagnostics; SDK `print()`
   sites: route through `logging` (module loggers), keeping CLI output on
   stdout only in `cli.py`.
6. `useToast` orphan (only dead export in api/src): wire or remove.
7. Perf residue (task #174): typed abort-on-teardown slice (make `signal`
   required so tsc enumerates all ~45 call sites), then quiet-host re-measure
   (loadavg < 12 gate) and the live toggle crawl.
8. Layer-catalog unification (F-6 full) and globe/map layer-stack merge
   (F-3 full) are **logged as architecture decisions, not scheduled here** —
   they are multi-session refactors; this pass does the mechanical pieces
   (items 1-2) and leaves the seam documented.

**Verify:** vitest+pytest+build green per slice; aegis scan; manual map-layer
toggle smoke for item 1.

### Phase 7 — Validation (E2E + GitForge CI + F-15, F-16)
1. GitForge: runs triggered via raw API (CLI `--run` has a response-decode
   bug — recorded as platform feedback, not an OpenZenith defect); drive the
   openzenith-ci pipeline to **green on main**, watching job logs; re-run
   under load-quiet if NAS flakes bite (documented runner reality).
2. Evaluate wiring aegis into the pipeline as a baseline-gated job (kubix
   pattern — needs a runner image or host binary path; document decision).
3. Full local E2E (chromium+firefox) + prod E2E via `scripts/ship.sh` path.
4. Fix F-15: remove the prod auto-deploy job from `.github/workflows/ci.yml`;
   add the "GitHub mirror validation — NON-AUTHORITATIVE" header to all three
   workflows (StationAware pattern). Keep `publish-pypi.yml` (release path).
5. F-16: SECURITY.md (Phase 4), findings register = F-table above (adopt the
   F-NN convention repo-wide).

**Verify:** GitForge run green; E2E green; no workflow on GitHub can deploy.

### Phase 8 — Release + closeout
1. Version bump in the lockstep trio (api/package.json,
   openzenith/__init__.py `__version__`, openapi spec info.version) —
   patch/minor decided by what landed (SDK behavior fix ⇒ minor candidate).
2. `.github/CHANGELOG.md` entry (Keep-a-Changelog style, matching existing
   entries); fix its `.gitforce.yml` misspelling while there.
3. Tag + push both remotes, **verify tags on both explicitly** (memory
   procedure); GitHub release via `gh` with changelog body.
4. Deploy via `scripts/ship.sh` (build → bundle-marker → deploy → prod E2E);
   prod cache/X-Cache spot checks.
5. Docs closeout: this file's progress log, MASTER_PLAN progress entry,
   HANDOFF update, memory updates (gate baselines).

---

## 4. Adopted practices (sibling scan)

- F-NN findings register (StationAware) — adopted as §2.
- "NON-AUTHORITATIVE" header on GitHub workflows (StationAware/GitForge).
- Aegis as a CI job against the committed baseline (kubix) — evaluated P7.
- Numbered reading-order docs index + swept date (StationAware).
- Completeness guard asserting exact test-file counts (already present here;
  keep counts in sync).
- Zero-warning lint gate + prettier/format gate (StationAware).
- docs-claims gate (this plan's invention, modeled on perf-budget.mjs).

## 5. Non-goals / honest boundaries

- **No fake coverage/docs numbers.** The frontend React tree has no component
  test harness; coverage claims are scoped to the instrumented surface and
  say so.
- **globe/map layer-stack unification** (F-3/F-6 full) is an architecture
  decision, deliberately not squeezed into this pass.
- **exactOptionalPropertyTypes** adopted only if its blast radius is
  proportionate; otherwise recorded with counts.
- **next-on-pages → OpenNext/Next 16** remains user-gated
  (NEXTJS16_OPENNEXT_MIGRATION.md).
- NAS load: E2E and wall-clock measurement gates respect `/proc/loadavg < 12`
  for anything timing-sensitive; deterministic gates run regardless.

## 6. Progress log

- 2026-10-02/03: audits complete (4 parallel + sibling scan); baseline §1
  recorded; core gates green (fmt/clippy/51 tests); ruff strict-group census
  taken (286 errors current config; ~3.0k under proposed groups); GitForge
  CI: first-ever run executed on push (event-drain stall resolved in current
  build) and **correctly failed** the lint job — +15 warning regression from
  the 2026-10-02 perf/landing work (3,759 vs 3,744), proving the baseline
  guard works; CLI `pipeline --run` has a separate response-decode bug
  (platform feedback, not an OZ defect). pytest live baseline: 1,479 passed
  / 14 deselected, 98.82% lines. vitest coverage baseline in flight.
