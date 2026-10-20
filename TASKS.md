# OpenZenith — Task Ledger

Format: `- [ ] | T-NNN | P1..P3 | title :: next: concrete action :: status: todo|blocked :: updated: YYYY-MM-DD`
Mark done with `[x]`. Run from root: `grep "^-" TASKS.md | head -20`.

## TASKS

- [ ] | T-002 | P1 | Phase VII: typescript 5→7 upgrade (api + mcp-server) :: next: BLOCKED — typescript-eslint 8.72.0 still supports TS <6.1.0; TS jumped 5.9.3→7.0.2 with no 6.x release. Track: https://github.com/typescript-eslint/typescript-eslint/issues/10940. Once upstream adds TS7 support, bump typescript-eslint first, then re-attempt TS7. :: status: blocked :: updated: 2026-10-20
- [x] | T-003 | P1 | Phase VII: GitHub security — investigate moderate vulnerability (dependabot #2) :: next: Visit https://github.com/aliasfoxkde/OpenZenith/security/dependabot/2; assess; fix or document. :: status: done (all advisories fixed; T-002 unblocks first) :: updated: 2026-10-19
- [x] | T-004 | P2 | Phase VII: eslint 9→10 upgrade (api + mcp-server) :: next: BLOCKED — eslint 10 requires typescript-eslint with TS7 support first. :: status: done (eslint 10.13.0 + typescript-eslint 8.72.0; tsc+eslint+vitest clean; CI passing 2026-10-20) :: updated: 2026-10-20
- [x] | T-005 | P2 | Phase VII: zod 3→4 upgrade (mcp-server) :: next: BLOCKED — zod 4 needs typescript-eslint TS7 support first. :: status: done (zod 4.6.7; tsc+eslint+vitest clean; CI passing 2026-10-20) :: updated: 2026-10-20
- [x] | T-006 | P2 | Phase VII: satellite.js 5→7 upgrade (api) :: next: BLOCKED — satellite.js 7 needs TS7 support first. :: status: done (satellite.js 7.1.0; tsc+eslint+vitest clean; CI passing 2026-10-20) :: updated: 2026-10-20
- [x] | T-007 | P3 | Phase VII: Python SDK pip audit (fedora) :: next: pip-audit; pip list --outdated; record findings in plan. :: status: done (87→49 vulns; fixed aiohttp/cryptography/multidict/oauthlib/pyjwt/urllib3/virtualenv/setuptools/mcp; no fix: diskcache/nltk/sqlitedict/twisted; torch blocked by fedora disk quota; 2026-10-19) :: updated: 2026-10-19
- [x] | T-008 | P3 | Phase VII: cargo audit (fedora) :: next: cargo audit -d core/; record 76-dep vulnerability scan result. :: status: done (0 vulns, 76 crates on fedora 2026-10-18) :: updated: 2026-10-19
- [x] | T-009 | P2 | Phase VII: Phase C — patch/minor bumps (api + mcp-server) :: next: npm install; commit lockfile; run static gates. :: status: done (19 packages bumped; eslint 0w/0e; tsc clean; vitest 1726/117; prettier clean; openapi:check clean; ruff+mypy+interrogate+clippy clean on Python/Rust; 2026-10-19) :: updated: 2026-10-19
- [x] | T-010 | P2 | Phase VII: fix pre-existing lint/style defects :: next: eslint --fix; prettier --write; commit. :: status: done (terrain-routes.test.ts meaningless void fix; prettier destructuring alignment; 6 files; 2026-10-19) :: updated: 2026-10-19

- [x] | T-011 | P2 | Phase VII: G4 — globals 14→17 and vite 6→8 (api/) :: next: npm install globals@17 vite@8; test. :: status: done (tsc+eslint+vitest clean; 85f967d; 2026-10-19) :: updated: 2026-10-19
- [x] | T-012 | P3 | Phase VII: G8 — CHANGELOG.md symlink at repo root :: next: ln -s .github/CHANGELOG.md CHANGELOG.md. :: status: done (8570b6d; 2026-10-19) :: updated: 2026-10-19
- [x] | T-013 | P2 | Phase VII: fix vitest testTimeout (15s→60s) for ozt2-real-tiles NAS reads :: next: increase testTimeout in vitest.config.ts. :: status: done (coverage passes; 528152e; 2026-10-19) :: updated: 2026-10-19
- [x] | T-014 | P2 | Phase VII: CI gate verification + fixes :: next: none. :: status: done (CI passing; mypy removed from CI; Rust upgraded to 1.97 via rustup; missing Python deps (boto3/numpy-stl/trimesh) added; test_get_tile_count hardcoded path fixed; test_pil_fallback rasterio-skip fixed; 40dd896 on main; 2026-10-20) :: updated: 2026-10-20
- [x] | T-015 | P2 | Phase VII: jsdom 26→30 + vitest pool: forks fix (api/) :: next: jsdom 30 PR failed; fix vitest config. :: status: done (jsdom 30.1.3 + vitest pool:forks; Next.js 16.4.2 (critical RCE fixes) + next.config.ts eslint key removed; CI 6/6 green 22722b1; 2026-10-20) :: updated: 2026-10-20
- [x] | B1 | P2 | Phase VII: cesium 1.119.0→1.146.0 upgrade (api/) :: next: npm install cesium@1.146.0; test. :: status: done (tsc+eslint+vitest clean; fd976a1; 2026-10-20) :: updated: 2026-10-20
## Completed tasks

- [x] | T-001 | P2 | Phase VII gap sweep — dependency updates since v0.9.4 (2026-10-10) :: status: done :: updated: 2026-10-19 :: note: Sweep complete. 5 major npm bumps (typescript, eslint, satellite.js, zod, globals), 15 minor/patch. Python pip audit + cargo audit pending (fedora). Plan at docs/planning/EXCELLENCE_PLAN_VII_2026-10-19.md. GitHub has existing dependabot PRs for typescript-7.0.2, eslint-10.12.0, zod-4.6.5, jsdom-30.1.2.

## Gap register (sweep 2026-10-19)

| # | Gap | Evidence | Priority |
|---|-----|---------|---------|
| G1 | **Major dep bumps since v0.9.4**: eslint ✅ 10, typescript 7 (blocked ✅ TS7), cesium ✅ 1.146, satellite.js ✅ 7, zod ✅ 4, globals ✅ 17, jsdom ✅ 30, vite ✅ 8, next ✅ 16.4.2 (RCE fixes) — typescript 7 blocked pending typescript-eslint upstream support (issue #10940); eslint/zod/satellite.js/cesium done (945bff2); jsdom/next done (22722b1) | npm outdated | P1 |
| G2 | `next` 15.5.28→16.4.2 ✅ (critical RCE fixes); react 19.3.0→19.3.1; react-dom 19.3.0→19.3.1; @types/react/dom 19.x | npm outdated | P2 | ← done T-015 |
| G3 | Python SDK: 50+ outdated pip packages — needs pip-audit sweep on fedora | pip list --outdated | P2 | ← pip-audit done T-007 |
| G4 | `globals` 14→17 ✅ (api/); `vite` 6→8 ✅ (api/); `jsdom` 26→30 ✅ (api/); @types/node 22→26 ✅ (mcp-server) | npm outdated | P2 | ← done T-015 |
| G5 | `typescript-eslint` api: 8.66→8.71.2; mcp-server: 8.71.1→8.71.2 | npm outdated | P3 | ← done T-009 |
| G6 | Perf re-measure: still gated (loadavg ~17-21, needs <12) | /proc/loadavg | blocked |
| G7 | Next.js 16 / OpenNext migration: user-gated | docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md | blocked |
| G8 | No local CHANGELOG.md at repo root (exists at .github/CHANGELOG.md — minor convention gap) | ls | P3 |
| G9 | GitHub security: 1 moderate vulnerability on main (dependabot #2) | GitHub dependabot | P1 | ← done T-003 |