# OpenZenith Master Plan — 2026-09-22

Status: active · Baseline: v0.8.2 (post-deploy `1e99b1b1`, HEAD `8d6d738`) ·
Supersedes nothing; extends `IMPROVEMENT_PLAN_2026-09-21.md` (Phases 1–7 complete)
with the quality-ratchet program: strictest linting, 99%-coverage trajectory,
WCAG 2.1 AAA, code smells, security scanning, GitForge CI validation, docs.

Every number below is measured on 2026-09-22 unless marked historical.

---

## 1. Honest assessment

**Where the project stands.** The 2026-09-21 plan drove coverage from 43.95% to
92.1% statements, fixed 16 real production bugs en route, shipped the basemap
registry + diagnostics invariants, landed full z11 OZT2 in R2 (595,149 tiles),
and deployed v0.8.2 with a green local parity chain. The surface is healthy.

**Where it falls short of "highest quality"** (the goal of this plan):

1. **Lint gates are far weaker than the code.** ESLint runs
   `recommended`, not `strictTypeChecked`; `no-explicit-any` is a warning;
   `react-hooks/exhaustive-deps` is off. Ruff (Python) at the strict selection
   set reports **518 findings**. Clippy is clean but has no curated pedantic
   denies to keep it that way.
2. **Coverage gates lie below reality.** Vitest thresholds are 70/50/70/70 while
   actuals are 92.1/83.25/81.25/92.1 — a regression to 75% would pass CI.
   Python has no enforced coverage gate at all (82% measured).
3. **Security scanning is ad hoc.** Source-scoped Aegis scan finds **7,434**
   findings (2 critical / 727 high / 1,032 medium), none triaged, no baseline,
   no gate. (Historical "12,200 findings, zero HIGH/CRITICAL" in the 09-21 doc
   was a repo-root scan with generated artifacts included and a different
   profile — the source-scoped numbers here supersede it.)
4. **Five tests are not hermetic** (fall through to the live network when
   single-shot mocks miss) — they pass today and fail under load.
5. **Monoliths remain**: `map/page.tsx` 2,993 lines, `explore/page.tsx` 1,633,
   `globe/page.tsx` 1,507, `terrain.py` 3,297, `hydrology.py` 2,415.
6. **CI on the primary platform does not execute runs.** GitForge push triggers
   fire (pipeline object materializes) but runs stall on the known event-drain
   defect. GitHub Actions is billing-blocked. CI validation must be recorded
   honestly, not claimed.
7. **Accessibility reached AA** (Phase 3 of the 09-21 plan); AAA has not been
   audited (contrast ≥ 7:1, reading level, full keyboard maps, no-timing).

**The 99% goal, stated honestly.** "99% test, code, and documentation coverage"
is interpreted as: (a) *test* coverage — vitest thresholds ratcheted to ≥ 95%
statements/lines and ≥ 90% branches/functions in this program, with the
remaining gap itemized per file rather than hidden (99/99 is pursued; Cesium/
MapLibre browser-only glue carries an honest floor of `// node:coverage-ignore`
annotations, not silent exclusion); (b) *code* coverage — same numbers plus a
Python gate (≥ 95% statements) and Rust `llvm-cov` gate wired the same way;
(c) *documentation* coverage — every public SDK symbol, every API route, and
every app segment documented with zero stale claims, enforced by a docs
consistency check, not vibes. Anything short of 99 is reported as a number with
a named reason, never rounded up.

---

## 2. Measured baseline (2026-09-22)

### 2.1 Tests & coverage

| Suite | Result | Coverage (stmts / branch / func / line) | Enforced gate |
|---|---|---|---|
| TS (api/, vitest) | 977 pass / 5 skip, 92 files | 92.1 / 83.25 / 81.25 / 92.1 | 70 / 50 / 70 / 70 (too low) |
| Python (pytest) | 718 pass / 8 skip | 82.0 (1,971 / 10,934 missed) | none |
| Rust (core) | 17 tests | not measured under llvm-cov | clippy only |

Weakest TS files (statements): vessels 57.1 · hurricanes 57.6 · sentinel2 59.8 ·
r2-binding 60 · flights 62.8 · population 64.9 · reverse-geocode 67.2 ·
landcover 68.4 · opensky 69.0 · satellites 69.3.

Weakest Python modules: vector.py 55 · viz.py 67 · tracing.py 82 ·
tile_format_v2.py 84 · converter (tests) 77.

### 2.2 Lint & static analysis

| Tool | Current state | Gap |
|---|---|---|
| ESLint 9 | `recommended` + `tseslint.recommended`; `no-explicit-any: warn`; `exhaustive-deps: off`; 5 react-hooks compiler rules off | strictTypeChecked set, warnings → errors |
| Ruff | unconfigured default run | strict selection set → **518 findings** |
| Clippy | `-D warnings` clean | no curated pedantic/nursery denies |
| Aegis | ad hoc | no baseline, no gate, no excludes |

### 2.3 Aegis source-scoped scan (2026-09-22)

| Scope | Findings | Critical | High | Medium |
|---|---|---|---|---|
| api/src | 4,690 | 2 | 694 | 956 |
| openzenith/ | 2,251 | 0 | 21 | 39 |
| core/src | 77 | 0 | 6 | 20 |
| scripts/ | 416 | 0 | 6 | 17 |
| **total** | **7,434** | **2** | **727** | **1,032** |

Triage of the criticals: both are `git-credential-leak` matches on
`https://example.com/{z}/{x}/{y}.png` **test-fixture URLs** in
`api/src/app/api/__tests__/proxy-tile.test.ts:12,21` — no credentials exist;
they are heuristic false positives and go into the baseline with a recorded
reason. Top api rules: llm-guardrails 424 (PII-marker wording in page copy),
web-security 95 (concentrated in test files + explore/cache libs), pii 75.
High-severity `env-credential-assignment` hits are `process.env.X ?? default`
reads — normal Edge-runtime config, to be triaged per-file into the baseline.

### 2.4 Structural hot spots (code smells)

- `api/src/app/map/page.tsx` — 2,993 lines (largest surface, most state)
- `api/src/app/explore/page.tsx` — 1,633 lines
- `api/src/app/globe/page.tsx` — 1,507 lines
- `openzenith/terrain.py` — 3,297 lines · `hydrology.py` — 2,415 lines
- `api/src/app/api/openapi.json` co-resident with a 1,213-line `route.ts`
  (generated spec risk: two sources of truth)
- 5 hermeticity-defect test files (see §3 Phase A)

### 2.5 CI/CD reality

- GitForge is primary: push trigger fires, run execution stalls (event-drain,
  GitForge-side defect, already surfaced). Tokens must come from the user's
  interactive `gitforge auth --login`; never stored in the repo.
- GitHub Actions: billing-blocked; red runs there are not a code signal.
- Deploy path proven: `pages:build` → artifact verify → `pages:deploy` →
  production verify (v0.8.2, `1e99b1b1`).

---

## 3. Phases

Order is deliberate: hermeticity and lint first (they gate everything after),
coverage ramp next, then a11y/smells/security, then CI + docs + release.
Each phase ends with the full parity chain green and a commit to both remotes
(gitforge first).

### Phase A — Hermeticity + strictest linting (task #86)

**A1. Fix the 5 network-fallthrough tests first** (nlnog, proxy, airquality,
wildfires ×2): they use single-shot `mockResolvedValueOnce` and reach the live
network on any extra fetch. Convert to `mockResolvedValue` (or per-URL routers)
and add a `afterAll` assertion that `fetch` was never called with a non-localhost
origin inside route tests — a repo-owned hermeticity guard, not a one-off fix.

**A2. ESLint to strictest set** (`api/eslint.config.mjs`):
- `tseslint.configs.strictTypeChecked` with typed-lint `projectService`;
- `no-explicit-any: error`, `no-unused-vars: error`,
  `react-hooks/exhaustive-deps: error`;
- re-evaluate the 5 disabled react-hooks compiler rules with evidence (enable
  or record why not);
- keep `src/lib/wasm/` ignored (generated); drop any other blanket ignores.

**A3. Ruff to strict set** (`pyproject.toml [tool.ruff]`):
`select = E,W,F,I,B,C4,UP,SIM,RUF,PTH` + `D` (pydocstyle) on `openzenith/`;
518 findings → 0, fixing root causes (no blanket per-file-ignores except
generated code).

**A4. Clippy curated denies** (`core/src/lib.rs` or `core/Cargo.toml`
`[lints.clippy]`): `pedantic` at `warn`, deny the high-signal subset
(`unwrap_used`, `expect_used`, `panic`, `integer_division`,
`float_cmp`) — production paths only; tests may `allow`.

**A5. CI mirror**: every gate above runs in `.gitforce.yml` and the local
parity script; no gate suffixed with `|| true`.

Exit criteria: `eslint`, `tsc --noEmit`, `vitest`, `ruff check`, `pytest`,
`cargo fmt/clippy/test` all clean at the strictest configured level.

