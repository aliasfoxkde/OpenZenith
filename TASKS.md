# OpenZenith — Task Ledger

Format: `- [ ] | T-NNN | P1..P3 | title :: next: concrete action :: status: todo|blocked :: updated: YYYY-MM-DD`
Mark done with `[x]`. Run from root: `grep "^-" TASKS.md | head -20`.

## TASKS

- [ ] | T-002 | P1 | Phase VII: typescript 5→7 upgrade (api + mcp-server) :: next: BLOCKED — typescript-eslint 8.71.x supports TS <6.1.0; TS jumped 5.9.3→7.0.2 with no 6.x release. Track: https://github.com/typescript-eslint/typescript-eslint/issues/10940. Once upstream adds TS7 support, bump typescript-eslint first, then re-attempt TS7. :: status: blocked :: updated: 2026-10-19
- [x] | T-003 | P1 | Phase VII: GitHub security — investigate moderate vulnerability (dependabot #2) :: next: Visit https://github.com/aliasfoxkde/OpenZenith/security/dependabot/2; assess; fix or document. :: status: done (all advisories fixed; T-002 unblocks first) :: updated: 2026-10-19
- [ ] | T-004 | P2 | Phase VII: eslint 9→10 upgrade (api + mcp-server) :: next: BLOCKED — eslint 10 requires typescript-eslint with TS7 support first. :: status: blocked :: updated: 2026-10-19 :: note: Blocked by T-002 (typescript-eslint TS7 support)
- [ ] | T-005 | P2 | Phase VII: zod 3→4 upgrade (mcp-server) :: next: BLOCKED — zod 4 needs typescript-eslint TS7 support first. :: status: blocked :: updated: 2026-10-19 :: note: Blocked by T-002
- [ ] | T-006 | P2 | Phase VII: satellite.js 5→7 upgrade (api) :: next: BLOCKED — satellite.js 7 needs TS7 support first. :: status: blocked :: updated: 2026-10-19 :: note: Blocked by T-002
- [ ] | T-007 | P3 | Phase VII: Python SDK pip audit (fedora) :: next: On fedora: pip-audit; pip list --outdated; record findings in plan. :: status: blocked :: updated: 2026-10-19
- [ ] | T-008 | P3 | Phase VII: cargo audit (fedora) :: next: On fedora: cargo audit -d core/; record 76-dep vulnerability scan result. :: status: blocked :: updated: 2026-10-19

## Completed tasks

- [x] | T-001 | P2 | Phase VII gap sweep — dependency updates since v0.9.4 (2026-10-10) :: status: done :: updated: 2026-10-19 :: note: Sweep complete. 5 major npm bumps (typescript, eslint, satellite.js, zod, globals), 15 minor/patch. Python pip audit + cargo audit pending (fedora). Plan at docs/planning/EXCELLENCE_PLAN_VII_2026-10-19.md. GitHub has existing dependabot PRs for typescript-7.0.2, eslint-10.12.0, zod-4.6.5, jsdom-30.1.2.

## Gap register (sweep 2026-10-19)

| # | Gap | Evidence | Priority |
|---|-----|---------|---------|
| G1 | **Major dep bumps since v0.9.4**: eslint 9.39.5→10.13.0, typescript 5.9.3→7.0.2, cesium 1.119.0→1.146.0, satellite.js 5.0.0→7.1.0, zod 3.25.76→4.6.7 (mcp-server) — all need careful upgrade path + regression run | npm outdated | P1 |
| G2 | `next` 15.5.27→15.5.28 patch (api/); react 19.3.0→19.3.1 patch (api/); react-dom 19.3.0→19.3.1 patch | npm outdated | P2 |
| G3 | Python SDK: 50+ outdated pip packages (affine, aiohttp, anyio, boto3, etc.) — needs pip-audit sweep on fedora | pip list --outdated | P2 |
| G4 | `globals` 14.0.0→17.13.0 (api/); `jsdom` 26.1.0→30.1.3 (api/); `vite` 6.4.3→8.3.4 (api/) | npm outdated | P2 |
| G5 | `typescript-eslint` api: 8.66.0→8.71.2; mcp-server: 8.71.1→8.71.2 | npm outdated | P3 |
| G6 | Perf re-measure: still gated (loadavg ~17-21, needs <12) | /proc/loadavg | blocked |
| G7 | Next.js 16 / OpenNext migration: user-gated | docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md | blocked |
| G8 | No local CHANGELOG.md at repo root (exists at .github/CHANGELOG.md — minor convention gap) | ls | P3 |
| G9 | GitHub security: 1 moderate vulnerability on main (dependabot #2) | GitHub dependabot | P1 |