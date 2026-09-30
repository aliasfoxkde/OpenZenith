# Next.js 16 + OpenNext Cloudflare Migration — Scoping & Decision Document

**Date:** 2026-09-30 · **Status:** DECISION REQUIRED (no migration performed)
**Scope of this doc:** recommend whether/when to move OpenZenith's frontend
stack from Next.js 15 + `@cloudflare/next-on-pages` (Cloudflare Pages) to
Next.js 16 + `@opennextjs/cloudflare` (Cloudflare Workers), and how.

---

## TL;DR / Recommendation

**Do the migration, in two staged phases (≈1 focused day total), not one
big-bang change:**

1. **Phase 1 — adapter swap on Next 15** (`next-on-pages` →
   `@opennextjs/cloudflare`, Pages → Workers). This is *forced, not optional*:
   next-on-pages is deprecated and archived (see below), so the current
   deployment path is dead software.
2. **Phase 2 — Next.js 15 → 16 upgrade** on the new adapter. The repo's
   breaking-change surface for 16 is unusually small (audited below): one
   webpack alias and one removed config block.

Staging isolates deployment-platform risk from framework-upgrade risk: each
phase ships, verifies (vitest + Playwright E2E + prod smoke), and is
individually rollbackable.

**What this is NOT:** a rewrite. No page, route handler, or data layer changes
are required by either phase.

---

## Why change is forced (current stack facts, 2026-09-30)

| Fact | Evidence |
|---|---|
| `@cloudflare/next-on-pages` is **deprecated** | GitHub repo **archived 2025-09-29, read-only**; README: "The next-on-pages package is deprecated." Cloudflare's recommended successor is `@opennextjs/cloudflare`. |
| Installed adapter **does not support the installed Next** | `node_modules/@cloudflare/next-on-pages@1.13.16` peer range: `next >=14.3.0 && <=15.5.2`. Installed Next is **15.5.26**. Install only succeeds because `.npmrc` sets `legacy-peer-deps=true` — the deploy tool is running outside its supported matrix today. |
| No fix exists upstream | Archived repo = no release will ever widen the peer cap or add Next 16 support. Every future `npm update` widens the silent peer violation. |
| Next.js 16 is the current stable line | Latest 16.3.6; Next 15 only receives the remainder of its maintenance window. `eslint-config-next` is already at ^16.2.1 in this repo. |
| OpenNext Cloudflare is healthy | Supports **all minor/patch of Next 16** plus latest minors of 14/15; supports App Router, route handlers, middleware, ISR, Turbopack. Deploys to **Workers** (not Pages) with the Node.js runtime. |

Repo prerequisites already in place: `wrangler.toml` sets
`compatibility_flags = ["nodejs_compat"]` (required by the Workers adapter),
wrangler ^4.137.0 supports Workers Assets, and `src/lib/storage/edge-cache.ts`
uses the Cache API (`caches`), which works identically in Workers — the
tile cache-aside design survives the platform move unchanged.

---

## Next.js 16 breaking-change audit against this repo

Audited against the official v16 upgrade guide (2026-09). Result: **two
required changes, one deferred rename, zero page/route code changes.**

| Next 16 change | This repo | Action |
|---|---|---|
| **Turbopack is the default bundler; `next build` FAILS if a custom `webpack` config is present** | `next.config.ts` has a webpack alias: browser builds map `zstd-wasm` → `src/lib/polyfills/no-zstd.ts` | Migrate to `turbopack: { resolveAlias: { "zstd-wasm": "./src/lib/polyfills/no-zstd.ts" } }` (scoped to browser conditions). Delete the webpack block. **Verify** the wasm-demo and any client import of zstd still resolves. |
| **`eslint` key removed from next.config; `next build` no longer lints** | `next.config.ts` has `eslint: { ignoreDuringBuilds: false }` | Delete the block. Lint already runs standalone (`npm run lint` → `eslint src/`) and in gates. |
| Async Request APIs fully removed (sync `params`/`searchParams`/`cookies()`/`headers()`) | Grep across `src/app` page files found **zero** Next page-prop `params`/`searchParams` usage (hits were local `URLSearchParams` and unrelated component props) | None |
| `middleware.ts` → `proxy.ts` rename; **proxy is Node-only, edge runtime not supported in proxy** (edge middleware stays supported) | `src/middleware.ts` is edge middleware (per-isolate rate limiting + CORS) | **Defer.** Keep `middleware.ts` (explicitly supported for edge users). Optional later cleanup; not a 16 blocker. |
| Node 20.9+ / TS 5.1+ | Local Node 24.16, TS 5.8.3; Pages build image is Node 20+ | None |
| `next/image` changes (qualities, TTL, localPatterns) | No `next/image` usage anywhere; `images.unoptimized: true` | None |
| AMP, runtime config (`next/config`), `unstable_rootParams`, parallel-route `default.js`, PPR flag removals | None present (grepped) | None |
| `next lint` removed | Never used — scripts call ESLint directly | None |
| ESLint flat config default | `eslint.config.mjs` is already flat | None |
| `revalidateTag` two-arg form | Not used | None |

