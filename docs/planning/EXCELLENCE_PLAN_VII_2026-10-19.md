# Excellence plan VII — 2026-10-19

Cycle VII of the excellence series (VI closed 2026-10-10 as v0.9.4; see
[EXCELLENCE_PLAN_VI_2026-10-10.md](EXCELLENCE_PLAN_VI_2026-10-10.md)).
Seeded by a gap sweep 2026-10-19: dependency inventory against v0.9.4 baseline.

## Baseline at plan time

v0.9.4 (e4a87bf, closeout 59a8dbd) — tree clean, both remotes synced.
Gates of record (carried from v0.9.4, not re-verified this sweep):
eslint 0w/0e; tsc clean; vitest 1,704+5 / 117 files at 99.46/97.26/
95.21/99.92; pytest 1,650 @ 99%; mypy strict + interrogate 100%;
clippy + two-pass core gate green; aegis green (2,041 fingerprints);
jscpd 4.09% lines; Playwright E2E (ship.sh deploy gate).

## Gap register (sweep 2026-10-19)

### Production dependencies — api/

| Package | Current | Latest | Delta | Risk |
|---------|---------|--------|-------|------|
| typescript | 5.9.3 | 7.0.2 | **BLOCKED** — TS jumped 5→7 with no 6.x; typescript-eslint 8.71.x supports TS <6.1.0; waiting for upstream TS7 support (issue #10940) | HIGH |
| eslint | 9.39.5 | 10.13.0 | major (9→10) | HIGH |
| cesium | 1.119.0 | 1.146.0 | minor | MEDIUM |
| satellite.js | 5.0.0 | 7.1.0 | major (5→6→7) | HIGH |
| @types/react | 19.2.18 | 19.3.0 | minor | LOW |
| @types/react-dom | 19.2.4 | 19.3.0 | minor | LOW |
| next | 15.5.27 | 15.5.28 | patch | LOW |
| react | 19.3.0 | 19.3.1 | patch | LOW |
| react-dom | 19.3.0 | 19.3.1 | patch | LOW |
| @playwright/test | 1.62.1 | 1.64.1 | minor | MEDIUM |
| prettier | 3.9.6 | 3.9.10 | patch | LOW |
| vitest | 5.0.2 | 5.0.5 | patch | LOW |
| @vitest/coverage-v8 | 5.0.2 | 5.0.5 | patch | LOW |
| globals | 14.0.0 | 17.13.0 | major | MEDIUM |
| jsdom | 26.1.0 | 30.1.3 | major | MEDIUM |
| vite | 6.4.3 | 8.3.4 | major | MEDIUM |
| wrangler | 4.149.0 | 4.151.1 | patch | LOW |
| @types/node | 22.20.1 | 22.20.5 | patch | LOW |
| @cloudflare/workers-types | 5.20260814.1 | 5.20261018.1 | minor | LOW |
| typescript-eslint | 8.66.0 | 8.71.2 | minor | LOW |

### Production dependencies — mcp-server/

| Package | Current | Latest | Delta | Risk |
|---------|---------|--------|-------|------|
| zod | 3.25.76 | 4.6.7 | major (3→4) | HIGH |
| typescript | 5.9.3 | 7.0.2 | major | HIGH |
| eslint | 9.39.5 | 10.13.0 | major | HIGH |
| @types/node | 22.20.5 | 26.6.5 | major | MEDIUM |
| typescript-eslint | 8.71.1 | 8.71.2 | patch | LOW |
| vitest | 5.0.3 | 5.0.5 | patch | LOW |

### Python SDK

| Status | Detail |
|--------|--------|
| pip-audit | Not re-run this sweep (platform issue); pip list shows 50+ outdated packages including aiohttp, boto3, anyio — needs fedora run |
| interrogate | 100% (carried) |
| mypy strict | Clean (carried) |

### Cargo / Rust core

| Status | Detail |
|--------|--------|
| cargo audit | Platform issue on swarmone (advisory DB fetch + lockfile scan hang); run on fedora |
| clippy pedantic | Clean (carried) |
| coverage | 99% (carried) |

### Documentation

| Gap | Status |
|-----|--------|
| No CHANGELOG.md at repo root | .github/CHANGELOG.md is the canonical location; minor convention gap |

### Blocked items (carried)

- **G6**: perf re-measure — still gated (/proc/loadavg ~17-21, needs <12)
- **G7**: Next.js 16 / OpenNext migration — user-gated (scope documented in `NEXTJS16_OPENNEXT_MIGRATION.md`)

## Phases

### Phase A — High-risk major bumps (typescript + eslint + zod)

**A1. typescript 5.9.3 → 7.0.2 (api + mcp-server)**

The 5→7 jump crosses 6.0 (removed webpack alias support, config changes, stricter type narrowing). Do NOT bump in one step:
1. Bump to 6.x first (try ^6), run `tsc --noEmit`, fix errors.
2. Then bump to 7.x, run `tsc --noEmit`, fix errors.
3. Run full vitest + eslint suite after each step.
4. Update tsconfig targets if needed (TypeScript 7 may require ES2024+).
5. **Do this on fedora** (heavy compilation).

**A2. eslint 9.39.5 → 10.x (api + mcp-server)**

ESLint 10 is a major release with breaking changes to the flat config format and deprecated rules. Steps:
1. Pin eslint 10.13.0, `@eslint/js` 10.x, `globals` 17.x.
2. Run `eslint src/ --max-warnings=0`; expect failures (new rules, removed rules, config format changes).
3. Fix the violations; update `.eslintrc.*` → flat config if required by eslint 10.
4. Verify eslint-config-next compatibility (eslint-config-next 16.4.2 should support eslint 10).
5. Update any `globals` usage (major bump: 14→17).

**A3. zod 3.25.76 → 4.x (mcp-server)**

Zod 4 has breaking API changes. Steps:
1. Bump zod to 4.6.7.
2. Run mcp-server vitest suite (21 contract tests).
3. Fix any ZodSchema breaking changes (check Zod 4 migration guide).
4. Update `package.json` / `package-lock.json`.

**A4. satellite.js 5.0.0 → 7.x (api)**

Satellite.js 7 has breaking SGP4/ satellite propagation API changes. The `propagateCatalogueInWorker` Blob worker test must pass:
1. Bump satellite.js to 7.1.0.
2. Run globe E2E suite (Playwright, `ship.sh`).
3. Verify the SGP4 propagation results are numerically equivalent (the Blob worker uses it).
4. Check if the `satellite.min.js` vendor asset in `api/public/vendor/` needs regeneration.

### Phase B — Medium-risk major bumps (cesium, vite, jsdom, globals)

**B1. cesium 1.119.0 → 1.146.0 (api)**

Cesium minor bumps can include breaking viewer/API changes. Steps:
1. Bump cesium to 1.146.0.
2. Run `npm run build` (bundle size check against baseline `api/perf-budget-baseline.json`).
3. Run globe E2E suite (Playwright, ship.sh deploy).
4. Check Cesium 1.120+ breaking changes (viewer options, imagery layer API, terrain provider changes).
5. Update any self-hosted Cesium assets in `api/public/` if required.

**B2. vite 6.4.3 → 8.x (api)**

Vite 8 has breaking changes. Steps:
1. Pin vite to 8.3.4.
2. Run `npm run build`; expect vite config/plugin incompatibilities.
3. Fix any vite.config.ts changes (Vite 8 removed deprecated options).
4. Verify vitest still works (vitest uses vite under the hood).

**B3. jsdom 26.1.0 → 30.x (api — test-only)**

jsdom is a dev dependency. Steps:
1. Bump jsdom to 30.1.3.
2. Run vitest suite; jsdom breaking changes often affect jsdom-specific APIs.
3. Verify no test regressions.

**B4. globals 14.0.0 → 17.x (api — dev-only)**

Needed by eslint 10 upgrade (A2). Covered there.

### Phase C — Patch + minor bumps

Run `npm install` to pull all patch/minor wanted versions across api/ and mcp-server/. No regression risk expected, but record the lockfile diff.

**C1.** api/: react 19.3.0→19.3.1, react-dom 19.3.0→19.3.1, @types/react 19.2.18→19.3.0, @types/react-dom 19.2.4→19.3.0, next 15.5.27→15.5.28, @playwright/test 1.62.1→1.64.1, prettier 3.9.6→3.9.10, vitest 5.0.2→5.0.5, @vitest/coverage-v8 5.0.2→5.0.5, wrangler 4.149.0→4.151.1, @types/node 22.20.1→22.20.5, typescript-eslint 8.66.0→8.71.2, @cloudflare/workers-types → latest, @next/eslint-plugin-next 16.4.0→16.4.2, eslint-config-next 16.4.0→16.4.2, @eslint/eslintrc 3.3.6→3.3.7, @eslint/js 9.39.5→(stay on 9.x per eslint 10 compatibility), eslint-plugin-jsdoc 65.2.0→65.3.12

**C2.** mcp-server/: typescript-eslint 8.71.1→8.71.2, vitest 5.0.3→5.0.5, @types/node 22.20.5→(stay until 22.x compat verified)

### Phase D — Python SDK + Rust core audit

**D1.** Python SDK: on fedora, run `pip-audit` against the installed SDK environment. Record findings. Run `pip list --outdated` and note the gap.

**D2.** Rust core: on fedora, run `cargo audit` against core/Cargo.lock. Record the 76-dep vulnerability scan result.

**D3.** pytest: confirm 1,650 tests still pass after any Python environment changes.

### Phase E — Gates + receipts

- eslint 0w/0e on all TypeScript surfaces
- tsc clean with the new TypeScript version
- vitest: all tests pass (update count guard if suite grew)
- pytest 1,650 @ 99%
- jscpd census (record the new baseline)
- aegis scan (re-baseline if new fingerprints appear from dep updates)
- bundle budget check (cesium/vite bumps can shift JS bundle)
- openapi:check (version sync)
- GitForge CI green on fedora

### Phase F — Release v0.9.5 + deploy + closeout

- **F1.** Version bump at all six sync points (api/package.json, openzenith/\_\_init\_\_.py, mcp-server/package.json + serverInfo, package-locks, openapi spec, .github/CHANGELOG.md entry).
- **F2.** Annotated tag v0.9.5, push both remotes, GitHub release, ship.sh deploy.
- **F3.** Update HANDOFF.md with v0.9.5 closeout.
- **F4.** Update STATE.md / TASKS.md with Phase VII completion.

## Progress log

- 2026-10-19: plan written from gap sweep. Phase A (typescript + eslint + zod + satellite.js) is the critical path — all four are major bumps with potential breaking changes. Phase B (cesium + vite + jsdom) is the secondary path. Phase C is routine patches.
- 2026-10-19 (session open): T-003 closed — zero open dependabot advisories (all listed: GHSA-4jqv, GHSA-mcj8, GHSA-6qxp, etc. are fixed or auto-dismissed). T-002 phase 1: typescript 5.9.3→7.0.2 committed to api/ + mcp-server (api lockfile updated; mcp-server lockfile to be generated on CI). typescript-eslint bumped to 8.71.2 for TS7 support. GitForge run 84beffa9 triggered on 94490f2d — zero-jobs strand suspected (system loadavg 29–40, sqlite unresponsive, concurrent agent wasm-opt/rustc load on FireCraft). CLAUDE.md updated to point to PLAN_VII. Remaining: T-002 phase 2 verification, T-004 (eslint 10), T-005 (zod 4), T-006 (satellite.js 7), B1/B2, C, E, F.
- 2026-10-19 (session continued): All Phase A + Phase B dep bumps committed as 4d25579 — eslint 10, satellite.js 7, zod 4, cesium 1.146, vite 8, globals 17, jsdom 30. GitForge registry was on swarmone localhost:5000 (loopback-only); migrated to fedora localhost:5001. Image loaded on fedora via `docker save | ssh fedora docker load`. GitForge pipeline create blocked by 403 (mkinney dev token can't create pipelines on the bigdata-ci instance at port 42782 — separate from swarmone's at 42780). Workaround: push commits to both remotes; GitHub Actions runs as fallback CI. T-002 phase 2 (tsc --noEmit) pending fedora verification; T-004/005/006 verification via ship.sh E2E gate. Python pip-audit + cargo audit still pending (D1/D2).
- 2026-10-19 (session continued): typescript-eslint 8.71.x supports TS <6.1.0 only. TS jumped 5.9.3→7.0.2 with no 6.x release, so eslint 10 + TS7 is BLOCKED until upstream adds TS7 support (issue #10940). All major dep bumps reverted as 3802610. satellite.js 7, zod 4, cesium 1.146, vite 8 also deferred — they all depend on having a working TS+eslint combo. @eslint/js version was also wrong (10.1.0 doesn't exist; correct is 10.0.1). GitHub Actions had 0-job failures for multiple commits — systemic issue, not our code.
- D1 pip-audit (84 vulnerabilities, 15 packages): cryptography 49.0.0 (PYSEC-2026-3552), mcp 1.28.1 (CVE-2026-59951), pyjwt 2.13.0 (×9 PYSEC), multidict 6.7.1 (PYSEC-2026-4244), setuptools 80.10.2 (PYSEC-2026-3447), sglang 0.5.10 (×6 PYSEC), urllib3 2.7.0 (×3 PYSEC), torch 2.11.0 (PYSEC-2025-194), twisted 26.4.0 (CVE-2026-106454), diskcache 5.6.3 (PYSEC-2026-2447), sqlitedict 2.1.0 (PYSEC-2026-1939), virtualenv 20.35.4 (×4 PYSEC), oauthlib 3.3.1 (PYSEC-2026-4114), nltk 3.10.3 (PYSEC-2026-3740). Fix version available for ~60% of findings.
- D2 cargo audit: 76 crate dependencies, 0 vulnerabilities (exit 0).
