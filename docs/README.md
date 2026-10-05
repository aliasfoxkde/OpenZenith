# OpenZenith docs index

Read in this order. Every number in these docs is derived from the code and
config (registry, route count, CI gates) — if a doc and the code disagree,
the code wins and the doc is wrong.

Last swept: 2026-10-04

## Reading order

1. [`../CLAUDE.md`](../CLAUDE.md) — orientation: commands, architecture map, data sources, and the gotchas that bite (storage, CLI, ports).
2. [`../README.md`](../README.md) — the 5-minute product overview: what the SDK and API do, with the measured layer/basemap/route counts.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the pieces fit: storage truth (HuggingFace origin + edge Cache API, no R2), elevation priority chains, CI/CD.
4. [`DATASET_MANIFEST.md`](DATASET_MANIFEST.md) — every elevation dataset: source, format, tile counts, validation status.
5. [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to add elevation data to the dataset.
6. [`security/TRIAGE.md`](security/TRIAGE.md) — Aegis scan policy: what gets fixed vs baselined, and the findings register.
7. [`planning/EXCELLENCE_PLAN_2026-10-02.md`](planning/EXCELLENCE_PLAN_2026-10-02.md) — the current work queue (gaps F-1…F-18, phased).
8. [`planning/MASTER_PLAN_2026-09-22.md`](planning/MASTER_PLAN_2026-09-22.md) — the long-running plan and its dated progress log (what landed, when, with evidence).
9. [`planning/PERFORMANCE_PLAN_2026-10-02.md`](planning/PERFORMANCE_PLAN_2026-10-02.md) — performance state: P0/P1 executed, P2 open, each item evidence-anchored.
10. [`planning/RELIABILITY_GAPS_2026-10-01.md`](planning/RELIABILITY_GAPS_2026-10-01.md) — process gaps and the deploy-then-verify-prod definition of done.
11. [`planning/NEXTJS16_OPENNEXT_MIGRATION.md`](planning/NEXTJS16_OPENNEXT_MIGRATION.md) — pending stack decision: Next.js 16 + OpenNext (scoping only, nothing migrated).
12. [`planning/IMPROVEMENT_PLAN_2026-09-21.md`](planning/IMPROVEMENT_PLAN_2026-09-21.md) — the previous completed cycle, kept as context for why things look the way they do.
13. [`planning/HANDOFF.md`](planning/HANDOFF.md) — what the last session left unfinished.
14. [`OPZENITH_DATA_REPO.md`](OPZENITH_DATA_REPO.md) — spec/proposal for a community tile repository (not built — see its header).

## Archive

[`archive/`](archive/) is history: completed plans, past audits, superseded
roadmaps. Every file there carries a blockquote header saying why it was
archived and where current truth lives. **Nothing in `archive/` is
authoritative** — do not cite it as a source for current counts, paths, or
behavior.
