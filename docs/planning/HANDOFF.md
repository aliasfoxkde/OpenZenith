# OpenZenith handoff

**Evidence boundary (central audit):** branch `main`, HEAD
`23c3120d3dca8a9936941d2c5b1db5024349834c`, 0 dirty status entries.
**Status:** active; multi-surface elevation platform with runtime, offline,
visual, and release qualification still required.
**Role:** geospatial SDK/API/UI with Rust/WASM terrain kernels and optional MCP
surface.
**Rating:** 8/10 (advisory; current repository health is not a production
deployment claim).

> **Current execution authority:** Use `/nas/Temp/repos/Platform-Architecture/docs/planning/HANDOFF_AUDIT_2026-08-13.md` for verified cross-repository findings and `/nas/Temp/repos/Platform-Architecture/docs/planning/CODEX_CLI_EXECUTION_PACKETS_2026-08-13.md` for bounded implementation sessions. This handoff records OpenZenith-specific evidence only.

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

## Verified baseline

The central audit validated commit `23c3120` from a clean Fedora checkout:

- Rust format check, 17 core unit tests, 13 CLI integration tests, and strict
  Clippy all passed.
- `npm ci`, API lint, and the Vitest suite passed: 60 files, 418 tests passed,
  and 5 tests skipped.
- `next build` completed successfully. It reports five existing non-fatal
  unused-variable warnings and Vite dynamic-import warnings from the test
  discovery path.
- Hosted Cloudflare Pages and CodeRabbit checks passed for the qualification
  change.

This is a reproducibility baseline, not evidence of full production,
accessibility, visual-regression, offline-data, MCP, or coverage qualification.

## Open work

1. Measure Python/Rust and UI test coverage; do not reuse the README's claims
   as current coverage evidence.
2. Add deterministic offline fixtures for elevation, terrain, hydrology, and
   tile-cache failure behavior.
3. Qualify browser accessibility, visual regression, and Cloudflare build
   outputs before deployment claims.
4. Decide whether the MCP server is in the Platform execution graph and add a
   versioned contract only after its tests pass.
