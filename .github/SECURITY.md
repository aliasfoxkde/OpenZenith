# Security Policy

## Reporting a vulnerability

Open an issue on this repository
(<https://github.com/aliasfoxkde/OpenZenith/issues>) and label it `security`.
Include what is exposed, the affected path or file, and a minimal
reproduction. There is no private disclosure address or bounty program; the
triage record in [`docs/security/TRIAGE.md`](../docs/security/TRIAGE.md) is
the authoritative log of how findings are dispositioned.

Please do not open a separate pull request that "fixes" a finding without an
issue — every fix must land with its triage rationale recorded.

## Scope

This repository is a free, keyless geospatial API. It proxies public
third-party feeds (USGS, NOAA, OpenSky, AISstream, NASA GIBS, …) and serves
elevation/terrain data from HuggingFace datasets. Highest-value areas:

- `api/src/app/api/proxy/**` and `api/src/app/api/stac/**` — user-supplied
  upstream URLs and paths (SSRF / traversal class)
- `api/src/middleware.ts` — rate limiting and the CORS allowlist
- any sink that renders third-party feed content (a past true positive: the
  globe hover tooltip interpolated feed strings into `dangerouslySetInnerHTML`,
  now escaped — see TRIAGE.md, "Re-triage 2026-09-22")
- `core/` WASM entrypoints exposed to the browser (`/wasm-demo`)
- secrets handling in `scripts/*` upload and validation tooling

Out of scope: the deployed infrastructure itself (Cloudflare Pages/Workers
configuration), volumetric denial of service against the public endpoints,
and findings in third-party upstream feeds.

## Scanner gate policy (Aegis)

Static scanning is enforced by [`scripts/aegis_scan.sh`](../scripts/aegis_scan.sh)
and every finding class is manually dispositioned in
[`docs/security/TRIAGE.md`](../docs/security/TRIAGE.md).

- Scopes are explicit — `api/src`, `openzenith/`, `core/src`, `core/tests`,
  `scripts/` — so the 65GB local DEM dataset is never crawled.
- Dispositions are recorded as a **committed baseline**,
  [`docs/security/aegis-baseline.json`](../docs/security/aegis-baseline.json).
  **The gate fails only on NEW findings**: a fingerprint
  (`pattern:file:line:content-hash`) that is not already in the baseline.
  Triaged findings never fail the gate.
- Fingerprints embed absolute paths, so they are machine-specific: moving or
  editing a flagged line re-flags it. That friction is deliberate — re-triage
  before regenerating.
- `scripts/aegis_scan.sh update` regenerates the baseline. Run it **only
  after** reviewing the full finding list; a baseline update is a deliberate
  commit, never a way to make the gate pass. See TRIAGE.md's "Gate policy"
  section for the checklist.
- [`docs/security/aegis-profile.json`](../docs/security/aegis-profile.json)
  is a repo-level denylist (`disabled_patterns`) of reviewed
  false-positive classes (coordinate-grid digit sequences, Terraform/Azure
  grammar with no Terraform in the repo, accessibility checks superseded by
  the axe-core gate, …). The gate drops those patterns **after** the scan;
  the `aegis` binary itself always runs at full strength, so other projects
  keep their own policy. Sharpness is verified, not assumed: a probe file
  containing the AWS documentation example key is still caught.

Secret-bearing classes (`secrets-*`, `git-credential-leak`,
`hardcoded-credential`, `env-file-in-git`, `env-credential-assignment`) are
kept deliberately sharp and are never on the denylist. Never commit
credentials; the deploy path uses wrangler's stored auth or CI-injected
secrets.

## Supported versions

Only the following receive security fixes:

| Branch / ref | Status |
|---|---|
| `main` | Supported — all fixes land here first |
| `v0.8.4` (latest tagged release) | Supported — critical fixes are cherry-picked into a patch tag |

Older tags are not supported. There are no long-lived release branches.