### Phase B — Coverage ratchet (task #87)

**B0. Make the gates honest today (zero-cost):** vitest thresholds 70/50/70/70 →
**92/83/81/92** (current actuals). Ratchet rule: thresholds only move up, and
they live in exactly one file (`vitest.config.ts`) — no duplicate numbers in
CI scripts.

**B1. TS per-file climb** (target: statements ≥ 95, branches ≥ 90, functions ≥
92 by program end; stretch 99 where the file is node-testable):
1. Tier 1 (route handlers, pure logic): vessels, hurricanes, sentinel2,
   flights, population, reverse-geocode, landcover, opensky, satellites,
   r2-binding — parameterized suites over the shared fetch/cache shape.
2. Tier 2: the long tail below 80% discovered from the coverage report.
3. Browser-only glue (Cesium/MapLibre init blocks): annotate
   `// node:coverage-ignore` with a one-line reason and track them on a list in
   this doc — visible exclusion, not silent.

**B2. Python gate**: add `--cov-fail-under=82` now, ratchet +2 per phase to
≥ 95; lift `vector.py` (55) and `viz.py` (67) first (real gaps, not glue).

**B3. Rust**: wire `cargo llvm-cov --fail-under` with the measured baseline as
the starting gate (measure first — never guess a threshold).

**B4. Flake budget**: 5 known-hermeticity failures must read as CI failures, so
A1 precedes this phase; `--coverage.reportOnFailure` stays for diagnostics only.

### Phase C — WCAG 2.1 AAA audit (task #88)

Scope: map, globe, explore, studio, landing, demo surfaces.
1. Automated pass first: axe-core in Playwright against every route
   (new `e2e/a11y.spec.ts`) with AAA ruleset; record the finding list in this
   doc before touching code.
2. Known AA→AAA deltas to address: contrast ≥ 7:1 for body text (`textMuted
   #64748b` and globe `#666/#555` tokens), target size ≥ 44×44 css px
   (2.5.5) beyond the AA 24px fix, no timing constraints (2.2.1), consistent
   help location (3.2.6), accessible authentication is N/A (no auth).
3. Re-run axe until zero AAA violations; add the spec to the parity chain so
   regressions fail CI.

### Phase D — Code smell cleanup (task #89)

1. `map/page.tsx` extraction, following the proven `globe/lib/{widgets,tools,
   layers}` pattern: `map/lib/{widgets,layers,state}`; page keeps only
   composition. Land in ≤ 5-commit slices, each verified in-browser (light +
   dark). Then explore, then globe.
2. `terrain.py` (3,297) and `hydrology.py` (2,415): split into
   `terrain/{slope,aspect,hillshade,viewshed,profile}.py` and
   `hydrology/{d8,accum,streams,trace}.py` with the current module names kept
   as re-export facades so the public API and tests are untouched.
3. `openapi.json` vs 1,213-line `route.ts`: single source of truth — generate
   the spec from route metadata, add a drift test.
4. Registry/`any`-shaped duplication found by ESLint strict (A2) is fixed here,
   not suppressed.

### Phase E — Security scanning integrated (task #90)

1. Commit `aegis.toml`/profile excluding generated artifacts
   (`api/public/pkg/`, `output/`, `data/`, `node_modules/`, `.next/`).
2. Commit `docs/security/AEGIS_BASELINE.json` (strip volatile timestamps;
   fingerprints are the key) + `docs/security/TRIAGE.md` — every pre-existing
   finding categorized false-positive / accepted-risk / fix-now with a reason.
   The 2 criticals enter as false positives (test-fixture URLs, §2.3).
3. Gate: `aegis --format json scan . --baseline docs/security/AEGIS_BASELINE.json`
   fails on **new** findings only; wired into `.gitforce.yml` + parity script.
4. Fix-now items from triage (e.g. any real secrets-shaped code in
   `lib/basemaps.ts:123`, `bookmarks.ts:16`) get fixed, not baselined, if they
   touch credentials in code (they must not — env-only, per harness rules).

### Phase F — GitForge CI validation (task #91)

1. Fresh `/auth/login` JWT via the user's interactive credential path; verify
   push-trigger → run execution; if the event-drain stall persists, record the
   exact pipeline/run IDs and the stall evidence in this doc's progress log —
   honest status, no invented green.
2. Confirm `.gitforce.yml` executes the full parity chain (A/B gates) when runs
   do materialize; a local dry-run of the same steps is the fallback proof and
   is labeled as such.

### Phase G — Docs, E2E, release, deploy (task #92)

1. **Docs overhaul with canonical/historical split** (adopted from sibling
   repos): `docs/` keeps a canonical set (ARCHITECTURE, DATASET_MANIFEST,
   CONTRIBUTING, ROADMAP, security/); everything audit-shaped moves to
   `docs/archive/` with a header noting it is historical. `docs/CLAUDE.md`
   becomes a pointer table with a precedence rule: root CLAUDE.md > docs/
   canonical > archive (never authoritative).
2. **Documentation coverage check**: script asserts (a) every
   `openzenith/*.py` public symbol has a docstring (ruff `D` covers this after
   A3), (b) every `api/src/app/api/**/route.ts` appears in the generated
   OpenAPI spec, (c) README/CLAUDE.md counts (routes, tests) match reality —
   the same class of stale-claim bug found in the 09-21 audit, now fenced.
3. **E2E**: full chromium+firefox suite green locally; heavy suite
   `E2E_RUN_HEAVY=1` green; then E2E against production post-deploy.
4. **Release + deploy** if everything above is green: version bump,
   `.github/CHANGELOG.md` entry, tag, GitHub release, `pages:build` → artifact
   verify → `pages:deploy` → production smoke. Commit/push both remotes,
   gitforge first, at the start and end of the program.

---

## 4. Ratchet & governance rules (standing)

1. **Thresholds live in one place** and only move up (`vitest.config.ts`,
   `pyproject.toml`, `Cargo.toml`). No parallel numbers in CI scripts.
2. **No gate is muted**: never `|| true`, `continue-on-error`, or
   skip-if-baseline-exists semantics for new findings.
3. **Every exclusion is annotated** (`node:coverage-ignore`, baseline entries,
   per-file-ignores) with a reason — visible, counted, reviewable.
4. **No placeholders**: no TODO/FIXME/stub/simulated data anywhere, including
   tests (fixtures are real data shapes, synthetic values are labeled as
   synthetic in the test, not in production paths).
5. **Secrets never enter the repo**: config via env only; the 09-21 audit's
   `env-credential-assignment` class is verified as env *reads*, never writes
   of literal credentials.
6. **Both remotes, gitforge first**, on every push.

## 5. Out of scope / known limits

- GitForge event-drain stall is a GitForge-repo defect; OpenZenith can only
  record evidence, not fix the orchestrator here.
- 99/99 branch coverage on browser-only Cesium/MapLibre glue is not honestly
  reachable under node vitest; those lines are annotated and listed, not
  silently excluded (see §1 interpretation).
