# Security Policy

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** (Security tab →
"Report a vulnerability" on the GitHub mirror,
<https://github.com/aliasfoxkde/OpenZenith>) — that is the only channel that
keeps a report confidential until a fix ships; it is enabled on the
repository. If private reporting is unavailable, contact the maintainer
directly before any public disclosure. Do not open a public issue for an
unpatched vulnerability.

Include what is exposed, the affected path or file, and a minimal
reproduction. Expected handling: acknowledgment within **24 hours**, and a
fix or a published mitigation plan within **90 days** for confirmed issues.
Every disposition (fix, accept, or false positive) is recorded in
[`security/TRIAGE.md`](security/TRIAGE.md) — that log, not any single
commit, is the authoritative record.

Please do not open a pull request that "fixes" a finding without a report —
every fix must land with its triage rationale recorded.

## Scope

This repository is a free, keyless geospatial API plus a Python SDK, an MCP
server, and custom binary tile formats. It proxies public third-party feeds
(USGS, NOAA, OpenSky, AISstream, NASA GIBS, …) and serves elevation/terrain
data from HuggingFace datasets. Highest-value areas:

- `api/src/app/api/proxy/**` and `api/src/app/api/stac/**` — user-supplied
  upstream URLs and paths (SSRF / traversal class)
- `api/src/middleware.ts` — rate limiting and the CORS allowlist
- any sink that renders third-party feed content (a past true positive: the
  globe hover tooltip interpolated feed strings into `dangerouslySetInnerHTML`,
  now escaped — see security/TRIAGE.md, "Re-triage 2026-09-22")
- `core/` WASM entrypoints exposed to the browser (`/wasm-demo`) —
  untrusted-bytes decoding (OZT2) and grid math reachable from any page
- `openzenith/` (Python SDK) and `mcp-server/` (stdio MCP server) —
  local-trust surfaces: the OZT1/OZT2/`.merged` decoders parse
  attacker-chosen bytes whenever a tile dataset is untrusted, and the MCP
  server runs with the invoking user's credentials
- tile format readers/writers (`openzenith/tile_format.py`,
  `openzenith/tile_format_v2.py`, `openzenith/merged.py`,
  `core/src/ozt2.rs`) — bounds handling on malformed compressed input
- secrets handling in `scripts/*` upload and validation tooling

Out of scope: the deployed infrastructure itself (Cloudflare Pages/Workers
configuration), volumetric denial of service against the public endpoints,
and findings in third-party upstream feeds.

## Scanner gate policy (Aegis)

Static scanning is enforced by [`../scripts/aegis_scan.sh`](../scripts/aegis_scan.sh)
and every finding class is manually dispositioned in
[`security/TRIAGE.md`](security/TRIAGE.md).

- Scopes are explicit — `api/src`, `openzenith/`, `core/src`, `core/tests`,
  `scripts/` — so the 65GB local DEM dataset is never crawled.
- Dispositions are recorded as a **committed baseline**,
  [`security/aegis-baseline.json`](security/aegis-baseline.json).
  **The gate fails only on NEW findings**: a fingerprint
  (`pattern:file:line:content-hash`) that is not already in the baseline.
  Triaged findings never fail the gate.
- Fingerprints are **repo-relative and checkout-path independent**
  (since 2026-10-06): the CI runner's `/workspace` mount and a developer
  checkout produce identical fingerprints. Editing a flagged line still
  re-flags it — that friction is deliberate; re-triage before regenerating.
- `scripts/aegis_scan.sh update` regenerates the baseline. Run it **only
  after** reviewing the full finding list; a baseline update is a deliberate
  commit, never a way to make the gate pass. See TRIAGE.md's "Gate policy"
  section for the checklist.
- [`security/aegis-profile.json`](security/aegis-profile.json)
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

Dependency audits (`npm audit --omit=dev`, `pip_audit`, `cargo audit`) are
re-run per dependency-touching change and their receipts recorded in
TRIAGE.md; accepted dev-only findings live there with justification
(see the "Dependency re-triage" entries).

## Supported versions

Only the following receive security fixes:

| Branch / ref | Status |
|---|---|
| `main` | Supported — all fixes land here first |
| latest tagged release (`v0.9.4` at this writing) | Supported — critical fixes are cherry-picked into a patch tag |

Older tags are not supported. There are no long-lived release branches.
