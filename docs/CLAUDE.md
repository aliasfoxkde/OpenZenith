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
| [`OPZENITH_DATA_REPO.md`](OPZENITH_DATA_REPO.md) | The companion `openzenith-data` community tile repository |
| [`security/TRIAGE.md`](security/TRIAGE.md) | Aegis security-findings triage and baseline policy |
| [`planning/MASTER_PLAN_2026-09-22.md`](planning/MASTER_PLAN_2026-09-22.md) | Current phased improvement plan and progress log |
| [`planning/IMPROVEMENT_PLAN_2026-09-21.md`](planning/IMPROVEMENT_PLAN_2026-09-21.md) | Prior improvement cycle (Phases 1–7, complete) with progress log |
| [`planning/HANDOFF.md`](planning/HANDOFF.md) | Session handoff notes for the next agent |

## Archive

Everything under [`archive/`](archive/) is historical: completed plans, past
audits, and superseded roadmaps, each with a header stating why it was
archived. Notable: `archive/CHANGELOG.md` (history through v0.6.4 — current
versions: [`../.github/CHANGELOG.md`](../.github/CHANGELOG.md)).
