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
>
> **Update (2026-09-24):** production reliability + dataset truth tasks
> #124–#130 complete (see MASTER_PLAN progress log): render-schema
> versioning with undated-cache staleness fix (#125), concurrent tile
> assembly + single-flight merged downloads killing the sticky 503s —
> 0/36 first-wave post-deploy (#126), and the HuggingFace OZT2 dataset
> brought to verified truth (#127–#130): z10 151,988/151,988
> byte-identical; z7–z9 refreshed to the current generation after
> fixing the uploader's CDN-cached landing probe (resolve HEAD returns
> 200 with OLD bytes — never trust it for overwrite batches); z11 stays
> R2-authoritative, HF z11 copy is legacy and unconsumed. Validator
> (`scripts/validate_hf_ozt2.py`) now paginates the tree API with
> retry; never call `dataset_info(files_metadata=True)` or
> `delete_files(patterns)` on this 150K+-file repo — both hang.

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

1. Globe/map page monolith extraction (multi-session; landing-page pattern
   already established in `globe/lib/{widgets,tools,layers}`).
2. GitForge CI verification needs the user's interactive
   `gitforge auth --login`; the push path itself works (transient
   server-side stalls self-heal — retry or re-fetch).
3. Coverage climb toward 95/90 and openapi.json single-sourcing (phased in
   MASTER_PLAN).
4. HF z11 backfill is NOT scheduled: ~595K files ≈ 4h+ under the
   128-commits/hour cap, and nothing consumes the HF z11 copy (R2 is
   authoritative). Revisit only if the SDK gains an HF z11 consumer.
5. Decide whether the MCP server is in the Platform execution graph and add a
   versioned contract only after its tests pass.
