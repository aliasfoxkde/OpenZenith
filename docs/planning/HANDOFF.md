# OpenZenith handoff

**Evidence boundary:** branch `docs/register-openzenith-handoff-20260901`;
base `main` at `f55f465` before this documentation-only change.
**Status:** active; deployed to Cloudflare Pages
(https://openzenith.cyopsys.com) and released through v0.8.3 with
enforced quality gates (see the 2026-09-22 update below). Offline and
visual-regression qualification remain unclaimed.
**Role:** geospatial SDK/API/UI with Rust/WASM terrain kernels and optional MCP
surface.
**Rating:** 8/10 as of v0.8.3 (advisory; was 7/10 pre-gates — coverage
floors, aegis security gate, and a WCAG AAA audit are now enforced; the
MCP surface is still unqualified and app-page coverage is ungated).

> **Current execution authority:** Use `/nas/Temp/repos/Platform-Architecture/docs/planning/HANDOFF_AUDIT_2026-08-13.md` for verified cross-repository findings and `/nas/Temp/repos/Platform-Architecture/docs/planning/CODEX_CLI_EXECUTION_PACKETS_2026-08-13.md` for bounded implementation sessions. This handoff records OpenZenith-specific evidence only.
>
> **Update (2026-09-21):** repo-wide audit and the current phased execution plan
> live in [IMPROVEMENT_PLAN_2026-09-21.md](IMPROVEMENT_PLAN_2026-09-21.md);
> start there for up-to-date state (v0.8.1 baseline, coverage gaps, phases).
>
> **Update (2026-09-22, v0.8.3):** quality gates are now enforced, not
> advisory: ESLint 0 errors, `tsc --noEmit` clean, vitest coverage floors
> 92/83/81/92, pytest `--cov-fail-under=81` (measured 82.08%), Aegis
> security gate green against a committed, triaged baseline
> ([security/TRIAGE.md](../security/TRIAGE.md)), and an axe-core WCAG
> AAA audit in `api/e2e/a11y.spec.ts` (8 pages, green). Known-residual
> work (globe/lib extraction, openapi.json single-sourcing, coverage
> climb toward 95/90) is phased in
> [MASTER_PLAN_2026-09-22.md](MASTER_PLAN_2026-09-22.md). The v0.8.3
> security fix (globe tooltip third-party XSS) is the one true-positive
> finding that re-triage surfaced; it is fixed, not baselined.

## Repository surfaces

- `core/`: maturin/PyO3 Rust/Python package, with its own Cargo manifest and
  Python project metadata.
- `api/`: Next.js application with ESLint, Vitest, Playwright, and Cloudflare
  deployment scripts.
- `mcp-server/`: separate Node package that requires an explicit contract
  check before platform registration.

## Qualification commands

At minimum, validate the core and API independently from clean checkouts:

```bash
cargo fmt --manifest-path core/Cargo.toml --check
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cd api && npm ci && npm run lint && npm run test && npm run build
```

The API's Playwright and Cloudflare Pages paths need separate browser/runtime
evidence. The README's claims about offline data, terrain algorithms, and
WASM must be tested with fixtures rather than inferred from source presence.

## Open work

1. Reproduce the core/API baseline on Fedora without provider credentials.
2. Measure Python/Rust and UI test coverage; do not reuse the README's claims
   as current coverage evidence.
3. Add deterministic offline fixtures for elevation, terrain, hydrology, and
   tile-cache failure behavior.
4. Qualify browser accessibility, visual regression, and Cloudflare build
   outputs before deployment claims.
5. Decide whether the MCP server is in the Platform execution graph and add a
   versioned contract only after its tests pass.
