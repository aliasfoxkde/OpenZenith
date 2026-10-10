# Contributing to OpenZenith

Thanks for your interest in improving OpenZenith. This document describes the
gates a change must pass and where they run. Every gate described here exists
in the repository — this file does not invent policy; it points at what is
enforced and where.

## Repository layout

See [CLAUDE.md](CLAUDE.md) for the full architecture map and
[docs/CLAUDE.md](docs/CLAUDE.md) for the documentation precedence rules.
In short: `api/` is the Next.js surface (pages + 81 API routes + shared
libs), `openzenith/` is the Python SDK, `core/` is the Rust crate compiled
to WASM (browser) and a CLI binary, `mcp-server/` is the MCP stdio server
over the REST API, and `scripts/` holds data-pipeline and gate tooling.

## CI/CD — GitForge is primary

[`.gitforge.yml`](.gitforge.yml) defines the pipeline that runs on the
GitForge instance on every push to `main`. Its header documents the schema
constraints and platform hazards; the jobs, in dependency order:

| Job | Checks | Fail condition |
|---|---|---|
| `aegis` | `scripts/aegis_scan.sh` — security pattern scan over `api/src`, `openzenith`, `core/src`, `core/tests`, `scripts` | NEW findings whose fingerprint is absent from `docs/security/aegis-baseline.json` (existing findings are triaged in `docs/security/TRIAGE.md`) |
| `install` | `npm ci` in `api/` | install failure |
| `typecheck` | `tsc --noEmit` in `api/` | type error |
| `lint` | ESLint in `api/` + warning-baseline guard | errors, or warning count grows past the ratchet recorded in `.gitforge.yml` |
| `spec-check` | `npm run openapi:check` | committed OpenAPI spec is stale vs routes |
| `unit-test` | Vitest (api/) with an in-command retry | test failure, or an incomplete/short run (file + test totals asserted against a recorded baseline) |
| `mcp-server` | strict typecheck, typed ESLint (0 warnings), contract tests | any failure |
| `bundle-budget` | `pages:build` + `scripts/perf-budget.mjs` | bundle size/structural regression vs `api/perf-budget-baseline.json` |

Deliberately **not** in the pipeline (and why — from `.gitforge.yml`): E2E
(Playwright) and deploys stay local because the CI host is a shared NAS where
browser suites and builds are load-lotteries; deploy is a deliberate act via
`scripts/ship.sh` (build → bundle-marker check → deploy → production E2E
verification), never an automatic one.

GitHub Actions (`.github/workflows/`) is a **non-authoritative mirror check**
(`ci.yml` header says so explicitly); a red GitHub run is not a code signal.

## Local gates before pushing

Run what matches what you touched — the CI pipeline runs all of these, and
pushing known-red code wastes a ~30-minute pipeline:

```bash
# api/ (TypeScript, Next.js)
cd api && npm ci
npm run lint            # eslint; the CI job fails on warning-count growth
npx tsc --noEmit        # typecheck (CI's `typecheck` job runs exactly this)
npm run test            # vitest
npm run openapi:check   # after changing routes: npm run openapi:generate

# openzenith/ (Python SDK)
ruff check openzenith/
pytest openzenith/tests/ -v

# core/ (Rust)
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
scripts/core_coverage_gate.sh     # line-coverage floor (95%)

# Security pattern scan (same gate CI runs)
scripts/aegis_scan.sh              # delta vs committed baseline; see docs/security/TRIAGE.md

# E2E (local; also part of the deploy path)
cd api && npx playwright test --workers=2
```

## Commits

Conventional Commits (`feat|fix|docs|style|refactor|test|chore(scope):
subject`), subject ≤ 50 chars imperative, body wrapped at 72. The pre-commit
bar is the local-gates list above, clean.

Push order: **GitForge first, then the GitHub mirror** (`gitforge` remote
alongside `origin`). Never force-push; credentials and tokens never belong in
repo files, docs, or command output.

## Security findings and the aegis baseline

`scripts/aegis_scan.sh` fails on findings not present in
`docs/security/aegis-baseline.json`. If your change introduces a new finding:

1. Verify whether it is real. Most new findings are scanner false positives —
   check `docs/security/TRIAGE.md` for the established disposition classes.
2. Add a dated entry to `docs/security/TRIAGE.md` explaining the finding and
   the disposition (fixed, or false positive with evidence).
3. Only then regenerate the baseline: `scripts/aegis_scan.sh update`.

Never regenerate the baseline to make the gate pass — that is the one rule
of this gate. The gate exists to force the triage conversation, and the
triage document is the artifact.

## Placeholders and fake data

Do not land placeholder, stub, simulated, or otherwise fake data or
implementations (`TODO`/`FIXME`/`HACK`, hardcoded counts posing as measured
values, mock responses in product code). Planning documents are the right
home for example code; product code ships complete. Test fixtures that
simulate external services are fine and live in `tests/`.

## Documentation

User-facing docs live in `docs/` (canonical; see
[docs/CLAUDE.md](docs/CLAUDE.md) for precedence over `docs/archive/`).
When your change alters behavior a doc describes, update the doc in the same
change — the API surface in particular is contractual
(`api/src/app/api/openapi.json` is checked against routes in CI).

## Reporting issues

Security-sensitive reports: see [SECURITY.md](docs/SECURITY.md).
Everything else: open a ticket on the GitForge instance for this repository
or a GitHub issue on the mirror; either reaches the maintainers.
