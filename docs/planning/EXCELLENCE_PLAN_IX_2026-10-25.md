# Excellence plan IX — 2026-10-25

Cycle IX of the excellence series (VIII closed 2026-10-24; see
[EXCELLENCE_PLAN_VIII_2026-10-24.md](EXCELLENCE_PLAN_VIII_2026-10-24.md)).
Scope: security-debt closeout (8 Dependabot alerts), the GeoIP
interaction race (root cause of 3 flaky prod E2E specs), documentation
currency, and the next ratchet decisions.

## Baseline at open (2026-10-25)

Measured this session, not carried:
- Dependabot: 8 open alerts → 0 (commit 83d29d10). mcp-server via
  `npm audit fix` (fast-uri 3.1.9, body-parser 2.4.0, ip-address 10.7.4);
  api via npm `overrides` (undici ^7.30.1, zod ^4.6.6 — both pinned
  upstream by wrangler/miniflare; esbuild ^0.25.11 under
  @cloudflare/next-on-pages).
- GitForge CI on 83d29d10: 10/10 jobs succeeded.
- eslint: 0 errors / 0 warnings. tsc: clean. ruff: clean.
- vitest: 1,726 pass / 5 skip (125 files). Build: green.
- v0.9.7 cut, tagged (verified both remotes), GitHub-released, deployed
  via ship.sh; prod `/api/health` reports 0.9.7.

## Work completed this cycle

1. **All 8 Dependabot alerts closed** (83d29d10). Overrides are the
   honest mechanism here: miniflare at *latest* still pins undici 7.28.0
   < the 7.30.1 fix — upstream has not caught up, so the override is
   debt with an expiry: when miniflare's own pin clears 7.30.1, drop the
   `undici` override.
2. **GeoIP interaction race fixed** (ad4bc6c1). The bootstrap checked
   `coordsTouched()` before its elevation fetch but applied results
   after it — a user interacting during the fetch had inputs
   overwritten and the panel flipped to the bootstrap location. This
   was both a real UX defect and the root cause of the three flaky
   landing specs in ship.sh runs (performs-elevation-lookup,
   address-search-zooms, sample-location-buttons).

## Phases

### Phase A — documentation currency (this cycle)
- A-1: CHANGELOG entry for v0.9.7 (release notes exist only on GitHub).
- A-2: plan VIII's Release section says "shipped as v0.9.5" — stale by
  two releases; annotate rather than rewrite history.
- A-3: HANDOFF.md top-note for cycle IX.

### Phase B — verification loops (this cycle)
- B-1: full vitest + tsc + eslint + ruff receipts (done at open; repeat
  before release).
- B-2: GitForge CI green on the release commit (10/10).
- B-3: ship.sh deploy + prod E2E; health reports the new version.
- B-4: three previously-flaky landing specs observed stable across the
  prod run (receipt: ship log).

### Phase C — next ratchets (queued, next cycle)

**Status update 2026-10-26 (resumed session):** C-2 and C-4 done; C-1
in progress (measured 99.78 stmts / 98.95 branches / 99.61 functions /
99.95 lines; 26 uncovered branches across ~38 files, 2 uncovered
functions). C-3 remains operator-blocked.

- C-2 **DONE 2026-10-26**: target-size recorded as permanent
  reported-not-enforced policy in docs/security/TRIAGE.md, with
  rationale and a revisit trigger (~20-control band threshold).
- C-1: TS coverage floors — branches 97.32→99, functions 95.09→99. The
  user goal is 99% everywhere; lines/Statements already ≥99. This is a
  test-authoring cycle, not a config change: audit uncovered-branch
  inventory first (vitest coverage report with
  `all: true`, per-file delta table), then close top offenders.
- C-2: 44px WCAG AAA target-size: 138 controls sit in the 24–44px band
  (reported-not-enforced by design-system decision). Either raise the
  axe rule to enforcement with a documented exemption list, or record
  the decision as permanent policy in docs/security/TRIAGE.md.
- C-3: `api/node_modules.stale/` (1.6 GB) still awaits operator
  confirmation before deletion.
- C-4 **DONE 2026-10-26**: `scripts/override_drift_check.sh` added to
  the cycle-open baseline — runs `npm audit` (must be 0) and verifies
  every resolved instance of each override target satisfies at least
  one declared override range; parent-conflict INVALID markers are
  surfaced as notes (expected for override-imposed pins). Receipt:
  PASS at cycle reopen (audit 0, all 8 targets applying).

### Phase D — release
- D-1: six-point version bump → v0.9.8, lockfiles, openapi:generate.
- D-2: annotated tag, explicit push both remotes, ls-remote verify.
- D-3: ship.sh, hash-URL health check, GitHub release.

## Residual risk

- The esbuild override under next-on-pages crosses a semver range the
  package declares (^0.15.3); the build compiles and all tests pass, but
  a next-on-pages upgrade must re-verify the override is still needed.
- CI runs remain hostage to co-tenant load (known, plan VIII).