**80 API routes with `export const runtime = "edge"`:** Next 16 still supports
the edge runtime in route handlers. Under OpenNext/Workers the app-wide
recommendation is the Node runtime; the migration should trial-run with the
exports intact and only strip them if the adapter flags them. This doubles as
future cleanup (dropping the exports makes handlers Node-runtime, which is
what OpenNext prefers), but is not a blocker.

---

## Migration plan

### Phase 1 — `@opennextjs/cloudflare` on Next 15 (platform swap only)

1. Add `@opennextjs/cloudflare` devDependency; add `open-next.config.ts`.
2. Add a `wrangler.jsonc` (Workers, not Pages) with
   `assets = { directory: ".open-next/assets", binding: "ASSETS" }`, the
   existing `[vars]` (STORAGE_BACKEND/HF_REPO/USE_MERGED), `nodejs_compat`,
   and the five secrets re-set via `wrangler secret put`.
3. Scripts: `deploy` → `npx @opennextjs/cloudflare && wrangler deploy`;
   local E2E target becomes `wrangler dev` (update the `:9006` workflow in
   memory + e2e README; keep `--workers=2` Playwright recipe).
4. Build & deploy to a **workers.dev preview** first; run the smoke checklist
   (below), then the full Playwright suite against the preview.
5. Cut over the `openzenith.cyopsys.com` custom domain to the Worker; keep the
   Pages project live and untouched until verified — **rollback = point the
   domain back**.

Verification checklist (both phases): `/`, `/map`, `/globe`, `/explore`,
`/studio`, `/wasm-demo`, `/api/elevation?lat=&lon=`, `/api/dem-tile/10/x/y`,
`/api/tiles/WMTSCapabilities.xml` (GDAL client check), tile edge-cache hit,
vessels/opensky env-gated routes, vitest full suite, Playwright E2E.

### Phase 2 — Next 16 upgrade (framework swap)

1. `npm install next@16 react@latest react-dom@latest` (+ `@types/*`),
   run `npx @next/codemod@canary upgrade latest` for the mechanical parts.
2. Apply the two config edits from the audit table (turbopack.resolveAlias,
   drop `eslint` block).
3. Full gates: tsc → eslint (warning count must not increase; it should drop —
   stricter inference) → aegis (multiset diff vs baseline; any new flags
   triaged per `docs/security/TRIAGE.md` recipe) → vitest
   (`--maxWorkers=2`, expect 1,419 passed / 5 skipped) → Playwright E2E.
4. Deploy Phase-2 build through the Phase-1 pipeline (preview → verify →
   promote).

### Effort

| Phase | Estimate |
|---|---|
| Phase 1 (adapter swap + deploy pipeline + verification) | ~½ day |
| Phase 2 (Next 16 + config edits + gate cycles) | ~½ day |
| **Total** | **~1 focused day**, dominated by E2E/smoke verification |

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Worker size limit** — 3 MiB free / 10 MiB paid (compressed) for one Worker bundling all 80 API routes + server bundles. Comparable to the Pages `_worker.js` ceiling but unproven for this app. | `wrangler deploy --dry-run` prints compressed size before any DNS change. If over budget: move static assets to the assets binding (already the model), audit server bundle for accidental client-code inclusion. |
| zstd-wasm browser alias behaves differently under Turbopack `resolveAlias` | Targeted wasm-demo smoke + the vitest polyfill tests; fall back to `next build --webpack` (still supported in 16) while diagnosing. |
| Edge-runtime route semantics differ under the Workers adapter (global scope, `waitUntil`, Cache API scoping) | Cache API verified equivalent; `waitUntil` usage is minimal (grep during Phase 1); preview-domain soak before cutover. |
| Local E2E workflow changes (`wrangler pages dev :9006` → `wrangler dev`) | Update scripts + memory in Phase 1, not discovered ad hoc later. |
| Two platform changes in flight (this) vs GitForge CI still unverified (needs interactive `gitforge auth --login`) | Phases are independently rollbackable; deploys remain manual `npm run pages:deploy` today, so CI status does not gate either phase. |
| npm audit residue (esbuild ≤0.24.2, undici@5.29 via next-on-pages' miniflare 3 — 5 dev-only findings) | **Goes away** with Phase 1: the findings are transitive deps of the deprecated adapter. Small reliability win. |

## Rollback

- Phase 1: Pages project stays deployed and domain-routable until cutover is
  verified; reversing the custom domain restores the previous stack in minutes.
- Phase 2: `git revert` the upgrade commit and redeploy through the Phase-1
  pipeline (which still supports Next 15 latest-minor).
