# Integration & release readiness handoff — 2026-10-11

Audit-only document: no code changes, no PR merges, no dependency bumps.
Every claim below carries its evidence anchor (commit SHA, run ID, file
path, or API response). Repo-recorded receipts are labeled as such and
were not re-measured by this audit. Scope boundary: this handoff covers
OpenZenith only — the Amortyx middleware stays a separate platform with
its own pipeline, and VIVERE stays experimental and fully separate; no
gate, receipt, or finding in this document transfers across those
boundaries.

Prepared by the Platform-Architecture execution worker. Audit method:
codebase-memory graph (`nas-Temp-repos-OpenZenith`, 11,439 nodes /
31,159 edges) for architecture shape, then live evidence from the
GitHub API (`gh`, authenticated as `aliasfoxkde`), the GitForge API at
`http://localhost:42782`, PyPI, and a clean NVMe clone at
`e4a87bf2e67caf71559a6544300dc46485c070fe` (= `origin/main`, = tag
`v0.9.4`).

---

## 1. Platform state at audit time

| Surface | Path | Version | Manifest anchor |
| --- | --- | --- | --- |
| Python SDK | `openzenith/`, `pyproject.toml` | 0.9.4 | `pyproject.toml` (hatch), six version sync points per plan VI F1 |
| Rust core | `core/` (`openzenith-core`) | 0.1.0 | `core/Cargo.toml:3`; lints deny `unsafe_code`, `unwrap_used`, `expect_used`, `panic` (`core/Cargo.toml:8-19`) |
| API + UI | `api/` (Next.js) | 0.9.4 | `api/package.json`; `next ^15.5.26`, `react ^19.3.0`, prod dep `cesium ^1.119.0` (`api/package.json:51`) |
| MCP server | `mcp-server/` | 0.9.4 | `mcp-server/package.json`; `zod ^3.24.0` manifest, lock holds 3.25.76, `@modelcontextprotocol/sdk ^1.32.1` |

Per `AGENTS.md`: the surfaces are versioned and validated independently
— an API/UI pass is never evidence for the Rust/Python core or vice
versa. Any gate claim in this handoff respects that rule.

Latest release: **v0.9.4** ("excellence cycle VI"), tagged from
`e4a87bf2`, GitHub release published 2026-10-10T14:30:28Z. Cycle VI
(`docs/planning/EXCELLENCE_PLAN_VI_2026-10-10.md`) phases A–E are
closed in its progress log with receipts; F (release) is the v0.9.4
commit itself.

## 2. CI / release gate map (what actually gates what)

**Gate of record — GitForge.** `.gitforge.yml` (repo root) is the
primary CI/CD definition: an 8-job linear chain on the single fedora
runner (`bdcc23ed` at 192.168.1.202), sshfs-bridged workspace, no
secrets mechanism, 64 KB per-step log cap. Its header documents the
operational constraints (single-runner fleet rule after the
2026-10-03 409 lease loop; sqlite `database is locked` zero-jobs
strand that self-heals; FIFO dispatch across co-tenant repos on a
5-slot runner). GitForge pipeline for this repo is live: `git
ls-remote http://localhost:42782/bigdata-ci/OpenZenith.git HEAD` →
`e4a87bf2` (same as origin). Latest recorded green run: `769febc6`
8/8 on fedora for `a406b25` (repo-recorded, plan VI progress log E).
Merge policy for mirror PRs is explicit in `.github/dependabot.yml`:
GitForge is the gate of record; a mirror PR is merged only after the
merged result is pushed to the `gitforge` remote and its run watched.

**Deploy path — `scripts/ship.sh`** (maintainer-run, not CI): pages:build
→ bundle-marker grep → pages:deploy (Cloudflare) → Playwright prod E2E
vs `https://openzenith.cyopsys.com`. "Commits are not deploys."

**GitHub mirror — non-authoritative, currently red.** Three workflows,
all headed "NON-AUTHORITATIVE … best-effort mirror check":

