# OpenZenith — Task Ledger

Format: `- [ ] | T-NNN | P1..P3 | title :: next: concrete action :: status: todo|blocked :: updated: YYYY-MM-DD`
Mark done with `[x]`. Run from root: `grep "^-" TASKS.md | head -20`.

## TASKS

- [ ] | T-001 | P2 | Phase VII gap sweep — dependency updates since v0.9.4 (2026-10-10) :: next: Sweep npm outdated in api/ and mcp-server/, python pip list outdated, cargo audit (on fedora); document findings in docs/planning/EXCELLENCE_PLAN_VII.md gap register. Key finds: eslint 9→10, typescript 5.9→7, cesium 1.119→1.146, satellite.js 5→7, zod 3→4 — all major bumps. :: status: todo :: updated: 2026-10-19

## Completed tasks

(none yet — ledger opened 2026-10-19)

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
| G8 | No local CHANGELOG.md at repo root (exists at .github/CHANGELOG.md — minor doc convention gap) | ls | P3 |
