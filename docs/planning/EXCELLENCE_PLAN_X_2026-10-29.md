# Excellence plan X — 2026-10-29

Cycle X of the excellence series (IX phase C closed 2026-10-26; see
[EXCELLENCE_PLAN_IX_2026-10-25.md](EXCELLENCE_PLAN_IX_2026-10-25.md)).
Opened with a fresh full baseline and a three-dimension audit (docs
currency, lint/quality strictness, a11y/E2E state).

## Baseline at open (2026-10-29, all measured this session)

- vitest: 1,745 pass / 0 fail (124 files); coverage floors 99/99/99/99,
  measured 99.80 / 99.07 / 99.61 / 99.97 (commit d42773eb run).
- eslint: 0 errors / 0 warnings (strictTypeChecked flat config).
  tsc: clean (strict + noUncheckedIndexedAccess).
- pytest: 1,669 pass / 1 skip, coverage 99.48% (floor 99). ruff: clean.
  mypy: clean, 40 source files.
- core Rust: 0 unwrap() in production paths (6, all in #[cfg(test)]).
  0 TODO/FIXME/HACK across api/src, openzenith/, core/src.
- aegis: gate green after triaging the 17 cycle-open findings
  (4c71f225) — zero real defects; log in TRIAGE.md.
- override drift check (new cycle-open gate): PASS (audit 0, all 8
  override targets applying).
- CI on d42773eb: aegis infra-failed (untriaged findings) → fixed by
  4c71f225; re-run in flight at plan write.
- CHANGELOG ↔ version sync: v0.9.8 across api, mcp-server, SDK. Clean.

## Audit findings (honest assessment)

The tree is in strong shape: strictest-in-class lint stacks already on
(ts-eslint strictTypeChecked, ruff near-strict + mypy near-strict,
zero smells). Remaining gaps, ordered by value:

1. **jsdoc-graduation complete; strictness floor holds** — no action.
2. **jscpd not automated** (docs-recorded 4.09%): duplication can
   regress silently between manual censuses. → Phase B.
3. **tsconfig**: `exactOptionalPropertyTypes` and
   `noPropertyAccessFromIndexSignature` not enabled (strict-mode
   frontier). → Phase B, effort-bounded.
4. **A11y gaps**: no dark-theme axe pass (theme-flash fix from cycle VI
   landed; the audit probe never did), no webkit project, keyboard
   checks are smoke-level (self-acknowledged), 44px target-size
   policy recorded (IX C-2, permanent). → Phase C.
5. **Docs currency**: CLAUDE.md globe-basemap citation now points at
   `GLOBE_BASEMAP_KEYS` (verifiable); mcp-server section under-documents
   its 15-tool surface; docs/CLAUDE.md canonical table omits plan VI
   and VIII files. → Phase A.
6. **CI/CD best practices vs sibling projects**: .gitforge.yml already
   documents its own platform constraints thoroughly (linear chain,
   64KB log caps, pre-pulled images). Optional: receipt artifacts.
   → Phase C (low priority).

## Phases

### Phase A — docs currency (this cycle)
- A-1: CLAUDE.md mcp-server section: document all 15 registered tools.
- A-2: docs/CLAUDE.md canonical table: add plan VI + VIII rows.
- A-3: CLAUDE.md basemap citation → `GLOBE_BASEMAP_KEYS` (basemaps.ts:169).
- A-4: HANDOFF top-note for cycle X.

### Phase B — ratchets
- B-1: jscpd gate: add `scripts/duplication_check.sh` with the 4.09%
  floor, wire into .gitforge.yml (post-lint) and cycle-open baseline.
- B-2: tsconfig: evaluate + enable `exactOptionalPropertyTypes` and
  `noPropertyAccessFromIndexSignature` with a bounded fix wave; if the
  fix wave exceeds ~40 errors, record as deliberate deferral with the
  error count as the re-entry metric.

### Phase C — a11y depth
- C-1: dark-theme axe pass: emulate `prefers-color-scheme: dark` in
  a11y.spec.ts for all 10 pages; fix any contrast failures found.
- C-2: webkit project in playwright.config.ts (observe-only first run;
  promote to gate if green across two consecutive runs).
- C-3: keyboard depth: focus-trap assertion for the one modal surface
  (identify overlay or widget shell — whichever ships modals) — bounded.

### Phase D — release
- D-1: version bump → v0.9.9, six-point sync, openapi:generate.
- D-2: tag + push both remotes, ship.sh deploy, prod verify (health
  version, hash-URL spot checks), GitHub release with notes.

## Execution log

- **Phase A+B (9722892b, 2026-10-29):** A-1..A-4 docs currency; B-1
  jscpd gate (`scripts/duplication_check.sh`, 4.09% floor) wired into
  .gitforge.yml; B-2 `noPropertyAccessFromIndexSignature` enabled with
  a bounded fix wave (`process.env["KEY"]` across api/src).
  `exactOptionalPropertyTypes` evaluated: error count exceeded the
  bound — deferred, re-entry metric recorded in the commit.
- **Phase C-1 (002113c6, 2026-10-29):** dark-theme axe pass on all 10
  pages; one real defect found and fixed — dark
  `--oz-text-secondary` #a3a3a3 → #b8b8b8 (6.9:1 → 8.77:1 on
  --oz-bg-code). Dark-pass timeout raised to 240s (map/studio scans
  exceed the 120s floor).
- **Phase C-2 (6ec50b92, 2026-10-30):** webkit added to
  playwright.config.ts as observe-only. Observe run on prod target:
  10 failed / 3 flaky / 94 passed — webkit cold-start stalls on
  render-heavy pages (map/studio/landing timeouts). Does NOT meet the
  two-consecutive-green promotion criterion; stays out of the merge
  gate. Re-evaluate after a future playwright/webkit bump.
- **Aegis baseline regen (6ec50b92, 2026-10-30):** the B-2 quote wave
  re-fingerprinted 26 triaged findings (content-hash change), failing
  the CI aegis job on d42773eb, 4c71f225 and 9722892b. Baseline
  regenerated per the deliberate-regen policy (10,828 raw → 2,114
  after profile filter). CI on 6ec50b92: aegis green, full run
  e20d902b.
- **C-3 (keyboard focus-trap)**: not attempted this cycle — bounded
  to the identify overlay/widget shell; deferred to cycle XI with the
  webkit re-evaluation.

## Residual risk
- exactOptionalPropertyTypes deferred past the B-2 bound; MapLibre/
  Cesium vendor typing is the suspected long tail.
- webkit stays observational: observe run failed its promotion
  criterion; re-evaluate after a playwright/webkit bump.