| Workflow | State at audit | Evidence |
| --- | --- | --- |
| `.github/workflows/ci.yml` | startup failure, every retained run (≥40 runs, 2026-10-08→10); zero jobs ever created; **no successful run in retained history** | run `38059856014` (main, 2026-10-10T14:30:16Z): "This run likely failed because of a workflow file issue"; `GET /actions/runs/…/jobs` empty; last-success query empty |
| `.github/workflows/codeql.yml` | same startup-failure signature | run `38059855179` (main, same timestamp) |
| `.github/workflows/publish-pypi.yml` | runs, but **fails at the Test step on every tag since v0.9.0** | runs on v0.9.0 `37357396864`, v0.9.1 `37460992927`, v0.9.2 `37771523365`, v0.9.3 `37997899602`, v0.9.4 `38059857172` — all `failure` |

The only automated per-PR check on GitHub is the **Cloudflare Pages**
deploy preview (external app, not GitHub Actions).

**PyPI — intentionally absent.** `openzenith` and `openzenith-sdk` both
return HTTP 404 on `pypi.org/pypi/<name>/json` (checked 2026-10-11).
This is by design: `publish-pypi.yml` is validation-only ("never
uploaded: a billing-blocked Actions account must not hold a trusted
publisher"), and publishing is maintainer-gated per
`docs/PUBLISHING.md` (plan VI explicitly rejected "publishing the SDK
to PyPI" from scope as a user decision).

**Branch protection — none.** `GET /branches/main/protection` → 404
"Branch not protected". Releases are cut from an unprotected main; the
effective release gate is the GitForge pipeline plus maintainer
discipline.

### Root-caused defect in the tag gate (highest-value finding)

The v0.9.4 validate job (`38059857172`, job `114235722933`) failed at
2026-10-10T14:30:51Z with:

```
ERROR: usage: python -m pytest [options] ...
python -m pytest: error: unrecognized arguments: --cov=openzenith
  --cov-report=term-missing --cov-fail-under=99   (exit code 4)
```

Cause chain, both halves verified in-tree:

1. `pyproject.toml:198` — `[tool.pytest.ini_options] addopts` injects
   `--cov=openzenith --cov-report=term-missing --cov-fail-under=99`
   into **every** pytest invocation.
2. The `dev` extra (`pyproject.toml`, `[project.optional-dependencies]`)
   installs `pytest`, `pytest-asyncio`, `ruff`, `interrogate`,
   `hatchling` — **`pytest-cov` is not among them**, and both mirror
   workflows install with `pip install -e .[all,dev]`.

So in any clean environment the suite never runs at all — pytest exits
4 before collecting. Local receipts ("pytest 1,650 @ 99%") pass because
the maintainer's venv carries `pytest-cov` independently of the extras.
This is environment drift, not a test regression. The same latent
defect sits in `.github/workflows/ci.yml` `python-test` (explicit
`--cov` flags, same install command): it will fail the same way the
moment the mirror workflow starts.

### Mirror startup failure (open, cause unproven)

GitHub reports "workflow file issue" for `ci.yml`/`codeql.yml` while
`publish-pypi.yml` runs in the same account/repo seconds later — so
Actions billing and runners are healthy. Local elimination, at HEAD
`e4a87bf2`: all three files parse clean under `yaml.safe_load` **and**
under a duplicate-key-rejecting loader (GitHub rejects duplicate keys
that PyYAML silently accepts). Action refs are all public
(`actions/checkout@v4`, `setup-python@v5`, `setup-node@v4`,
`cache@v4`, `dtolnay/rust-toolchain@1.80`, `github/codeql-action/*@v3`).
Startup-failure reason text is otherwise UI-only. Next diagnostic step:
`actionlint` on a checkout + bisect of the two files against
`publish-pypi.yml`'s constructs (`on:` triggers are the main structural
difference). Not the gate of record — but it leaves every PR without a
GitHub test signal and makes the five Actions-bump PRs unverifiable on
the mirror (see §4).

Runner-image note (annotation on run `38059857172`): `ubuntu-latest`
migrates to Ubuntu 26 beginning 2026-10-19, and Node-20-targeting
actions (checkout@v4, setup-python@v5) are being force-run on Node 24.
The Actions-bump PRs (#16/#20/#21/#23) are the follow-up for both.

## 3. Integration readiness summary

| Lane | Status | Gate |
| --- | --- | --- |
| Rust core | Green per repo receipts (clippy + two-pass core gate, carried from v0.9.3; trees byte-identical `git diff v0.9.3..HEAD` for `openzenith/` and `core/`) | GitForge + local |
| Python SDK | Tests green per receipts, but **tag validation broken by the pytest-cov defect** on every tag since v0.9.0 | GitForge; mirror tag-validate red |
| API/UI | Green per receipts (eslint 0w/0e, tsc clean, vitest 1,704+5 / 115 files, prod E2E 97/97, ship 26/26 — repo-recorded 2026-10-09/10) | GitForge + ship.sh |
| MCP server | GHSA-6qxp-vccf-f47h patched (SDK 1.32.1, plan VI A1) | GitForge |
| GitHub mirror CI | **Red — no signal** (startup failures) | — |
| Cloudflare previews | Working; failures on PRs #17/#18/#19 are the only PR-level signal that fires | Pages build |
| PyPI | Not published; maintainer-gated by design | manual (docs/PUBLISHING.md) |
| main protection | None (404) | — |

## 4. Dependabot PR triage (#10–#24; #9 noted where it pairs)

Policy reminder from `.github/dependabot.yml`: these are mirror-side
advisory signals — none may merge without a green GitForge run of the
merged result. This audit merges nothing.

### Safe candidates (low-risk; still require the GitForge gate run)

| PR | Bump | Files | Basis |
| --- | --- | --- | --- |
| #24 | jsdom 26.1.0 → 30.1.2 (`api`, dev) | `api/package*.json` | Test-env only; 4 majors but no prod surface; Pages preview **green** on the PR |
| #11 | @types/node 22.20.5 → 26.6.4 (`mcp-server`, dev) | `mcp-server/package*.json` | Types-only; gate = `npx tsc --noEmit`; align with the runtime node version actually targeted |
| #17 | 12-update minor-and-patch group (`api`) | `api/package*.json` | **Split first** (D4 below): everything except cesium rides as minor/patch (playwright 1.62→1.63, vitest 5.0.2→5.0.3, typescript-eslint 8.66→8.71, prettier, @types/react 19.3.0…) |

### Actions/toolchain bumps on mirror-only files (blocked on mirror CI health)

| PR | Bump | Files | Basis |
| --- | --- | --- | --- |
| #16 | actions/checkout 4 → 7 | all three workflows | Node 20→24 runtime generation; fixes the deprecation annotation; **unverifiable on the mirror until the startup failure is fixed** |
| #20 | actions/setup-python 5 → 7 | ci.yml, publish-pypi.yml | same |
| #21 | actions/cache 4 → 6 | ci.yml | same |
| #23 | actions/setup-node 4 → 7 | ci.yml | same |
| #15 | dtolnay/rust-toolchain 1.80 → 1.120 (grouped "minor-and-patch") | ci.yml | Not a real patch: ~40 Rust minors. `cargo clippy --all-targets -- -D warnings` will surface new lints. Gate: full core two-pass gate on fedora before any merge |

These five PRs edit files the mirror cannot currently execute, and
GitForge does not consume GitHub workflow files — so none of them can
be validated anywhere until Phase 0 fixes the mirror. Defer as one
batch.

### Migrations — not safe bumps; each needs a planned, gated pass

| PR | Bump | Why it is a migration |
| --- | --- | --- |
| #18 | next 15.5.27 → 16.4.0 (`api`) | Framework major. Already **user-gated**: plan VI G4/G11 ("next stays 15.5.27 (16.x = user-gated migration)") and `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md`. Its Pages preview is red. Do not touch outside that plan. |
| #19 | typescript 5.9.3 → 7.0.2 (`api`, dev) | Two majors (5.9 → 7.0, the native-compiler line). `tsc` gates on `noUncheckedIndexedAccess`; typescript-eslint 8.x parser compat with TS 7 must be proven. |
| #13 | typescript 5.9.3 → 7.0.2 (`mcp-server`, dev) | Same; land after #19's outcome is known. |
| #22 | eslint 9.39.5 → 10.12.0 (`api`, dev) | Lint-toolchain major; plugin compat (`@next/eslint-plugin-next`, typescript-eslint) unproven. |
| #12 | eslint 9.39.5 → 10.12.0 (`mcp-server`, dev) | Same — and **#9** (@eslint/js 9 → 10, open, outside the audited range) must land in the same pass or configs break. |
| #14 | zod 3.25.76 → 4.6.5 (`mcp-server`) | Schema-API migration. Unblocked at the dependency level — `@modelcontextprotocol/sdk` 1.32.1 peer-allows `zod: "^3.25 || ^4.0"` (lock entry) — but server code needs a zod-4 pass. |
| #10 | ndarray 0.16.1 → 0.17.2 (`core`) | Semver-incompatible 0.x bump for the numeric core (terrain grids). Compiler-caught API breaks expected under `deny(unwrap_used/panic)`; gate = full core suite + clippy + cargo audit on fedora. |

### Failing previews to explain before any merge

PRs #17, #18, #19 show a **failing Cloudflare Pages** check (only PRs
in the range with a red preview; all others green). #18/#19 are
expected (gated migrations). #17 matters because it presents as a safe
group: primary suspect is the hidden `cesium 1.119.0 → 1.146.0`
jump — a prod engine bumped 27 minor versions inside a
"minor-and-patch" group (Pages build log not retrievable from here; no
Cloudflare access).

## 5. Prioritized phases

Owners: this repo is solo-maintained (plan VI rejected CODEOWNERS for
exactly this reason), so "owner" is role, not person. **MNT** =
maintainer (`aliasfoxkde`), who owns all user-gated decisions and all
merges. **PA** = Platform-Architecture execution worker (CI/mirror/audit
lanes). Nothing merges without MNT's GitForge gate run.

### Phase 0 — readiness hygiene (target: ≤ half day; owner PA + MNT)

- **0.1 (fixes the release gate)** Add `pytest-cov>=4.1` to the `dev`
  extra in `pyproject.toml` (one line). Re-run the tag validation path
  on fedora per the execution policy, then re-cut or re-validate a tag
  to produce a green `publish-pypi.yml` run for the first time since
  v0.9.0. Evidence: job log line quoted in §2 must go from exit 4 to
  collected-tests output.
- **0.2** Diagnose the mirror startup failure: `actionlint` on
  `.github/workflows/{ci,codeql}.yml`; if clean, bisect constructs
  against `publish-pypi.yml` (the only one that starts) — the `on:`
  block is the structural delta. Record the root cause here or in the
  next plan doc.
- **0.3** Split PR #17: close/convert it so cesium 1.119→1.146 becomes
  its own gated PR; re-open the remaining 11 dev bumps as the group
  PR. Get the Pages log for the cesium-only PR before judging it.
- Acceptance: a green tag-validate run exists; mirror root cause is
  named with evidence; #17's replacement PR previews green.

### Phase 1 — safe batch (owner MNT; each item = one GitForge gate run)

- Land #24 and #11, then the slimmed #17 group. Order: #24 → #11 →
  #17-minus-cesium. Push each merged result to the `gitforge` remote
  and watch the run (the documented merge procedure).
- Acceptance: GitForge run green per merge; vitest/tsc receipts
  recorded; no preview regressions.

### Phase 2 — mirror CI restoration + Actions batch (owner PA, merge MNT)

- After 0.2's root cause is fixed: land #16, #20, #21, #23 as one
  batch (they are mutually independent version bumps), then #15.
- #15 needs the core two-pass gate on fedora first — expect new clippy
  lints between 1.80 and 1.120; fix-forward in the same PR or pin back
  and record.
- Acceptance: `ci.yml` + `codeql.yml` runs produce jobs (any color) on
  the next push to main; the Actions-bump batch shows green runs; Node
  20 deprecation annotation gone.

### Phase 3 — toolchain migrations, sequenced (owner MNT)

Order matters: lint chain before compiler. (1) #12 + #9 (eslint 10 +
@eslint/js 10, mcp-server) as a pair, then #22 (eslint 10, api) —
acceptance: eslint 0w/0e receipts on both surfaces. (2) #19 then #13
(TS 7) — acceptance: `tsc --noEmit` clean with `noUncheckedIndexedAccess`
and typescript-eslint parser proven on TS 7. (3) #14 (zod 4) —
acceptance: the 21 mcp-server contract tests green (plan VI A1's arm).

### Phase 4 — user-gated decisions (owner MNT; blockers are decisions, not work)

- **#18 next 16** — ride `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md`
  only; stay out of dependency-cleanup lanes. Blocker: user gate G11.
- **#10 ndarray 0.17** — review the ndarray changelog diff, then a
  dedicated core PR through the two-pass gate. Blocker: none technical;
  needs a scheduled core-gate window on fedora.
- **PyPI publish** — stays maintainer-gated (`docs/PUBLISHING.md`); the
  Phase 0 fix makes the validation meaningful but does not change the
  publish decision.
- **Branch protection on main** — currently nothing enforces even the
  Pages check. Decide: protect with the Pages check required, or
  record consciously that GitForge + ship.sh are the entire gate
  (the dependabot.yml header argues the latter). Blocker: user
  decision; this audit only records the 404.

## 6. Out of scope / separation boundaries

- **Amortyx middleware**: separate platform, separate pipeline, no
  shared gates or receipts with OpenZenith. Nothing in this handoff
  proposes coupling them.
- **VIVERE**: experimental, fully separate. Not referenced by any
  OpenZenith gate.
- No dependency PR was merged, no code changed, and no metric in this
  document was measured by this audit unless an evidence anchor says
  otherwise; repo-recorded receipts are cited as such.

## 7. Evidence index

- Clean clone: `/home/mkinney/worktrees/openzenith-readiness-handoff-20261011`
  at `e4a87bf2e67caf71559a6544300dc46485c070fe` (branch, see PR).
- GitHub runs: `38059856014` (ci.yml main), `38059855179` (codeql main),
  `38059857172`/job `114235722933` (v0.9.4 tag validate + pytest exit-4
  log), tag-validate series `37357396864`/`37460992927`/`37771523365`/
  `37997899602` (v0.9.0–v0.9.3).
- API responses (2026-10-11): branches/main/protection → 404;
  `pypi.org/pypi/openzenith` → 404; `pypi.org/pypi/openzenith-sdk` → 404;
  GitForge `ls-remote` → `e4a87bf2`.
- In-tree anchors: `pyproject.toml:198` (addopts) and `[project.optional-dependencies] dev`
  (no pytest-cov); `api/package.json:51` (cesium); `.github/dependabot.yml`
  (merge policy); `.gitforge.yml` header (runner topology, run `769febc6`
  reference); `docs/planning/EXCELLENCE_PLAN_VI_2026-10-10.md` (gap
  register G1–G11, phases A–F, progress log);
  `docs/planning/NEXTJS16_OPENNEXT_MIGRATION.md`; `docs/PUBLISHING.md`;
  `scripts/ship.sh`.
- codebase-memory: project `nas-Temp-repos-OpenZenith`, 11,439 nodes /
  31,159 edges (architecture shape cross-checked against manifests).
