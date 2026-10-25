# Excellence plan VIII — 2026-10-24

Cycle VIII of the excellence series (VII closed 2026-10-24; see
[EXCELLENCE_PLAN_VII_2026-10-19.md](EXCELLENCE_PLAN_VII_2026-10-19.md)).
Scope: close the graduation ratchet, extend CI to the whole monorepo,
and re-verify every gate of record.

## Baseline at close (2026-10-24)

Measured this cycle, not carried:
- eslint: 479 files, 0 errors / 0 warnings (graduation block deleted; census
  of all 186 grandfathered files = 0 jsdoc violations — ratchet fully closed).
- vitest: 1,731+ guard across 125 files; coverage 99.42 / 97.32 / 95.09 /
  99.88 vs floors 99/96/94/99.
- pytest / mypy strict / interrogate: green, docstring coverage 100%.
- Rust (in-image): fmt + clippy clean, 111 tests, coverage 96.40% (wasm
  features, floor 95) and 99.25% (default features, floor 99).
- aegis: gate green; baseline regenerated at 2,084 fingerprints; triage
  entry 2026-10-21 in docs/security/TRIAGE.md.
- WCAG axe audit (production): 46/46 chromium AND 46/46 firefox — zero
  first-party violations; 44px AAA target-size deltas reported-not-enforced.
- GitForge pipeline: 10 jobs (rust-gates + python-gates added this cycle).

## Work completed this cycle

1. **jsdoc graduation ratchet closed** (186-file block deleted from
   eslint.config.mjs; every file hand-documented; census-verified).
2. **Rust + Python CI images** (scripts/ci/Dockerfile.{rust,python},
   build-ci-images.sh with publish mode): toolchain- and lockfile-pinned,
   gates verified in-image, published to the runner host's OCI registry.
3. **Pipeline extended to the full monorepo**: rust-gates and python-gates
   jobs with hard coverage floors.
4. **Aegis preflight** (scripts/aegis_scan.sh) — fails loudly on the
   shadowed PyPI `aegis` binary; build script recovers the scanner from
   the image.
5. **Registry-ref defect fixed (this session)**: jobs dispatch to swarmone,
   whose GitForge registry is 127.0.0.1:5000; the .gitforge.yml refs said
   :5001 (fedora-era) — every image job failed sandbox pulls with
   "connection refused". Fixed, images re-pushed, run re-triggered.
6. **tar positional-option defect fixed**: trailing --exclude after a file
   operand is silently ignored (GNU tar); the install/rust-gates tar
   pipelines put excludes first.

## Known deltas / residual risk

- 44px WCAG AAA target-size guidance: 138 controls across audited pages
  sit between the 24px AA floor and 44px AAA guidance — reported each run,
  accepted as a design-system decision, not a defect.
- `api/node_modules.stale/` (1.6 GB) deletion still awaits the operator
  naming the target.
- CI runs remain hostage to co-tenant load and control-plane reconciliations
  (run 43e5fb9f: all 10 jobs cancelled by the 2026-10-21 outage
  reconciliation; re-triggered on fae38745).

## Release

Shipped as v0.9.6 via scripts/ship.sh (build → bundle-marker → deploy →
prod E2E verify) once the pipeline run completes green.
*(Annotation 2026-10-25: the cycle in fact shipped as **v0.9.6**, cut
2026-10-24; v0.9.7 followed on 2026-10-25 with the Dependabot closeout
and hero-map fix — see EXCELLENCE_PLAN_IX. The "v0.9.5" in the original
text was written before the bump and is stale.)*
