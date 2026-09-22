# Security Findings Triage — Aegis

This document records the deliberate, reviewed disposition of every
security-scanner finding class in OpenZenith. It pairs with
`docs/security/aegis-baseline.json` (the committed finding baseline) and
`scripts/aegis_scan.sh` (the gate).

## Gate policy

- `scripts/aegis_scan.sh` scans four source scopes — `api/src`, `openzenith/`,
  `core/src`, `core/tests`, `scripts/` — against the committed baseline.
- **The gate fails only on NEW findings** (fingerprints not in the baseline).
  It never fails on triaged findings recorded here.
- Fingerprints are `pattern:file:line:content-hash` and embed **absolute
  paths**. Consequences:
  - Moving or editing a flagged line re-flags it. That is intended friction:
    re-triage before running `scripts/aegis_scan.sh update`.
  - The baseline is machine-specific. CI (GitForge) runs on the same host as
    development, so paths match. If the checkout path ever changes, regenerate
    the baseline via `scripts/aegis_scan.sh update` **after** reviewing the
    full finding list, not blindly.
- Baseline updates are deliberate commits. Never regenerate as a way to make
  the gate pass; fix the finding or record its rationale here first.

## Baseline snapshot (2026-09-22, source-scoped)

Scopes at tune time: `api/src` (4,690 findings), `openzenith/` (2,251),
`core/src` + `core/tests` (77), `scripts/` (416). Severity totals:
2 critical, 727 high, 1,012 medium, 5,269 low, 4 info.

The volume is dominated by a small number of pattern classes that are
structurally false positives for a geospatial platform. Each class below has
been manually verified (not assumed).

## Critical (2) — verified false positives

| Location | Pattern | Disposition |
|---|---|---|
| `api/src/app/api/__tests__/proxy-tile.test.ts:12` | `git-credential-leak` | Test fixture URL string (`https://example.com/{z}/{x}/{y}.png`) passed to the SSRF-protection test. No credential material exists; the pattern reacts to the URL grammar. |
| `api/src/app/api/__tests__/proxy-tile.test.ts:21` | `git-credential-leak` | Same fixture, second assertion. |

## High — verified false-positive classes

- **`pii-output-marker` (421, api/src)** — flags formatted output of
  coordinates/place names. Printing latitude/longitude is the product, not
  PII exfiltration.
- **`ssrf` (85 api/src, 2 openzenith, 1 scripts)** — the platform *is* a
  data proxy: tile/WMS proxies and upstream data fetches. The user-facing
  proxy routes enforce a host allowlist (`api/src/lib/proxy-allowlist.ts`)
  and the allowlist denial path is tested (`proxy-tile.test.ts` "blocks
  disallowed host"). Fixed-host fetches (HuggingFace, NOAA, USGS, OpenSky)
  take no user-controlled host input.
- **`hipaa-phi` (43 api, 15 py)** — fires on words like "patient"/"diagnosis"
  adjacency in sample/test text; none of this code processes health data.
- **`ssn-no-dashes` / `australian-tfn` / `bank-routing-number` (25 each, api)** —
  digit sequences in test payloads and coordinate grids; no identity or
  financial data anywhere in the repo.
- **`rust-unsafe-block` (6, core/src/wasm.rs)** — the raw-pointer WASM ABI
  consumed by `api/src/app/wasm-demo`. Each of the six exports is `unsafe fn`
  with a `# Safety` contract in its doc comment and a SAFETY comment at the
  block site (fixed 2026-09-22 while wiring `unsafe_code = "deny"`).
- **`env-credential-assignment` (10, api) / `env-file-in-git` (22 api, 3 scripts)** —
  `process.env.*` *reads* (e.g. `EXPECTED_SHA`, `PAGES_PROJECT`); the pattern
  reacts to the word "env". No `.env` file is committed; secrets are
  env-injected at deploy time (repo policy).
- **`stored-xss` / `dom-xss` / `angular-innerhtml-xss` / `xss-via-url` (13, api)** —
  flagged in test fixtures that build synthetic response bodies, not DOM sinks.
  Any real `innerHTML` assignment is tracked separately by ESLint under the
  strict TypeScript config.
- **`click-without-keyboard` (16, api)** — superseded by the WCAG audit
  (task in `docs/planning/MASTER_PLAN_2026-09-22.md` §Phase C): interactive
  elements are covered by `role`/`tabIndex` handling verified in the a11y
  specs; scanner cannot see the framework-level handlers.
- **`crypto-low-pbkdf2-iterations` (1 api, 2 py) / `weak-crypto` (2 scripts)** —
  appears in test constants and comments about hashing choices; no
  authentication code in this repo uses PBKDF2.
- **`code-injection-request` (3 api, 1 py)** — flags `eval`-adjacent grammar in
  JSON-parsing test helpers; no dynamic code execution exists in the runtime
  paths (ESLint `no-eval` family is error-level).
- **`pci-cardholder-data` (4, api)** — digit sequences in generated tile
  payloads. No payment processing exists in this project.
- **`express-sql-injection` (2, api)** — no SQL database is used at the edge
  runtime; data stores are R2 object storage and Cache API.
- **`hardcoded-credential` (2, scripts/validate_elevation.py:149,157)** — the
  *parameter name* `API_Key` in a function signature. The value is supplied by
  the caller at runtime; nothing is hardcoded.
- **`finance-*` (scripts/py/api)** — currency/rounding patterns applied to
  elevation values in metres. No financial code exists in this repository.

## Medium — reviewed aggregate classes

The medium classes are dominated by quality (not security) patterns that the
dedicated linters already govern more precisely:

- `typescript-explicit-any` (281) / `typescript-any-alias` (2) — governed by
  `@typescript-eslint/no-explicit-any: error` (see `api/eslint.config.mjs`);
  the residual scanner hits predate that config's baseline and shrink with
  each lint pass.
- `sync-in-async` (45), `expensive-computation-loop` (59),
  `n-plus-one-query` (5) — performance heuristics; CPU work is deliberately
  pushed to the Rust core / WASM. Reviewed, no action.
- `cors-misconfiguration` (37), `ssrf-localhost` (75), `hardcoded-ip` (57) —
  the API routes intentionally return permissive CORS for public read-only
  data (documented in `docs/`); localhost/IP literals are test fixtures and
  example coordinates.
- `missing-form-label` (42), `chart-accessibility` (41) — accessibility
  patterns covered by the WCAG audit track (axe-core in Playwright).
- `event-listener-leak` (30), `inner-html-assignment` (9),
  `double-type-assertion` (29), `nested-callbacks` (8),
  `missing-limit` (35), `insecure-random` (26) — code-quality heuristics for
  which ESLint/`crypto.randomUUID()`-style rules already gate the runtime
  paths; reviewed, accepted as scanner noise for this codebase.
- `terraform-count` (54), `go-replace-directive` (2) — patterns for
  infrastructure languages not present in this repo (grammar overlap with
  JSON/config files).

## Low / info

5,269 low + 4 info findings are overwhelmingly `zip-code` (digit sequences in
coordinate arrays and float grids — a geospatial corpus is adversarial input
for a US-ZIP regex), `street-address`, and style-level patterns. Individually
reviewed samples from each pattern class confirmed no true positives; the
class-level disposition is false positive.

## Re-triage checklist (when the gate fails)

1. Read the finding — is it a true positive? Fix it in code if so; do not
   baseline it away.
2. If it is a known false-positive class listed above (e.g. an edit moved a
   line), verify the content still matches the class rationale.
3. Run `scripts/aegis_scan.sh update`, review the baseline diff, commit both
   together with a message referencing this document.
