# OpenZenith — Session State

> Inherited context (OpenCodifier TASKS/STATE) does not apply here.
> OpenZenith maintains its own task ledger in TASKS.md.

## Last session
- Session 76 (OpenCodifier, separate repo) closed 2026-10-18
- OpenZenith: no prior autonomous session recorded

## Current release
- **v0.9.4** — tagged 2026-10-10, pushed to gitforge/origin
- SHA: e4a87bf / 59a8dbd (1 commit past tag)
- CHANGELOG: .github/CHANGELOG.md (Keep a Changelog format)
- HANDOFF: docs/planning/HANDOFF.md (current through v0.9.4)

## Execution policy
- Heavy CI/test runs → GitForge on fedora (192.168.1.202)
- Swarmone (this host): cheap static checks only, no cargo/npm build
- ship.sh is the documented local deploy exception

## Health indicators
- Python SDK: 0.9.4, 1,650 tests @ 99% (carried from v0.9.3)
- API: 81 paths, openapi.json spec at 0.9.4
- MCP server: 0.9.4, 21 contract tests
- Rust core: clippy pedantic, 99% line coverage (carried)
- Perf re-measure: gated (loadavg gate < 12; current ~17-21)
- Next.js 16 / OpenNext: user-gated, unchanged

## Active phases
- Phase VII planning: open (gap sweep in progress)
- Phase 22 (docs freshness sweep): not yet opened

## Last run
- 2026-10-19 (this session)
