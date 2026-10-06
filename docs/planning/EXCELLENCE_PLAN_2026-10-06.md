# Excellence Plan II — 2026-10-06 (re-audit, gaps G-1…G-5)

**Mandate:** fresh audit of the repo state after the 2026-10-02 plan
(`EXCELLENCE_PLAN_2026-10-02.md`) executed through Phase 8 plus the
2026-10-05/06 defect waves — measure everything live again, enumerate what is
genuinely still open, and close it. Same rules as the first plan: every
target measurable, every exclusion justified, no placeholders, no fake
metrics, findings recorded before the thread closes.

**Inputs:** all gates re-run live on this host at commit `e0d2815`
(2026-10-06), Aegis full rescan, sibling-repo governance refresh (GitForge,
StationAware), and the remaining register of the 2026-10-02 plan.

---

## 1. Baseline (verified 2026-10-06, `main` = e0d2815)

| Gate | State | Evidence |
|---|---|---|
| pytest (openzenith/) | **1,525 passed / 14 deselected, 99.48% lines** (floor 99) — grew +46 tests since the first audit | `audit-pytest.log` |
| cargo (core/) | clippy `-D warnings` 0 · fmt 0 · all workspace tests pass | `audit-clippy.log`, `audit-cargo-test.log` |
| vitest (api/) | 107 files / 1,519 passed + 5 skipped, coverage floors met (earlier today, tree unchanged) | `vitest-full-volcano2.log` |
| tsc (api/) | clean | same run |
| eslint (api/) | **0 errors**; **1,909 warnings in 40 files** — 37 under `src/app/globe/**`, plus `e2e/ozt2-validate.spec.ts`, `e2e/production-verify.spec.ts`, `next.config.ts`. CI ratchet is ≤1890 (grep count via `npm run lint`) — **resolved 2026-10-06: 0 warnings / 0 errors; gate is now `eslint . --max-warnings=0` (progress log)** | `audit-eslint.log` |
| a11y E2E | **67 passed + 3 flaky (all green on retry), exit 0** vs prod: 11 pages axe-audited (wcag2a+aa+aaa+best-practice), keyboard 2.1.1/2.4.3/2.4.7, focus-visible, focus-trap, target-size 2.5.8 + AAA delta — **extended 2026-10-06: skip-link 2.4.1 tests (11 pages × 3 browsers), 91 passed local (1 known globe-axe flake, green on retry)** | `audit-a11y.log` |
| prod-verify + globe-diag E2E | **32 passed, 0 failed** vs live prod | `audit-prod-verify.log` |
| perf budget | PASS, 12/12 checks; baseline ratcheted down 2026-10-06 (totalJs −1,407 B vs pre-wave) | `perf-budget-baseline.json` |
| mcp-server | tsc clean · 8/8 tests · CI job green (run 46124e1d) | live |
| **Aegis** | **GATE RED: 1,049 findings not in the 2026-09-22 baseline.** 11 critical / 100 high / rest medium-low. Gate is local-only (not in CI) | `audit-aegis.log` |
| GitForge CI | **first green run 46124e1d** (2026-10-06, 957588f), all 7 jobs | GitForge API |
| Governance | `.github/SECURITY.md` ✓ · `docs/security/TRIAGE.md` ✓ · **missing: CONTRIBUTING.md, CODEOWNERS** | `ls` |

