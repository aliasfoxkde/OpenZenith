# OpenZenith handoff

> **Update (2026-10-05):** the excellence plan
> ([EXCELLENCE_PLAN_2026-10-02.md](EXCELLENCE_PLAN_2026-10-02.md), gaps
> F-1…F-18) is executed through Phase 8: WCAG 2.1 AAA wave (disclosure
> flip cards, 2.5.8 floors), one raster factory replacing 29 map layer
> modules, typed abort-on-teardown for all globe fetches, coverage
> floors at 99 across TS/Python/Rust, docs-claims gate, all 390 exported
> TS symbols JSDoc'd, GitHub workflows marked NON-AUTHORITATIVE. **v0.9.0
> cut, tagged (verified on both remotes), GitHub-released, deployed via
> ship.sh, and prod-verified** (hash URL serves 0.9.0 on /api/health and
> /api/openapi.json; landing E2E 22 passed + 2 flaky after re-basing the
> two stale flip-card tests onto the disclosure contract — the ship gate
> caught that miss). Open: quiet-host perf re-measure
> (loadavg < 12 gate); Next16/OpenNext still user-gated.
> **GitForge CI is green**: run 46124e1d (2026-10-06, commit 957588f),
> all 7 jobs succeeded — the 2026-10-05 runner-workspace fault was
> episodic and did not recur (caution: the `/api/pipeline-runs`
> pipeline_id filter is not honored — verify a run's ownership via its
> detail endpoint before diagnosing "my" failures). Done since:
> layer-toggle crawl executed and its defect classes fixed in two waves
> (2026-10-05 — wave 1: glyphs, dispatcher race, guarded removers,
> waterways contract; wave 2: all 24 remaining layer modules swept onto
> the removers, pinned by an invariant test, and the Volcano Alerts
> CORS defect fixed via a new `/api/volcanoes` proxy route; see the
> excellence plan's "Map client layer fixes" entries).

> **Update (2026-10-02):** the performance deep-dive
> ([PERFORMANCE_PLAN_2026-10-02.md](PERFORMANCE_PLAN_2026-10-02.md)) is
> executed through P0+P1: fonts self-hosted, landing render storm fixed,
> /map layers lazy-loaded, layer timer lifecycles repaired on both maps,
> tile routes `immutable`, geocode/elevation edge-cached — all deployed
> and prod-verified (ship.sh; X-Cache HIT + immutable headers confirmed
> via Playwright). New gates: `perf-budget.mjs` (+ CI job) and the
> `measure-perf.mjs` CDP harness — re-measure only when
> `/proc/loadavg` < 12 (co-tenant builds poison wall-clock numbers).
> Open: globe data-fetcher abort-on-teardown; P2 items 11–15; Next16/
> OpenNext and `gitforge auth --login` remain user decisions.

> **Update (2026-10-01):** the reliability-gap audit
> ([RELIABILITY_GAPS_2026-10-01.md](RELIABILITY_GAPS_2026-10-01.md)) is
> worked through: ship gate (`scripts/ship.sh`: build → bundle-marker
> check → deploy → prod E2E), a GitForge CI pipeline (`.gitforge.yml`;
> first run pending an interactive `gitforge auth --login`), landing E2E
> hydration guards, mcp-server vitest 5 (0 npm-audit vulns there), lint
> at 3,744 warnings/0 errors (was 4,111), repo scratch trimmed. Open
> user decisions: Next.js 16 / OpenNext migration
> ([NEXTJS16_OPENNEXT_MIGRATION.md](NEXTJS16_OPENNEXT_MIGRATION.md)) and
> the pipeline activation login above.

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
>
> **Update (2026-09-28):** the "z11 stays R2-authoritative" note above is
> historical. R2 was decommissioned 2026-09-27 and z11 is complete and
> byte-validated on HuggingFace (595,149 tiles, 0 missing / 0 stale /
> 0 extra) — see `docs/DATASET_MANIFEST.md` and `docs/ARCHITECTURE.md`.

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

> **Update (2026-09-24, v0.8.4):** release cut covering the whole
> #110–#134 range (inverted-D8 hydrology family, channels/inundation/vector,
> tile decode + render-schema fixes, WMTS conformant set, single-source
> OpenAPI, zero production CVEs, SDK packaging). Coverage goals met: TS
> functions 100% (375/375), floors 95/90/86/95; Python 98.8% (floor 97);
> Rust core 98%. Map page monolith extraction underway: waves 1-3 took
> map/page.tsx 3,053 → 2,199 lines (view-state/boundaries/map-setup libs,
> panels.tsx, controls.tsx), deployed and E2E-verified per wave.

## Open work

1. ~~Map/globe/explore monolith extraction~~ — **complete** (tasks
   #136–#138, closed 2026-09-24/25): map/page.tsx 3,053 → 1,457
   (−52%, 7 waves), globe JSX surface fully composed from extracted
   components, explore/page.tsx 1,641 → 594 (−64%, data.ts + 7 tab
   components). Remaining bodies are the stateful cores (refs, fetch
   handlers, event effects) documented in MASTER_PLAN_2026-09-22.md.
2. GitForge CI verification needs the user's interactive
   `gitforge auth --login`; the push path itself works (transient
   server-side stalls self-heal — retry or re-fetch).
3. ~~HF z11 backfill is NOT scheduled~~ — **complete** (2026-09-28): the
   595,149-tile backfill landed on HuggingFace and is byte-validated; R2
   itself was decommissioned 2026-09-27. See `docs/DATASET_MANIFEST.md`.
4. Decide whether the MCP server is in the Platform execution graph and add a
   versioned contract only after its tests pass.
