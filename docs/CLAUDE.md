# Project Documentation

Canonical agent guidance for this project lives at [`../CLAUDE.md`](../CLAUDE.md)
(repo root): architecture, API surface, Python SDK, and development commands.

## Precedence rule

When documents conflict: **repo-root `CLAUDE.md`** > **canonical docs below** >
**`docs/archive/`** (never authoritative — historical record only).

## Canonical documents

| Document | Purpose |
|----------|---------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System overview, data flow, backend priority chain |
| [`DATASET_MANIFEST.md`](DATASET_MANIFEST.md) | Data sources, storage locations, tile formats |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributing elevation data to the v2 dataset |
| [`OPZENITH_DATA_REPO.md`](OPZENITH_DATA_REPO.md) | The companion `openzenith-data` community tile repository (spec/proposal, not built) |
| [`security/TRIAGE.md`](security/TRIAGE.md) | Aegis security-findings triage and baseline policy |
| [`planning/MASTER_PLAN_2026-09-22.md`](planning/MASTER_PLAN_2026-09-22.md) | Phased improvement plan and progress log (superseded as the active queue, kept for its data-modeling reference) |
| [`planning/EXCELLENCE_PLAN_V_2026-10-08.md`](planning/EXCELLENCE_PLAN_V_2026-10-08.md) | **Current** phased excellence plan (cycle V: prod CVEs, PyPI distribution truth, `noUncheckedIndexedAccess`, duplication kernels) |
| [`planning/EXCELLENCE_PLAN_IV_2026-10-07.md`](planning/EXCELLENCE_PLAN_IV_2026-10-07.md) | Prior excellence plan (cycle IV: strictness gates, terrain-route kernel, docs coverage) — executed, shipped as v0.9.2 |
| [`planning/EXCELLENCE_PLAN_2026-10-07.md`](planning/EXCELLENCE_PLAN_2026-10-07.md) | Prior excellence plan (cycles I–III, waves 1–8) — executed and shipped; closeout log inside |
| [`planning/EXCELLENCE_PLAN_2026-10-06.md`](planning/EXCELLENCE_PLAN_2026-10-06.md) | Prior excellence plan (gaps G-1…G-5) — executed |
| [`planning/EXCELLENCE_PLAN_2026-10-02.md`](planning/EXCELLENCE_PLAN_2026-10-02.md) | Prior excellence plan (gaps F-1…F-18) — executed through Phase 8; superseded register kept for lineage |
| [`planning/PERFORMANCE_PLAN_2026-10-02.md`](planning/PERFORMANCE_PLAN_2026-10-02.md) | Performance deep-dive: P0/P1 executed 2026-10-02, P2 open, evidence-anchored |
| [`planning/RELIABILITY_GAPS_2026-10-01.md`](planning/RELIABILITY_GAPS_2026-10-01.md) | Reliability/process gap register (deploy+verify policy, open items) |
| [`planning/NEXTJS16_OPENNEXT_MIGRATION.md`](planning/NEXTJS16_OPENNEXT_MIGRATION.md) | Next.js 16 + OpenNext migration scoping — decision required, nothing migrated |
| [`planning/IMPROVEMENT_PLAN_2026-09-21.md`](planning/IMPROVEMENT_PLAN_2026-09-21.md) | Prior improvement cycle (Phases 1–7, complete) with progress log |
| [`planning/HANDOFF.md`](planning/HANDOFF.md) | Session handoff notes for the next agent |

## Archive

Everything under [`archive/`](archive/) is historical: completed plans, past
audits, and superseded roadmaps, each with a header stating why it was
archived. Notable: `archive/CHANGELOG.md` (history through v0.6.4 — current
versions: [`../.github/CHANGELOG.md`](../.github/CHANGELOG.md)).

`docs/globe/README.md` was deleted (2026-10-03) — its content was stale
against the current globe implementation; globe architecture lives in
`api/src/app/globe/` and the planning docs.