- HF z10 backfill (task #28) is running concurrently; its completion is
  tracked in `IMPROVEMENT_PLAN_2026-09-21.md`, not here.

## 6. Progress log

### 2026-09-22 — Phase F validation executed (task #91)

Fresh `/auth/login` JWT minted (305 chars). Evidence:

- `GET /api/pipelines` → 583 pipeline objects total, **8 for OpenZenith**;
  **583/583 have `status: None`** — push triggers materialize pipeline rows but
  none ever transitions to running/completed. Latest OpenZenith pipeline:
  `3b145fc7-79b8-4e81-9f78-2df29e85fcdf` (2026-09-22T18:50Z, trigger `push`).
- `POST /api/pipelines/<id>/run` → **404** (endpoint absent on this build);
  `GET /api/pipelines/<id>/runs` and `/jobs` → **404**.
- CI orchestrator `:42781/api/status` → `scheduler_auth_required` (separate
  scheduler credential, not the gateway JWT).

**Status: the event-drain stall persists.** Pipeline *creation* works;
*execution* does not. Local CI-parity runs remain the validation of record.
This is a GitForge-repo defect, surfaced here and in the GitForge project —
OpenZenith cannot fix it from this side.

- 2026-09-22: Plan written from measured baseline (§2). Phase A starting.

### 2026-09-22 — Phases A–D execution evidence

**Phase A (strict linting).** All six lint agents completed (three died on
provider 429 mid-run, finished sequentially from ground-truth eslint output).
Final state: `eslint src` severity-2 = **0** (5,800 warnings, all configured
warn-level `no-unsafe-*`/`restrict-template-expressions`); `tsc --noEmit`
= **0** errors. Rust gate green (clippy all-features + default `-D warnings`,
fmt, 13 tests, release build) — WASM raw-pointer ABI documented via
`pub unsafe fn` + `# Safety` contracts instead of lint suppression; ruff = 0.

**Real defect fixed en route** (`api/src/lib/point-elevation.ts`): the
AWS-terrarium `DecompressionStream` path awaited `writer.write()` before the
first `reader.read()`, deadlocking on backpressure for any compressed tile
larger than the writable high-water mark. Verified with a standalone Node
repro; affected tests dropped from ~100s to ~9s.

**Latent studio bug fixed** (`api/src/app/studio/page.tsx`): clearing an
elevation profile returned before removing `profile-line`/
`profile-marker-*` from the map — the layers lingered after every clear.
Both clear paths now run the same removal loop.

**Phase B (coverage).** Python: measured 81.95% → gate `--cov-fail-under=81`
in `pyproject.toml` (strict `>=`, so the floor is the rounded-down truth);
after the terrain/hydrology split the suite measures **82.08%**. Vitest:
measured 92.3 stmts / 83.15 branches / 81.28 functions → thresholds raised
70/50/70/70 → **92/83/81/92**. Known weak spots for the next ratchet:
`lib/storage/r2-binding.ts` 60%, `lib/layers/types.ts` 0%,
`fuse.py` 44%, `converter.py` 48%.

**Phase C (WCAG AAA).** axe-core audit live in `api/e2e/a11y.spec.ts`
(wcag2a/2aa/2aaa/best-practice, vendor-scoped MapLibre/Cesium exclusions).
Fixes: AAA secondary-text tokens in `globals.css` (dark `#a3a3a3` 7.79:1,
light `#525252` 7.49:1); Navbar/Footer/mobile-menu `visibility` fix;
about-page theme-aware stylesheet + `<main>` + heading order; globe
`<main>` landmark + sr-only `<h1>`; explore `<main>`; studio
ToolPanel/page text `#666`/`#999` → AAA tokens; MapLibre attribution links
underlined (1.4.1). Local-build audit pending this session.

**Phase D (smells).** `openzenith/terrain.py` (3,486 lines) → `terrain/`
package (9 submodules, largest 647) and `openzenith/hydrology.py` (2,491)
→ `hydrology/` (10 submodules, largest 551). Public surface 100%
preserved (77 + 42 re-exported names); `openzenith/__init__.py` untouched;
718 tests pass; ruff clean. Largest app-side file `globe/page.tsx` reduced
~40 lines of lint-workaround noise; `__scratch_union2.ts` removed.

### 2026-09-22 — Aegis re-triage + true-positive fix (Phase E)

The post-refactor aegis gate surfaced 1,855 findings not in the baseline
(api/src 1,227, openzenith/ 625, scripts/ 3) — overwhelmingly line-shift
artifacts of the dispositioned classes. Every high/critical class was
spot-checked at its new location (method recorded in
`docs/security/TRIAGE.md` §Re-triage 2026-09-22). Outcome:

- **One true positive, FIXED:** the globe hover-tooltip builder
  (`globe/page.tsx` → `HudOverlays.tsx` `dangerouslySetInnerHTML`)
  interpolated third-party feed content (USGS place names, OpenSky
  callsigns, AIS vessel names, EONET event titles) as raw HTML. Fixed with
  a local `escapeHtml()` applied to every feed-derived interpolation.
  Confirmed the only data-fed `innerHTML` sink in `api/src`.
- Baseline regenerated deliberately at final code state: 7,488 findings
  (1 critical / 664 high / 1,048 medium / 5,770 low / 5 info);
  `scripts/aegis_scan.sh` gate now passes with zero new findings.
- 3 permanent self-hits accepted and dispositioned: the gate script's own
  inline Python heredoc trips print-statement/terraform-count.

### 2026-09-22 — v0.8.3 release + deploy evidence (final)

**Validation.** Full E2E suite (chromium + firefox, `--workers=2`): 80
passed / 0 failed / exit 0 against the local wrangler production
artifact. Production-verify + OZT2-validate specs vs live prod: 43
passed, exit 0. vitest 977 passed | 5 skipped (92 files) against raised
thresholds; pytest 718 passed, 82.08% vs floor 81; ruff clean; Rust
gate green (fmt/clippy/30 tests); aegis gate green (0 new findings).
Parallel two-browser runs at default workers produced chromium
`Target crashed` renderer OOM (box swap at 100%, an unrelated
long-running session compounding); sequential-worker validation is the
reliable evidence on this host.

**E2E-found true positive (fixed):** Firefox axe flags the hero loading
badge — `#22c55e` on `rgba(0,0,0,0.7)` composites against the light
hero overlay mid-load, dropping below AAA; chromium passed only because
the badge had usually detached by audit time. Badge made opaque
(`#0a0a0a`, ~8.7:1) in `HeroMap.tsx` + `globals.css`.

**Release/deploy.** 10 commits pushed to GitForge (first) and GitHub;
tag `v0.8.3` both remotes; GitHub release published. Cloudflare Pages
deployed from the validated artifact
(https://616e2d09.openzenith.pages.dev); prod health reports
`"version":"0.8.3"`, landing 200, elevation API serving.

**HF z10 sync v3 (open, recorded honestly).** Hash-delta uploader
listed 151,988 local tiles: 62,813 hash-current, 89,175 to upload in
60 commits of ≤1,500. 26 commits landed ("0 files uploaded" =
server-side hash dedup), then batches 27–28 entered persistent
server-side read-timeout backoff (215 timeouts over ~7 h; 20→300 s).
Process left running; no client-side fix — the bottleneck is HF's
commit API. Next session: resume when HF recovers or split batches to
≤500 files; expected remaining ≈ 34 commits.

### 2026-09-22 — GitForge CI status re-verified (still platform-blocked)

Verified against the live GitForge instance with a fresh JWT: the
OpenZenith repo is registered (id 814a4cde…), `.gitforce.yml` exists in
the repo mirroring `ci.yml`, but (a) `gitforge pipeline --list` shows no
pipeline registered for the repo, and (b) `gitforge pipeline --create`
returns "Pipeline creation not yet implemented". Together with the
previously surfaced event-drain defect (push trigger fires, run
execution stalls), GitForge CI for this repo is blocked by two
platform-side gaps: pipeline registration and run execution. The
executable CI-parity remains the local gate set (eslint 0 errors,
tsc, vitest+coverage floors, pytest+coverage floor, cargo fmt/clippy/
test, aegis gate, E2E). Re-test when GitForge ships both capabilities;
tokens only via the user's interactive `gitforge auth --login`.

### 2026-09-22 — Rust coverage baseline measured (cargo-llvm-cov)

`cargo llvm-cov --all` in `core/`: **78.81% lines / 81.62% regions**
(708 lines, 150 missed). Per file: `viewshed.rs` 99.12%,
`ozt2.rs` 94.50%, `main.rs` 73.13% (function coverage only 35% — the
CLI arg-parse/error paths), `d8.rs` 68.66% (89 missed lines — the
depression-filling/edge branches). No gate added yet per policy: first
ratchet target is main.rs CLI error paths + d8.rs branches, then add a
cargo-llvm-cov floor near the measured baseline.

### 2026-09-22 — OpenAPI spec single-sourced from the route tree (#100)

Ground truth that motivated this: the hand-built spec documented **43 of 80
live routes** — 37 endpoints (the raster tile layers, terrain-analysis
routes, STAC collections items, tiles/{tileMatrixSetId}, coverage,
gps-jamming, space-weather…) were invisible to the published API docs, with
no mechanism to catch the next gap.

New architecture:

- `api/src/lib/openapi/base.json` — hand-authored document (rich
  descriptions/examples/schemas for the 43 originally documented routes),
  extracted verbatim from the old 1,216-line route literal.
- `api/scripts/gen-openapi.mjs` (`npm run openapi:generate` / `:check`) —
  scans `src/app/api/**/route.ts` for exported handlers, derives path
  templates (`[z]`→`{z}`, `[...path]`→`{path}`), stamps `info.version` from
  package.json, and writes `src/app/api/openapi.json/spec.json`. Routes
  missing from base.json get generated skeletons (summary + path params +
  responses, tag mapped by segment); a base path with no implementing route
  is a hard error. Deterministic output (sorted keys).
- `api/src/app/api/openapi.json/route.ts` is now a 25-line thin server of
  `spec.json` with request-origin substitution.
- `openapi-generation.test.ts` runs the generator's `--check` inside the
  vitest suite: adding a route or bumping the version without regenerating
  fails CI, closing both drift modes (#93 fixed version drift; this fixes
  route drift).
- Result: **80/80 paths documented** (43 hand-written + 37 generated).

Aegis re-triaged for the new files (10 findings: 4 fixed at source — async
fs in the test, comment reword; 6 baselined after review — see
`docs/security/TRIAGE.md`). Baseline shrank 1,456 → 1,427 despite the new
files because the spec literal left `api/src`. Validation: full vitest suite
93 files / 980 tests green, `tsc --noEmit` clean, changed files ESLint-clean
(`scripts/**/*.mjs` override added for untyped build JS with rationale).

### 2026-09-22 — Python coverage floor ratcheted 81 → 83 (#96)

Two ratchet steps in one day, each backed by tests covering the delta:

- **81 → 82**: terrain package split re-measured at 82.08%.
- **82 → 83**: dedicated suites for the two weakest modules —
  `test_raster.py` (18 tests: normalized_difference, integer division
  incl. negative operands, modulo, image correlation/autocorrelation,
  dem_where/clip/mask/reclassify — one behavior pinned: `dem_reclassify`
  leaves NaN, not nodata, for excluded cells) and `test_vector.py`
  (+13 tests: multipart polygon/polyline/multipoint mapping, GDB layer
  selection via a module-shaped fake-fiona, schema type inference,
  None-property cleaning, empty/unknown-geometry errors) lifted raster
  36→100% and vector 55→93%.

Verified: `pytest` gate **746 passed, 8 skipped, 83.23%** (11,129 stmts,
1,866 miss) at `--cov-fail-under=83`. Weakest modules now:
terrain/viewshed 57%, terrain/indices 66%, viz 67%, terrain/gradients
72%. Next ratchet: **85** with tests for those four.

### 2026-09-22 — TS coverage floors hold with margin; r2-binding 60 → 100% (#97)

- `src/lib/__tests__/r2-binding.test.ts` (new, 7 tests) exercises both
  DEM_TILES resolution paths via a controllable `@cloudflare/next-on-pages`
  fake (the global alias stub can only throw): injected provider,
  provider-clear restore, structural env resolution, unbound/undefined/
  throwing context, throwing provider.
- Route tests for the last uncovered config branches: `sentinel2-zxy`
  (TiTiler success, GIBS fallback, all-upstreams-down notice),
  `vessels` (configured + unconfigured), `reverse-geocode` (+6: missing/
  invalid params 400, upstream 5xx soft error, fetch-throw catch,
  display_name name-fallback).
- Coverage re-measured **92.22 / 84.01 / 81.84 / 92.22** (95 files,
  1,000 tests) — branches cleared 84, so that floor ratcheted 83 → 84.
  (The 92/83/81/92 floors had silently drifted below water at 91.47 —
  the new route tests brought them back above.)
- Vitest gotcha recorded: `vi.restoreAllMocks()` in Vitest 3 resets
  *module-level* `vi.fn()` mocks too (r2PutTile lost its
  `mockResolvedValue`, fetch stubs lost implementations) — route tests
  must rely on per-test `vi.stubGlobal` + `unstubAllGlobals` instead.

### 2026-09-22 — ESLint warning census closed out for this cycle (#98)

- Measured 5,789 warnings (209 files) → **5,183 (153 files)** after:
  `.wrangler/tmp` parse-error artifacts excluded, `restrict-template-expressions`
  tuned to `allowNumber` (≈600 eliminated — justified: `${z}/${x}/${y}`
  geospatial path building is number interpolation by design), and the
  `src/lib/storage/**` directory **graduated to error level** for the
  whole unsafe-family (100% typed, dedicated binding tests).
- `local-tif-backend.ts` typed properly (`node:zlib` awaited import
  instead of the untyped `zlib`; Uint8Array instead of untyped Buffer).
- Remaining concentration mapped: **67% of the unsafe-family lives in
  `src/app/globe`** — the extraction in #99 is the lint-reduction path;
  route-layer graduation is deferred to the typed-response-model phase.
- Aegis re-triaged for the new test files: 2 fixed at source, 9 (+1
  shifted) baselined with rationale — see `docs/security/TRIAGE.md`;
  gate green across all 5 scopes.

### 2026-09-22 — Python coverage floor ratcheted 83 → 85 (#96 complete)

Three dedicated suites took the three weakest terrain modules head-on:

- `test_flow_metrics.py` (20 tests) — **flow_metrics 54 → 99%**:
  sediment_transport_index (validity, nodata pass-through, exponent
  response), average_flow_truncation (gentle ramp 0, cliff > 0),
  depth_in_sink, clean_dem (pit fill, flat-resolution loop with
  `resolve_flats="steepest"/"weighted"`), and the Hack-integral edge
  regressions (no streams, <10 samples, degenerate least-squares
  denominator with identical accumulation values, real finite fit,
  nodata chi).
- `test_viewshed.py` (19 tests) — **viewshed 57 → 78%**: occlusion by a
  ridge, max-distance clipping, observer-on-nodata, visibility_index
  overlap, horizon_angle, directional_relief, fetch_analysis,
  max_elevation_from_direction. Per-function azimuth conventions differ
  and are now pinned as documented behavior (horizon_angle az 0 = west,
  directional_relief az 90 = north, fetch az 0 traces west and stops at
  the first `>=` cell, max_elevation az 0 = east). The remaining 22% is
  the numba JIT kernel — an optional accelerator unreachable without
  numba installed; recorded as the module's honest gap.
- `test_indices.py` (22 tests) — **terrain/indices 66 → 97%**:
  relative_elevation, elevation_relief_ratio, slope_leq,
  greater_than_height, pct_above/below_thresh guards,
  edge_contamination_check, curvature/mstp classification. Two flat-DEM
  behaviors pinned: relative_elevation stays all-NaN when range is 0;
  slope_leq's border cells are 0 because Horn slope is NaN there.

Verified: gate **807 passed, 85.39%** (11,469 stmts, 1,676 miss) at
`--cov-fail-under=85`; ruff clean; aegis gate green with no new findings.
Weakest remaining modules: terrain/profiles 70%, terrain/gradients 72%,
viz 67% (matplotlib-heavy), terrain/filters 84% — next ratchet: 87.

### 2026-09-22 — globe/page.tsx extraction, slice 1: tooltip + orbit (#99, in progress)

First two pure functions pulled out of the 4,000-line client component
into testable modules under `src/app/globe/lib/`:

- `lib/tooltip.ts` — `escapeHtml` (moved verbatim) and
  `buildEntityTooltip`, the nine-branch picked-entity tooltip builder
  (eq-/flight-/mil-/vessel-/sat-/orbitalTrack/storm-/event-/name
  fallback). The third-party-feed values it interpolates are rendered
  via `dangerouslySetInnerHTML`, so the module docblock pins the
  escape-everything invariant. 13 tests, including an XSS case asserting
  a hostile place string cannot inject markup.
- `lib/orbit.ts` — `classifyOrbit` (LEO < 2000 km ≤ MEO ≤ 30000 < GEO)
  and `orbitalVelocityKms` (GEO pinned at 3.07 km/s, else the app's
  circular-velocity approximation 7.66/√(1+h/6371)). 6 tests pin the
  regime boundaries and the extracted constant's actual outputs.

Typing notes recorded for the remaining slices: the page previously
flowed `any` through these paths (file-level `no-explicit-any`
disable), so the extracted modules type Cesium property bags as
`getValue?: () => unknown` — numeric reads cast to `number | undefined`
at the arithmetic sites, preserving the original loose `!= null` checks.

Verified: 19/19 vitest green, project-wide `tsc --noEmit` clean, eslint
0 errors with **zero new warnings** across the four new files (all 413
remaining in the changed-file set are pre-existing page.tsx unsafe-family
load). Remaining slices: layer orchestration, entity/lifecycle wiring.

Slice 2 — `lib/iss.ts`: CelesTrak TLE payload validation
(`parseCelestrakTle`) and the satellite.js propagation wiring
(`issEcfPosition`, satellite.js accepted as a structural
`SatelliteJsLike` interface instead of `(window as any)`). 8 tests pin
the response-shape rejection matrix and the call threading. Two
documented deltas from the original inline code, both strict
improvements: (1) the parser requires *both* TLE lines (the original
passed a possibly-undefined line 2 into satellite.js and relied on its
throw hitting the surrounding catch); (2) propagate and GMST share one
epoch instead of two `new Date()` calls a millisecond apart. Page
unsafe-family warnings: 413 → 389.

Slice 3 — the structural one: `CesiumInitResult` is now typed against
the `CesiumType` ambient namespace (`viewer: CesiumType.Viewer`,
`Cesium: typeof CesiumType`), so the page's init-effect no longer
floats `any` from the CDN boundary. The d.ts gained the members the
page actually exercises (Camera.positionWC/pitch/roll/zoomIn/zoomOut,
Scene.morphTo2D/3D/ColumbusView, PositionProperty, SampledPosition
Property.getValue), handler params are `CesiumType.ScreenSpaceEvent`,
and the dead `let viewer = null` became a non-null `const`. Typing
surfaced real dead code the linter now rejects at error level: 10
unary-`+` number conversions (two `.toFixed` sites kept — their `+`
string-coerces), 3 dead optional chains on non-nullable members
(`Property.getValue`, `Entity.id`, `camera.positionCartographic`), and
2 dead null guards. Page unsafe-family warnings: 389 → 202 (−48%
across the three slices; 5,789 repo-wide at #98 start → now well under
5,000). `loadCesiumWithFallback` returning undefined for a
loaded-but-not-global script now fails with an explicit error instead
of a TypeError. Verified: 98 files / 1,027 passed vitest, production
`next build` green, eslint 0 errors.

### #106 — Python coverage ratchet 85 → 87 (task 106, 2026-09-22)

Four weakest modules gained dedicated suites; total measured **87.57%
(11,772 stmts, 1,463 miss), 866 passed / 0 failed / 2 skipped**, floor
`--cov-fail-under` 85 → 87 with the evidence trail in pyproject.toml.

- terrain/profiles 70→95%: `test_profiles.py` (18 tests) pins the
  hillslope walk's actual downstream trace, path-distance accumulation,
  and both flow_length directions (incl. nodata skip and the
  pit-start zero). Lines 97/102/147/156/197 are defensive D8 guards,
  probe-verified unreachable: `d8_flow_direction` never cycles and
  never points off-grid across 500+ random DEMs.
- terrain/gradients 72→100%: `test_gradients.py` (11 tests) covers the
  five untested derivatives via self-consistency formulas and nodata
  fills.
- terrain/filters 84→99%: `test_filters.py` (13 tests). **Two real bugs
  found by probing, fixed:** (1) `feature_preserving_smooth`'s pad was
  one cell short — every full-width window raised IndexError, and the
  pre-existing tests in test_terrain.py had been *catching the crash*
  (`except IndexError: pass  # Known edge case bug`); they now pin the
  fixed behavior (broad ridge preserved, isolated spike smoothed by
  design, nodata pass-through). (2) `sieve`'s replacement scan used
  4-neighbours against 4-connected labels — the branch was dead; now
  scans all 8. Also: `adaptive_filter` no longer NaN-poisons constant
  terrain (k falls back to 0 on the 0/0 Lee weight).
- viz 67→100%: installing trimesh activated six `importorskip`-gated
  GLB tests and exposed that `terrain_to_glb` **had never once run
  successfully** — four latent runtime bugs fixed: RGB palette
  reshaped as 4-channel RGBA, `np.concatenate(..., dtype=uint32)` same-kind
  cast failure, vertex indices built for a shared-grid layout
  while vertices are stored per-quad consecutively, and
  `Trimesh.to_glb()` (trimesh 5.x wants `export(file_type="glb")`).
  GLB output now round-trips through trimesh with palette vertex
  colors, decimation, and transform+scale verified.

Misses that remain are documented (scipy/trimesh ImportError guards,
defensive D8 guards). Aegis: +3 semantic findings, all triaged false
positives (nested NumPy math ≠ callbacks; the word "functions" in
docstrings ≠ Azure) — TRIAGE.md 2026-09-22c, baseline 1,445 → 1,449.

### #94 — HF z10 OZT2 backfill: COMPLETE (task 94, 2026-09-22)

Ground truth established through three independent channels after sync v4
(48,481 committed) + v5 (verification pass):

1. **Commit history** (authoritative): v4's "7,500 failed" were false —
   timeouts hit *after* HF accepted the commits; batches 110/111 appear 3×
   each in the dataset's 5,075-commit history (harmless duplicates).
2. **Server-side dedup**: v5 recomputed the same 55,981 delta from the tree
   listing, then every one of its 112 create_commits returned "no files
   modified" — HF confirmed identical blobs already exist at every path.
3. **Resolve URLs**: 25/25 sampled "missing" paths return HTTP 200/302, 0×404.

**All 151,988 local z10 tiles are on the remote with identical content.**
The residual "missing: 55,981" reported by the validator and both sync runs
is a *stale tree-listing index*: after mass upload, `list_repo_tree` serves
a ~96K-file snapshot while git/LFS state is current. Operational rule:
never treat tree-listing absence as truth within hours of a mass upload —
verify via resolve URL or commit-dedup. This rule feeds #108's
verify-before-retry design.

Tooling notes: the earlier ad-hoc ground-truth scan matched `10/`-prefixed
paths against the repo's `tiles/z10/…` layout and counted nothing on either
side — vacuous, discarded. v5 summary "55,981 files uploaded, 0 failed"
is likewise misleading (nothing uploaded; all deduped) — #108 covers
honest reporting.

### #108 — HF uploader: verify-before-retry + honest counts (task 108, 2026-09-23)

`scripts/upload_ozt2_to_hf.py` hardened against the two failure modes #94
exposed:

1. **Timeout-after-success duplicates**: a create_commit whose *response*
   timed out was retried blind, so HF landed the commit and the retry landed
   it again (batches 110/111 ×3). Now any timeout-class failure probes one
   file via `probe_landed()` (resolve-URL HEAD; 200/302 → present, 404 →
   absent, else None). create_commit is atomic, so one file is conclusive
   for the batch. Present → counted uploaded, no retry; absent/None →
   backoff retry as before.
2. **Dedup invisibility → false "uploaded"**: HF skips all-duplicate commits
   with only a logged warning ("no files have been modified"), returning
   normally. A thread-local `logging.Filter` on the huggingface_hub loggers
   detects it (and the older raise-based behavior) so the batch is reported
   `already_present`.

`upload_batches` now returns `{"uploaded": n, "already_present": n,
"failed": n}` and `upload_tiles` accumulates honest grand totals with a
stale-index note when the dedup share is large. Exit code is nonzero only
on real failures.

Evidence: 9-case synthetic harness (`/tmp/test-uploader-108.py`) — fresh
upload, dedup-via-log, dedup-via-exception, timeout+landed (probe 200, no
retry), timeout+absent (retry succeeds), timeout+probe-flaky, timeout
forever → failed, parallel mixed outcomes, live probe sanity
(present=True/absent=False) — **9/9 pass**. Ruff: no new findings (9
pre-existing in scripts/, outside the strict lint gate). Live dry-run smoke
over the real repo: hashed 151,988 local tiles + single remote metadata
call → delta 55,981 / 96,007 current, exit 0, zero commits — consistent
with the stale-index state documented under #94.

### #107 — Python coverage ratchet 87 → 90 (task 107, 2026-09-23)

Four weakest I/O modules gained dedicated suites; total measured **92.84%
(12,728 stmts, 911 miss), 991 passed / 0 failed / 14 deselected**, floor
`--cov-fail-under` 87 → 90 with the evidence trail in pyproject.toml.

- fuse 44→99%: `test_fuse.py` grown to 84 tests — FusedDEM srtm/gebco
  blending with fake `.merged` indexes, nodata and merge-error
  propagation, GEBCO quad via a real rasterio tiff plus the PIL `I;16`
  fallback (`rasterio` blocked via sys.modules), sync `query` and async
  `query_to_thread` (instance-patched readers work through to_thread),
  `load_fused_tile` tile math pinned (lon span 360/1024, resolution from
  lat span), session lifecycle + ETag/206 range paths with a scripted
  aiohttp stand-in. Remaining miss (111-112) probe-verified unreachable.
- async_client 55→100%: `test_async_client.py` scripted-transport tests —
  ETag If-None-Match → 304 serves cache, retry-then-succeed on
  500/429/ClientError, timeout exhaustion message, aiohttp ImportError
  guard via sys.modules, session ownership (external session untouched by
  close), batch id mapping incl. unmatched-drop, missing→error, and the
  2500-point → [2000, 500] chunk split; BatchProcessor chunking/progress/
  generator/dict-points paths.
- converter 48→100%: `test_converter.py` rewritten with a module-level
  synthetic-GeoTIFF helper (the old TestConvertDirectory called a helper
  that did not exist on its class — AttributeError swallowed into a
  rasterio skip, so the class never ran; importorskip now gates honestly).
  **One real bug found and fixed:** `convert_directory`'s manifest put
  PosixPath objects where json.dump needs strings — the manifest write
  could never have succeeded; now `str()`-coerced and asserted via a real
  manifest.json parse. Quantized-RMSE and lossless-mismatch (corrupt
  decode probe) reporting pinned.
- elevation 58→97%: `test_elevation.py` — undecodable-tile debug ops,
  batch worker error isolation, the five OZT2 paths (internal,
  default-zoom-ladder, all-nodata, corrupt, DEFAULT_OZT2_DIR), full-tile
  grid assembly (fixtures derive the exact tile range from the same
  pixel-span math as `load_elevation_grid`), corrupt-SE-tile NaN
  isolation. **Two latent bugs found and fixed:** sync
  `get_elevation_along_path` called the batch API with a `cache_dir`
  kwarg (TypeError) then `.get("elevation")` on a float (AttributeError)
  — it could never have returned; the async variant constructed
  `ElevationBatchProcessor(zoom_levels=…, tile_dir=…)` and called a
  nonexistent `process_batch` — now both route through `get_elevation_batch`
  with the blocking I/O offloaded via `asyncio.to_thread`. Also removed a
  dead `180.0 / (n * 256)` expression.
- backends/ozt2 59→96%: `test_backends.py` — faked boto3 client
  (get/head incl. botocore ClientError, client reuse), faked aiohttp
  download/cache-write/prefetch with per-URL routing so concurrent
  gathers stay deterministic, faked urllib bytes+HEAD (200/URLError),
  boto3/aiohttp ImportError guards, prefetch no-cache-dir → 0 and the
  sync wrapper.

Aegis: 14 gate findings → semantic +6 −8 ghosts; all six are test-fixture
false positives (converter's `verify=False` is roundtrip data
verification, not TLS; the ssrf hit is a scripted fake transport; the
"credentials" are literal `key`/`secret` placeholders into a mocked R2
constructor) — TRIAGE.md 2026-09-23 #107, baseline 1,450 → 1,456. Ruff
strict gate: clean; ruff format applied to all touched files.

### #109 — Python coverage ratchet 90 → 93 (task 109, 2026-09-23)

Lazy-export surface and CLI pipelines; total measured **96.83% (13,103
stmts, 415 miss), 1,327 passed / 0 failed / 14 deselected**, floor
`--cov-fail-under` 90 → 93 with the evidence trail in pyproject.toml.

- __init__ 36→100%: `test_lazy_exports.py` (new) parametrizes over all 142
  lazy `__getattr__` names — each resolves to a callable, each is pinned in
  `__all__`, unknown attrs raise, repeat access is cached. **Real API-drift
  bug fixed:** 65 lazy exports were missing from `__all__` (a third of the
  lazy surface — filters, indices, watershed, ls_factor…), so `import *`
  and doc generation silently omitted them; `__all__` completed to 180.
- cli 81→99%: `test_cli.py` extended with a synthetic OZCHNK01 writer that
  drives `_load_merged` end-to-end (chunk placement, ocean-chunk nodata,
  the 3840-canvas → 3601² crop), `_filename_to_bbox` (SRTM + Copernicus
  naming incl. the `_00` segments), `_load_rawint16` square detection,
  cmd_encode/cmd_ingest over real tmp bundles with manifest assertions,
  main() dispatch and bare-help, per-command dependency guards
  (sys.modules poisoning), and the PIL-less np.save fallbacks.
  **Three latent bugs fixed:** (1) `cmd_drainage_density` imported
  `drainage_density` from `openzenith.hydrology`, where it does not exist
  (it lives in terrain/flow_metrics) — the command raised ImportError on
  every invocation; (2) `_load_merged` allocated a 3601² canvas under
  256-aligned chunks, so row 14 wrote `tile[3584:3840]` → broadcast
  ValueError — plus two dead `min()` statements; now assembles on the
  3840 canvas (ocean chunks skipped to nodata via the index size-0 check
  that `get_chunk`'s zlib path needs) and crops; (3) the encode/ingest
  per-file handlers caught only `OSError`, so one corrupt `.merged`
  (ValueError "Invalid magic") crashed the entire batch instead of being
  recorded — now `(OSError, ValueError, TileError)`. Also fixed
  `_filename_to_bbox`'s Copernicus regex, which rejected the real
  `…N22_00_E016_00_DEM` layout its own docstring cites.
- hydrology/depressions 73→97%: `breach_least_cost_path` (carve-to-outlet,
  unreachable outlets, max-cost gate, nodata), `breach_depressions` nodata
  hole in the flood front, `breach_bridges` narrow-carve vs wide-keep.
  Remaining misses probe-dead: `ndimage.label` never yields a zero-cell
  label (263/304) and the nan/depth guards sit behind the valid-mask
  pre-filter (211/218); cli 1596 is the `if __name__` main() call.

Aegis: 7 gate findings → +1 −6 ghosts; the +1 is the info-level
file-size-outlier rotating to test_cli.py (2,076 lines, intentional
per-command class layout) — TRIAGE.md 2026-09-23 #109, baseline 1,456 →
1,456. Ruff strict gate + format: clean.

## #110 — Rust core coverage ratchet + llvm-cov floor (task 110, 2026-09-23)

Closed #104's deferred commitment ("first ratchet target is main.rs CLI
error paths + d8.rs branches, then add a cargo-llvm-cov floor near the
measured baseline"). Baseline was 78.81% lines / 81.62% regions
(708 lines, 150 missed; main.rs function coverage 35%, d8.rs 68.66% with
the two rayon `_par` variants entirely untested).

**Result: 78.81% → 97.96% lines** (736 lines, 15 missed), regions
96.94% → 98.03%, functions 77.78% (the 14 missed are serde-derive
internals attributed to main.rs). Per file: d8.rs 68.66 → **100%**,
ozt2.rs 94.50 → **100%**, viewshed.rs 99.12 → **100%**, main.rs
73.13 → **92.54%**. Floor: `scripts/core_coverage_gate.sh` (new) runs
`cargo llvm-cov --all --fail-under-lines 95` — measured 97.96 with ~3
points of headroom, mirroring the Python floor discipline (measured
96.83 / floor 93). Ratchet via `CORE_COV_FLOOR` env or editing the
script default; raise only with tests covering the delta.

- d8.rs (+8 unit tests): `d8_flow_direction_par` vs sequential equality
  on 9×9 mixed terrain with an interior nodata hole, flat/nodata pits,
  single-row degenerate shape; `flow_accumulation_par` ≡ sequential;
  stream-order edge cases (off-grid downstream target clip, no-merge
  stays order 1, and the confluence test's geometry corrected — its
  flow_dir put dir 4 on the confluence cell and −1 on the headwater,
  and its loose `>= 1` assertion had been masking the bug below).
- **Real bug fixed — `stream_order` never emitted order ≥ 2.** The Rust
  port transcribed Python's promotion gate as `my_order > tgt_order`,
  but every stream cell initializes to order 1, so `1 > 1` never fired
  and no cell could ever be promoted (promotion requires an already-
  promoted upstream). It also counted same-order inflows at the source
  instead of the target. Empirically confirmed via the CLI
  (confluence JSON returned all-1s), then fixed to mirror
  `hydrology/streams.py::stream_order`: gate `src >= tgt`, inflow count
  at the target, source counts as one inflow. CLI regression test pins
  the two-headwater confluence to `"data":[1,1,0,0,2,0,1,0,0]`.
- **Duplicate removed — `flow_accumulation_par` was byte-identical to
  `flow_accumulation`** ("parallel D8 + sequential Kahn's" comment
  notwithstanding: Kahn's pass is inherently sequential). Now a
  documented delegation; export surface unchanged (lib.rs re-exports
  both names).
- cli_integration_test.rs (+13 tests): per-command invalid-JSON and
  data-length error paths for accum/reconstruct/viewshed/
  gradient-predict, stream-order's two length checks (streams, flow_dir)
  and the omitted-`nodata_dir` serde default, non-UTF-8 stdin
  (`failed to read stdin`), plus the confluence regression above.
- ozt2.rs (+2): `left_reconstruct` mid-row nodata resets the cumsum
  baseline; `gradient_predict` nodata cells map to the nodata residual.
- viewshed.rs (+1): observer on a nodata cell short-circuits to
  all-hidden.
- Genuinely-unreachable remainder (15 lines): main.rs stdout-write
  failure (needs an unwritable stdout) and serde-derive error
  construction internals.

Tests: 26 lib + 25 integration, 0 failed. `cargo fmt`/`clippy -D
warnings`: clean. Aegis: gate FAILED on first run with 20 findings →
+18 accepted (test unwraps under the file's documented allow) −27
pruned after tool-version drift (aegis binary's detection rules changed
since the last baseline regeneration: `env-file-in-git` 29 → 2 on the
identical tree; 3× consecutive scans byte-identical, so the gate is
stable against the current scanner) — TRIAGE.md 2026-09-23 #110,
baseline 1,456 → 1,447.

## #111 — README/CLAUDE.md measured-metrics refresh (task 111, 2026-09-23)

All headline claims replaced with command-measured numbers (Phase 2's
"verify claims" item, re-run post-#107..#110):

- Tests row: 688 pytest / 17 cargo / 419+ vitest → **1,327 pytest @ 96.8%
  cov, 51 cargo test @ 98.0% lines, 1,032 vitest @ 92.2% stmts** (measured
  2026-09-22/23; vitest floors 92/84/81/92 in vitest.config.ts, Python
  floor 93, Rust floor 95 via scripts/core_coverage_gate.sh).
- Data Layers heading: "37 total, 33 on 2D map" → **54 mountable on the
  2D map (MAP_2D_LAYER_IDS = Object.keys(LAYER_HANDLERS)), 27 curated in
  lib/layers/registry.ts**; tables re-labelled "highlights below" (they
  enumerate 31 rows — a subset; a full content pass of the marketing
  tables is a separate editorial task, not claimed done here).
- Architecture: "80+ edge routes" → 80 (find api/src/app/api -name
  route.ts = 80; CLAUDE.md already said 80).
- SDK reference table: added the four undocumented user-facing modules —
  merged (MergedFile, read_elevation_from_merged), async_client
  (ElevationClient, ElevationBatchProcessor), tile_format_v2 (encode,
  decode), converter (convert_tile, convert_directory). CLI commands
  heading now states the measured 31-command surface (dispatch table is
  the source of truth; README examples were a valid subset).
- Verified-accurate, left alone: 2,000-point batch limit (enforced at
  elevation/batch/route.ts:84), provider marketing stats (10,800+
  aircraft etc.), 14,296 .merged files, ~152K HF tiles.
- CLAUDE.md overview: "37 real-time data layers" → the measured 54/27
  registry framing.

## #112 — TS route branch-coverage wave + vitest floor ratchet (task 112, 2026-09-23)

Route-test wave across the API surface (+83 tests net; 98 files, 1,115
tests, all green; tsc --noEmit clean; eslint 0 errors):

- Suites extended (vitest, following the __tests__/ route-suite idiom):
  hurricanes 6→11 (R2 HIT, fetch-rejection, Saffir ladder full-tracks,
  messy CSV rows, 7-day recency filter), flights 11, opensky 22 (fake
  timers for module-level token/credit state, 1400-request 429 loop),
  satellites 12, terrain-routes 42 (watershed/streams degradation +
  elevation gates), bathymetry 13, bgp 8, population 10, landcover 10,
  proxy 9, zoom-math 14→17 (pixelToLatLon).
- **Defect fixed (production): watershed/streams GeoJSON coordinates.**
  Boundary and stream cell coordinates were built from tile-index math —
  `((tileXMin * 256) / n) * 360 - 180` and full-tile-span lat/lon
  interpolation — scaling the grid's pixel span by 256× and emitting
  longitudes of ~25,000° (invalid GeoJSON in production). Replaced with
  pixel-exact web-mercator mapping via the new shared helper
  `pixelToLatLon(z, x, y)` in src/lib/srtm/zoom-math.ts (inverse of
  latLonToTile at pixel granularity, round-trip unit-tested against
  tileToLatLon edges to 1e-9). Regression tests now pin every boundary
  and stream coordinate to a ±0.1° window around the pour point.
- Defect fixed: proxy/[...path] abort-timer leak — clearTimeout now runs
  in finally on the fetch rejection path (timer count pinned at 0 under
  fake timers).
- Dead code removed: watershed `_fillDepressions` (identity stub) and
  `_flowAccumulation` (longest-chain relaxation, not flow accumulation;
  zero call sites). flights:104 dead ternary (both arms identical)
  collapsed; misleading comment fixed.
- Floors ratcheted in vitest.config.ts with evidence comment:
  **92/84/81/92 → 94/86/83/94** (measured 95.99 stmts / 88.05 branches /
  85.15 functions / 95.99 lines). Weakest remaining area is still api
  route branch coverage (trace 55.6%, weather/warnings 60%, profile,
  tile/[tileRow]/[tileCol] 78-82%) — candidate material for a follow-up
  wave.
- Conventions honoured: silent-200 error contract is documented repo
  behaviour (left as-is); parser-skips-first-two-lines fixtures (header +
  IBTrACS units row) recorded in test comments.
- Scratch note: coverage-measurement scratch dirs (api/.tmp-cov-*) are
  now gitignored after their removal was declined.

## #113 — TS route branch wave 2 + six production fixes (task 113, 2026-09-23)

Second route-coverage wave over the 12 remaining sub-85%-branch routes
(trace 55.6→97.1, twi 73.3→98.3, aspect →100, geoip 6.3→100, geocode
76.9→100, nlnog 40→100, military 59.1→100, proxy/wms 62.5→100, waterways
68.8→100, overpass/arcgis/elevation →100). +123 tests (98 files, 1,238,
all green; tsc clean; eslint 0 errors; Python suite green; ruff clean).

**Six production defects found by the new tests and fixed:**
1. aspect N↔S compass mirror (atan2 double-negation) — api/src/app/api/
   aspect/route.ts AND the same bug in openzenith/terrain/gradients.py
   aspect_slope (aspect() itself was correct; the two functions disagreed
   on dz_dy sign conventions). Compass regression tests added in both
   languages.
2. waterways could never return a feature: Overpass query lacked the
   `geom` modifier, so ways carried only node-id lists; parser also
   expected arrays instead of Overpass's {lat,lon} objects. Query is now
   pinned by a regression test.
3. arcgis proxy allowlist bypass: bare endsWith admitted
   evil-services9.arcgis.com. Now exact-or-dot-bounded; both 403 and
   legit-subdomain cases pinned.
4. geoip dropped legitimate 0 coordinates (equator/prime meridian) via
   `|| null` → `?? null`.
5. military forwarded negative dist upstream → falls back to default.
6. proxy/wms URL fragment swallowed appended WMS params → stripped.

Floors ratcheted: **94/86/83/94 → 95/90/86/95** (measured 97.61 stmts /
93.04 branches / 88.23 functions / 97.61 lines). Aegis re-triaged
1,485 → 1,553 (TRIAGE.md #113).

Remaining sub-90 branch areas (future waves, all others ≥95): tile/
[tileRow]/[tileCol] ~82, lib/gibs-tile ~79, trace/twi residuals are
documented-unreachable defensive branches.

## #114 — Wave 3: TS tile/gibs stragglers + SDK hydrology fix pass (task 114, 2026-09-23)

Two-agent wave closing the remaining sub-90% surfaces in both languages,
then an orchestrator verification pass that fixed every defect the new
tests surfaced.

**TS side** (agent): OGC tiles routes + gibs-tile brought to ~100%
branch coverage (+30 tests). Orchestrator decisions on top:
- **WorldCRS84Quad deprecated across the tile surface.** The set served
  EPSG:3857 bytes with only a row-flip under an EPSG:4326 label —
  non-conformant output under a conformant label is worse than no set.
  Removed from tiles/route.ts links, tileMatrixSetId route (400
  InvalidParameterValue), and WMTSCapabilities.xml. True EPSG:4326
  assembly (resampled pyramid) recorded as a follow-up candidate. (The
  `CRS84` strings in the collections routes are the OGC API - Collections
  mandatory spatial CRS — unrelated, untouched.)
- gibs-tile parsing hardened: `parseInt` accepted "3abc" as 3; now strict
  integer grammar (`/^-?[0-9]+$/`), so garbage → 400 while negative
  literals still reach the range check → 404.
- Also fixed in the agent's tests: self-contradictory gibs fixture (same
  input pinned to both 400 and 404) and a stale z1 scale-denominator
  literal from the old CRS84 path.

**Python side** (3 agents, 8 modules): viewshed 78→100, watersheds
80→94, streams 86→98, flowpaths 92→99, tracing 82→98, geo_utils 88→100,
geotiff 87→100, merged 88→100, tile_format_v2 84→99. Orchestrator
verification then fixed **17+ reported defects plus 3 found during
verification** across 7 modules — the whole inverted-D8 family (upstream
tracing in delineate/_trace_watershed/stream_basins/basin_id,
stream_order, link heads, reach junctions, link-class tributaries used
the opposite-of-d geometry or P=cell+offset), a cycle hang in the reach
upstream walk (exposed by the direction fix), an unbounded-pass hang in
stream_link_class (same-link self-count), flowpaths broadcast crashes +
reversed upslope propagation (all non-ridge cells NaN), tracing
oscillation false positive on straight descents, viewshed NumPy/kernel
nodata-observer divergence, OZT2 zlib-fallback tiles labelled brotli in
the flags byte (interop break vs brotli hosts) + encode now rejects
non-square arrays (decode guesses dimensions — 64x512 came back silently
as 128x256), GeoTIFF NaN-cast warnings + dtype-override wrap + unsigned
Pillow fallback mangling negatives.

**Gates:** Python 1,431 passed / 14 deselected, coverage **98.56%**
(14,028 stmts, 202 miss) — floor ratcheted **93 → 96**; ruff clean.
TS: 99 files, 1,256 passed + 5 skipped, coverage **97.89 / 93.3 /
88.26 / 97.89** — floors ratcheted **95/90/86/95 → 96/91/86/96**;
tsc clean; eslint 0 errors. Aegis re-triaged 1,553 → 1,564 (TRIAGE.md
#114; all 47 new findings verified FPs: scale-denominator literals as
PII, test CORS/localhost noise, "Limit"/"Replace"/"Write a" comment
grammar).

Remaining known gaps (all documented, none silent): tile_format_v2
`_quantize`/`_dequantize` zero-range branches are format-legal but
encoder-unreachable; watersheds snap_pour_point on an all-nodata grid
divides by ~0 (guard candidate); WorldCRS84Quad true EPSG:4326 assembly;
map/page.tsx monolith extraction (multi-session); GitForge event-drain
stall (external).

## #115 — Wave 4: last sub-95/sub-90 stragglers + six more defect fixes (task 115, 2026-09-23)

Four parallel agents lifted every remaining weak surface to 100%, then an
orchestrator verification pass fixed the defects the new tests exposed.

**Coverage:** Python — channels 93→100 (new test_channels.py), inundation
94→100 (new test_inundation.py), vector 93→100, profiles 95→100,
overlay 95→100. TS — earthquakes 75→100 branches, airquality 75→100,
weather/warnings 60→100, dem-tile 85.7→100, stac 92.9→100, docs-md /
gebco-tile / openapi.json / tiles routes →100 lines. The only Python
modules below 100% are now documented-defensive or mock-seam lines
(elevation 97, depressions 97, export 98, tracing 98, and test-file
self-coverage rows).

**Six production defects found by the new tests and fixed:**
1. channels cross_section_area/hydraulic_radius were identically 0.0 for
   every section: active elevations were clamped with max(bank, e), so
   bank - e <= 0 always zeroed the depth integral (clamp dropped; the
   per-cell max(0, …) already guards).
2. channels elevation_above_stream + depth_to_water measured the distance
   transform FROM the stream mask instead of TO it — every off-stream cell
   sat in the distance-0 band and read 0.0; both rewritten with
   distance_transform_edt(~streams, return_indices=True) so each cell
   references its actual nearest stream cell (+ empty-network guard).
3. inundation depression_depth_stats depth/volume sign-inverted:
   max(original) - min(filled) compares different cells and comes out
   negative (pit floor minus spill rim); now per-cell (filled - dem),
   volume = summed depths — and the "deepest first" sort finally sorts
   deepest first.
4. vector.py looked the Z-polyline alias up as "POLYLINZ" (typo), so
   POLYLINEZ shapefiles mislabelled themselves GeometryCollection with
   flattened coordinates; now MultiLineString with per-part nesting.
5. profiles flow_length(direction="upslope") walked the downstream fd
   chain under the upslope name — identical output to downslope.
   Rewritten as the true inverted-graph longest headwater path
   (iterative memo DP, cycle-safe via an on-path guard, verified by a
   fan-in test and a synthetic-cycle test; monotone-ramp mirror property
   pinned: upslope + downslope = total).
6. api weather/warnings: the R2 cache read sat outside the try block, so
   a rejecting cache layer escaped as an unhandled edge 500; moved inside
   (matches earthquakes) and pinned by a rejection test. Also corrected
   the docs-md text claiming gebco-tile "returns 501 in production" —
   the route actually answers 200 with an explanation JSON.

Also: watersheds.snap_pour_point no longer NaN-poisons its weights on an
all-nodata DEM (np.max over an empty valid mask) — pinned with a
warnings-as-errors test.

**Gates:** Python 1,475 passed / 14 deselected, coverage **98.81%**
(14,412 stmts, 171 miss) — floor 96 → 97; ruff clean. TS: 99 files,
1,310 passed + 5 skipped, coverage **98.58 / 93.77 / 90.78 / 98.58** —
floors 96/91/86/96 → 97/92/89/97; tsc clean; eslint 0 errors. Aegis
re-baselined 1,564 → 1,640 (TRIAGE.md #115; all 86 new findings verified
test-file noise or the deliberate try-block move).

Known follow-ups: profiles nodata predicate uses `<= nodata` while
hydrology/flow.py uses `!= nodata` (semantic divergence documented, both
defensible); dem-tile health probe whitelists only 302 among redirects;
overlay rasterize_lines(value=...) is dead (burn_value only).

### 2026-09-23 — Task #116: documented follow-up burn-down

All three follow-ups recorded in the #115 entry closed:

1. **overlay.rasterize_lines `value` param removed.** It was never read —
   every burn used `burn_value`, so callers passing `value=X` were silently
   ignored. No caller or test passed it (grepped repo-wide). `burn_value` is
   now the sole raster-value knob; test_overlay.py pins non-default burns
   (7.5 / -2.0) land exactly on line cells and nowhere else. Removing the
   dead twin converts a silent no-op into a loud TypeError for any future
   caller who expected it to work.
2. **dem-tile health probe accepts the full redirect class** (301/302/303/
   307/308, was 302 only). HF `/resolve/` has moved targets between
   permanent/temporary/preserve-method redirects; any of them proves
   reachability. 304 deliberately stays degraded (no Location, proves
   nothing). dem-tile.test.ts loops all five statuses + pins 304 → degraded.
3. **Nodata predicate divergence pinned as a contract, not "fixed".**
   profiles walks cut at `dem <= nodata`; flow.py D8 tests `!= nodata`. They
   agree exactly at the default sentinel and diverge only for values below
   it — there D8 keeps the cell as real terrain (a capturing pit) while the
   profile walk refuses to enter. test_profiles.py now pins the D8 side
   (`fd[0,1] == 2`, `fd[1,0] == 0`, `fd[0,0] == 1`, `fd[1,1] == -1` for a
   below-sentinel pit) with the rationale: harmonizing flow.py would
   silently change every downslope product and break Rust-core parity.

**Gates:** Python 1,477 passed / 14 deselected, coverage **98.82%**
(14,433 stmts, 171 miss) — floor 97 held; ruff clean. TS: 99 files,
1,311 passed + 5 skipped, coverage **98.58 / 93.76 / 90.78 / 98.58** —
floors 97/92/89/97 held; tsc clean; eslint 0 errors. Aegis re-baselined
1,640 → 1,646 (TRIAGE.md #116; 6 findings all verified line-shift
fingerprints of previously-triaged code plus one 0%-vs-0% scanner artifact).

The documented follow-up backlog is now empty. Remaining known items are
the two standing out-of-scope entries (map/page.tsx monolith extraction —
multi-session; GitForge event-drain stall — external) and the WorldCRS84Quad
true-EPSG:4326 assembly (resampled pyramid feature work).

### 2026-09-23 — Task #117: source builds were broken (packaging defect)

**Defect:** `pyproject.toml` declared `dynamic = ["version"]` with no
`[tool.hatch.version]` section. Hatchling raised `ValueError: Missing
tool.hatch.version configuration` during metadata generation, so EVERY
source build failed: `pip install .`, `pip install -e .`, sdist installs.
Verified empirically with pip 26.0.1 before the fix (metadata-generation-
failed, full traceback through hatchling/metadata/core.py).

**Fix:** `[tool.hatch.version] path = "openzenith/__init__.py"` — the
dynamic version now reads `__version__ = "0.8.3"` from the package root
(the same literal the API package.json already mirrors).

**Verification:** `pip wheel .` builds `openzenith-0.8.3-py3-none-any.whl`
(275,784 bytes); extracted METADATA shows Version: 0.8.3 with intact
project URLs; entry_points.txt declares `openzenith = openzenith.cli:main`;
all subpackages (backends, terrain, hydrology, tests) present in the wheel.
sdist metadata generation also completes. PyPI installs were unaffected
(those wheels predate the breakage); dev/source installs were broken.

### 2026-09-23 — Task #118: undeclared SDK dependencies (clean-env audit)

The #117 clean-venv wheel-install probe kept paying out: the freshly
installed CLI was STILL broken. Full third-party import audit of the
package, then an every-module import probe in a venv holding only the
declared core deps:

**Undeclared module-scope imports found and fixed:**
- `typing_extensions` (async_client.py:46) — broke `import openzenith`
  itself. Declared `>=4.0` (kept rather than `typing.Self` because
  requires-python is 3.10; stdlib Self is 3.11+).
- `cachetools` (merged.py:42 LRU file cache) — declared `>=5.0`.
- `scipy` (export.py:9 module scope; 7 more hydrology/terrain modules use
  it function-lazily) — declared `>=1.10` core: `fill_depressions` is core
  hydrology, not an optional accelerator.
- `matplotlib` (viz.py:25 module scope, used ONLY in lazy annotations) —
  moved under `TYPE_CHECKING`; the plotting helpers' existing friendly
  ImportError guards are now actually reachable. Declared as a new `viz`
  extra (`>=3.5`), included in `all`.
- `zstandard` (tile_format.py:46 module scope) — made the documented
  minimal install unimportable (`import openzenith` pulls tile_format).
  Mirrored tile_format_v2's guarded idiom: try/except → HAS_ZSTD flag,
  `_compress_zstd`/`_decompress_zstd` raise the friendly
  `pip install openzenith[compression]` error. Pinned by
  TestMissingZstandard (monkeypatched HAS_ZSTD).

**Doc drift fixed en route:** async_client docstring + runtime guard
referenced a nonexistent `[async]` extra → `[analysis]` (where aiohttp
actually lives).

**Verification:** wheel rebuilt; venv install with core deps only →
all-module import probe reports **0 failures**; `openzenith info` and
`__version__`/lazy-export surface work.

**Gates:** Python 1,479 passed / 14 deselected, coverage **98.82%**
(14,451 stmts, 171 miss — floor 97 held); ruff clean; aegis gate passed
with no new findings (baseline unchanged at 1,646). TS untouched.