**Closed from the 2026-10-02 register** (verified today): F-4, F-5 (no
`placeholder|stub` strings in routes/SDK), F-8 (mcp-server has CI + gates),
F-9, F-10, F-11, F-12, F-15 (workflows marked non-authoritative), F-17's
dem-tile console.log, F-18 (task #174 closed 2026-10-06). F-13's enumerated
a11y gaps are closed: 10 pages + globe audited (was 8), keyboard + target
size checks exist (were zero), main landmarks with sr-only context on map.

---

## 2. Gap register (ranked; G-IDs referenced by phases)

| ID | Finding (evidence) | Impact |
|---|---|---|
| G-1 | **Aegis baseline 8 months stale in practice:** 1,049 findings post-date the 2026-09-22 tuning — refactor line-drift re-flagging known-FP classes (try-catch-bulk 104, no-cache-headers 97, cors-misconfiguration 68, rust-unwrap-usage 67 in tests, react-missing-key-prop 54) plus the Phase-3 test additions that never went through triage. Criticals spot-checked all FPs: `git-credential-leak` = test URLs; `credit-card-number-generic` = a 16-digit float; `aws-access-key` = substring inside the base64 WASM blob. **And the gate runs nowhere automatically.** | the security control is red AND silent; a real new finding would hide in this noise |
| G-2 | **eslint warnings 1,909 in 40 files**, all `no-unsafe-*` family at Cesium/MapLibre/fetch boundaries: 37 globe files (the known residual), 2 e2e specs, next.config.ts. The 2026-10-02 plan's ratchet stalls at ≤1890 instead of driving to 0 | type safety decorative on the entire globe stack — the layer where third-party APIs drift most |
| G-3 | **Governance files missing:** no CONTRIBUTING.md, no CODEOWNERS (GitForge — the platform we mirror practices from — has both under `.github/`) | contribution surface undefined; review ownership unassigned |
| G-4 | **SDK library print() residue:** ~20 runtime `print()` sites outside `cli.py` — error paths in `hydrology/watersheds.py` (47, 60, 85) and `tracing.py` (62) print ❌ instead of raising; progress prints in `elevation.py` download functions and `async_client.py`; demo `__main__` blocks in `merged.py`/`async_client.py`/`fuse.py`. Docstring examples are fine (documentation). F-17 was declared closed with the CLI's 213 prints counted as the residue; these library sites predate that closure and were missed | libraries that pollute caller stdout; error paths that should be exceptions print and continue |
| G-5 | ** eslint gate of record vs `eslint .` divergence:** `npm run lint` counts 1,887 warnings; raw `npx eslint .` counts 1,909 (the lint script's file set excludes e2e/ + next.config.ts). The CI ratchet measures the narrower set, so the wider set can drift unbounded | blind spot in the ratchet |

**Explicitly not in scope (unchanged, user-gated):** Next.js 16 / OpenNext
migration (`planning/NEXTJS16_OPENNEXT_MIGRATION.md` — decision required, no
code migrated); the instrumented-coverage boundary statement stands (frontend
React components remain outside the vitest instrumented set by documented
decision).

---

## 3. Phases

Ordering: the red security gate first (G-1 — it is the only failing gate),
then the small hygiene wins (G-3, G-4, G-5) so the tree is clean, then the
largest mechanical effort (G-2), then the ratchet widening it protects
(G-5 verification rides along), and release/deploy last. Each phase ends
committed + pushed (gitforge first) and re-gated.

### Phase 1 — Aegis: re-triage, re-baseline, wire into CI (G-1)

1. **Prove the class inventory, not just spot checks.** Group all 1,049 by
   `(pattern, file)`; for every pattern class NOT already dispositioned in
   `docs/security/TRIAGE.md`, manually review a sample of its findings and
   either (a) fix the finding, or (b) record the class rationale in TRIAGE.md
   under a dated heading. Known-FP classes at new line positions get recorded
   as drift, not re-reviewed line by line — that is what fingerprints are for.
2. Fix any finding that is genuinely actionable rather than baseline-able
   (candidates: `sync-in-async` 34, `missing-limit` 29 — verify these are
   really FPs before writing them off).
3. `scripts/aegis_scan.sh update` — regenerate the baseline **after** the
   TRIAGE.md entries exist (policy: never regenerate to make the gate pass).
4. Add an `aegis` job to `.gitforge.yml` running `scripts/aegis_scan.sh` as a
   delta gate (fails on new findings only). Document the same-host assumption
   the fingerprints require (TRIAGE.md already does; reference it from the
   job comment). Gate must be green on its own commit.
5. Re-run the gate twice: once clean (green), once with an injected known-new
   pattern in a scratch file (red) to prove the delta actually trips — delete
   the scratch file after.

### Phase 2 — Governance + residue (G-3, G-4)

1. `CONTRIBUTING.md` at repo root: dev setup (api/, openzenith/, core/,
   mcp-server/), the gate list with commands, the GitForge-first push policy,
   commit format pointer, pointer to SECURITY.md for vulnerabilities. No
   invented policies — document what the gates already enforce.
2. `.github/CODEOWNERS`: `*` → repo owner; `core/` → owner (Rust surface);
   `openzenith/` → owner (SDK). Small file, honest entries only.
3. SDK print residue: watersheds/tracing error-path prints → raise
   (`RuntimeError`/domain error) or `logging` — check their tests capture
   behavior before changing the contract; progress prints in
   `elevation.py`/`async_client.py` → module-level `logging.getLogger` at
   INFO, keeping CLI UX via `cli.py`; drop the stale `__main__` demo blocks
   (their examples live in docstrings/README already).
4. `pytest` + `ruff` green after.

### Phase 3 — Globe eslint warnings → 0 (G-2)

1. Type the remaining unsafe boundaries in `src/app/globe/**` (37 files):
   fetch/json response interfaces, Cesium vendor `any` escapes via the
   established narrowing helpers pattern (same approach that took map/lib and
   the API routes to zero). No `eslint-disable` additions — typed boundaries
   or narrowly-scoped interfaces.
2. The 3 non-globe files: type e2e specs' page accesses, type next.config.ts.
3. Gate: `npm run lint` → 0 warnings; tighten `.gitforge.yml` ratchet
   1890 → 0; ALSO add a raw `npx eslint .` count assertion so the wider file
   set cannot drift (closes G-5's blind spot).
4. vitest + tsc green after (typed refactors can shift inference).

### Phase 4 — Final validation, release, deploy (Phase E)

1. Full local gate battery: vitest, tsc, lint (0/0), pytest, ruff, mypy,
   cargo fmt/clippy/test + coverage gate, a11y + landing + production-verify
   E2E vs prod, perf budget, Aegis delta gate.
2. GitForge CI green on the release commit (auto-triggers on push; verify
   run ownership via the detail endpoint — the pipeline_id filter is not
   honored).
3. Version bump + tag + GitHub release with notes from this plan's deltas
   (v0.9.1 — defect fixes + hygiene, no breaking changes), push tag
   explicitly to both remotes (`--follow-tags` skips lightweight tags —
   push and verify).
4. Deploy via `scripts/ship.sh` (fresh marker), prod-verify: hash-URL health,
   `/api/volcanoes` GeoJSON still live, layer-status probe.
5. Closeout: update HANDOFF.md + memory; confirm tree clean.

---

## 4. Progress log

- 2026-10-06: audit executed (all tables above); plan written; phases 1–4
  open.
- 2026-10-06 (later): Phase 1 (task #201) — aegis triage completed (1,049
  findings dispositioned, 0 true positives; TRIAGE.md 2026-10-06 entry) and
  the gate moved INTO GitForge CI as the pipeline's first job
  (`openzenith-ci-aegis:1` image, node:22-trixie + aegis baked in for
  GLIBC_2.39; pushed to the local OCI registry by
  `scripts/ci/build-ci-image.sh`; fingerprints made repo-relative so the
  /workspace checkout produces identical baselines). The gate proved itself
  in CI by tripping on 5 untriaged ssrf-localhost findings the registry
  references introduced — triaged, re-baselined, green. CI-green status:
  aegis/install/typecheck all pass on the swarmone-docker runner (runs
  b6eec7b4, 2b31adc6); red runs since 963a50a are a PLATFORM defect, not
  pipeline defects — the scheduler has no runner affinity and the
  fedora-docker runner cannot exec workspace binaries (noexec:
  "eslint: Operation not permitted"; npx falls back to fake tsc@2.0.4) nor
  reach the loopback-only OCI registry. Diagnosed from job→runner_id
  mapping + receipts; documented in .gitforge.yml header and memory; needs
  a platform-level fix (fix that host's mount, or add runner pinning).
  Phase 2 (task #202) — SDK print residue: elevation.py download-progress
  prints and watersheds/tracing error prints converted to the `_logger`
  idiom (return-None contracts unchanged; capsys tests moved to caplog);
  merged.py `__main__` smoke-test KEPT (tested, deliberate diagnostic);
  async_client `progress=True` print KEPT (tested flag contract). pytest
  1,525 passed / 99.07% coverage, ruff clean; aegis re-triaged after the
  line drift (TRIAGE.md 2026-10-06b: 11 findings = line-drift of 4
  dispositioned classes, mapping table recorded). New: CONTRIBUTING.md
  (documents the real gates only). CODEOWNERS deliberately deferred:
  GitForge parses no CODEOWNERS (grep across crates/services — zero
  references) and the GitHub mirror is inactive, so an ownership file
  nothing enforces would be decoration; revisit if GitForge gains review
  approval or the mirror wakes up.
- 2026-10-06 (later): Phase 3 (task #199) — the entire globe surface typed
  against the ambient `cesium-types.d.ts` declarations and the typed
  data-fetchers boundaries: pilot `orbital-tracks.ts`, then a dependency-
  ordered wave fan-out (foundation: helpers/data-fetchers/lod/terrain-ozt2/
  terrarium-terrain/space-scene → all 22 layer modules → tools suite,
  widgets, HudOverlays, the two Cesium E2E specs, next.config.ts →
  page.tsx last, with a `LayerModules` registry of 22 typeof-imports and a
  typed dispatch). **1,909 warnings / 40 files → 0 warnings / 0 errors
  across all 444 files** (`npx eslint .`). Graduation: eslint.config.mjs
  promotes the `no-unsafe-*` family + `restrict-template-expressions` to
  ERROR for `src/app/globe/**` + the two E2E specs; `.gitforge.yml`'s lint
  job replaced the ≤1890 grep-count guard with `npx eslint .
  --max-warnings=0` (closes G-5 — the gate of record now covers the wider
  file set, including next.config.ts). Five runtime defects surfaced by
  typing and fixed: the elevation-color loader stored its
  PointPrimitiveCollection under the wrong object (dot field never drew);
  nlnog constructed CustomDataSource without `new` (layer never rendered);
  coverage.ts discarded the ImageryLayer handle addImageryProvider returns
  (alpha tuning was a no-op); annotations.setLabel replaced the whole
  LabelGraphics bag (caption lost font/colour/offset — now sets
  `graphics.text`); bookmarks.loadBookmarks now shape-checks stored
  entries (a malformed payload crashed the widget's `bookmarks.map`).
  Gates: tsc clean; vitest 106/107 files green — the one failure is an
  ozt2-real-tiles NAS timeout that passes in isolation (13/13; same flake
  class the CI job's three-retry pattern absorbs).
- 2026-10-06 (later): Phase 2 of the a11y workstream (task #200) — the
  remaining WCAG 2.4.1 gap closed: a root-layout skip link (new
  `src/components/SkipLink.tsx`, revealed by the `.skip-to-content:focus`
  rule in globals.css; explicit `target.focus()` on click because fragment
  navigation alone leaves `document.activeElement` on body in
  Firefox/Safari) plus `id="main-content" tabIndex={-1}` on all 13 page
  `<main>` landmarks, and the globe's Cesium container now names itself the
  way the 2D map already did (`role="application"
  aria-label="Interactive 3D globe"` — the canvas carries no text). New
  E2E describe "Skip link (2.4.1 Bypass Blocks)" presses the actual keys
  on all 11 audited pages + globe × chromium/firefox: first Tab must land
  on the link, Enter must focus main. Local run vs dev server: **91
  passed, exit 0** (1 known globe-axe flake green on retry); tsc + eslint
  clean.
