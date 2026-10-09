# api/ — OpenZenith web app + REST API

Next.js 15 App Router application: the public REST API, the 2D map
(MapLibre), the 3D globe (CesiumJS), the studio/explore/demo surfaces, and
the landing page. Deployed to Cloudflare Pages as Edge Workers — every API
route sets `export const runtime = "edge"`.

Root docs: [`../README.md`](../README.md), [`../CLAUDE.md`](../CLAUDE.md).

## Layout

```
api/
├── src/
│   ├── app/                  # App Router pages + API routes
│   │   ├── api/              # REST API: 80 route.ts handlers under api/src/app/api
│   │   ├── map/              # 2D MapLibre map (lib/layers/ = per-layer loaders)
│   │   ├── globe/            # 3D CesiumJS globe (lib/layers/ = per-layer loaders)
│   │   ├── studio/ explore/ demo/ wasm-demo/ landing/
│   │   └── __tests__/        # API-route test suites (vitest)
│   ├── components/           # Shared React components
│   ├── lib/                  # Shared libraries: tile, elevation, cache, storage,
│   │                         #   layers/registry.ts (layer registry), basemaps.ts
│   ├── middleware.ts         # Edge middleware: rate limit + CORS
│   └── test-setup.ts         # vitest setup file
├── e2e/                      # Playwright specs
├── scripts/                  # gen-openapi.mjs, perf-budget.mjs, measure-perf.mjs
├── public/                   # Static assets + public/pkg (WASM bundle, service worker)
├── vitest.config.ts          # Node env, 15s timeouts, coverage floors
├── eslint.config.mjs         # typescript-eslint strictTypeChecked
├── wrangler.toml             # Pages project config (no R2 bindings)
└── perf-budget-baseline.json # Bundle-size budget baseline
```

## Commands

Every command below is a script in [`package.json`](package.json) unless
marked otherwise.

### Develop

| Command             | What it does                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | `next dev` — local dev server on http://localhost:3000 (Next.js default; no port flag is set anywhere in this workspace)                                                                                                                             |
| `npm run build`     | `next build` — Node/Next production build. Not what ships; see `pages:build`.                                                                                                                                                                        |
| `npm run start`     | `next start` — serve the `next build` output                                                                                                                                                                                                         |
| `npm run pages:dev` | `wrangler pages dev .vercel/output/static --compatibility-date=2025-01-01 --port 9006 --ip 0.0.0.0` — serve the built Pages bundle locally on port 9006 (run `pages:build` first; this is the target `E2E_BASE_URL=http://localhost:9006` points at) |

### Build for Cloudflare Pages

| Command                | What it does                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run pages:build`  | `npx @cloudflare/next-on-pages` — bundles the app for Pages into `.vercel/output/static` (matches `pages_build_output_dir` in `wrangler.toml`) |
| `npm run pages:deploy` | `npx wrangler pages deploy .vercel/output/static` — uploads that bundle                                                                        |

The production path is **`npm run pages:build` → `.vercel/output/static`**,
never `next build`. Deploy is normally done through the repo-root ship gate
[`scripts/ship.sh`](../scripts/ship.sh), which chains:

1. `npm run pages:build` (from `api/`)
2. bundle-marker grep — `grep -rl "$SHIP_MARKER" .vercel/output/static/_next/static/chunks/` proves the new code is in the bundle (default marker `oz-flip-card`; `SHIP_MARKER=""` skips)
3. `npm run pages:deploy`
4. Playwright landing E2E against the deployed URL (`E2E_SPEC`, `E2E_WORKERS`, `E2E_BASE_URL` env overrides; the zone 403s plain `curl`, so verification is browser-only)

Credentials come from wrangler's stored auth (`wrangler login` or
`CLOUDFLARE_API_TOKEN` in the environment) — never pass tokens as arguments.

### Quality gates

| Command                           | What it does                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                    | `eslint src/` — typed lint (strictTypeChecked). CI fails only if the warning count grows past the baseline in `.gitforge.yml`.                                                |
| `npm run lint:fix`                | `eslint src/ --fix`                                                                                                                                                           |
| `npm run format` / `format:check` | `prettier --write src/` / `--check src/`                                                                                                                                      |
| `npx tsc --noEmit`                | Type check (not an npm script; run from `api/`)                                                                                                                               |
| `npm run test`                    | `vitest run` — unit tests, Node environment                                                                                                                                   |
| `npm run test:watch`              | `vitest` in watch mode                                                                                                                                                        |
| `npm run test:coverage`           | `vitest run --coverage` — v8 provider, floors enforced: 99% statements / 96% branches / 92% functions / 99% lines over `src/lib/**` + `src/app/api/**`                        |
| `npm run test:docs-claims`        | `vitest run src/lib/__tests__/docs-claims.test.ts` — asserts the layer/basemap/route numbers in the root `README.md` and `CLAUDE.md` against the registries that produce them |
| `npm run test:e2e`                | `npx playwright test` — see Tests/E2E below                                                                                                                                   |

### OpenAPI

| Command                    | What it does                                                                      |
| -------------------------- | --------------------------------------------------------------------------------- |
| `npm run openapi:generate` | `node scripts/gen-openapi.mjs` — regenerates `src/app/api/openapi.json/spec.json` |
| `npm run openapi:check`    | `node scripts/gen-openapi.mjs --check` — exits 1 if the committed spec is stale   |

`scripts/gen-openapi.mjs` merges two sources: the hand-authored
`src/lib/openapi/base.json` and a scan of `src/app/api/**/route.ts` for
exported handlers. Every route missing from the base gets a generated
skeleton, so the published spec cannot silently omit a live endpoint; a
route documented in the base but absent from the tree is a hard error.
`info.version` is stamped from `package.json`, so a version bump requires
regenerating (the openapi tests fail otherwise). The spec is served by
`/api/openapi.json`, which substitutes the request origin into `servers`.

## Tests

**Unit (vitest).** `npm run test` runs the whole suite; `src/lib/**` and
`src/app/api/**` are coverage-counted with the floors above. CI (`.gitforge.yml`,
`unit-test` job) runs `npx vitest run --maxWorkers=2 --reporter=dot` with two
in-command retries for NAS load flake, then asserts a **completeness guard**:
the passing run must cover exactly the recorded test-file and test counts
(current values live in `.gitforge.yml`). Adding or removing a test file means
bumping both numbers there.

**E2E (Playwright).** `npm run test:e2e` runs `e2e/*.spec.ts` against two
projects (chromium, firefox) with one retry. `playwright.config.ts` defaults
`baseURL` to production; retarget with `E2E_BASE_URL`:

```bash
E2E_BASE_URL=http://localhost:9006 npx playwright test   # local pages:dev bundle
npx playwright test -- --workers=2                       # this host OOMs above 2 workers
E2E_RUN_HEAVY=1 npx playwright test e2e/ozt2-validate.spec.ts   # opt-in full Cesium terrain pipeline check
```

`e2e/ozt2-validate.spec.ts` self-skips unless `E2E_RUN_HEAVY=1` is set.

## Environment

Declared in [`wrangler.toml`](wrangler.toml) and [`.env.example`](.env.example).

**`wrangler.toml` `[vars]`** (non-secret, committed):

| Var               | Value                     | Actually consumed by code?                                                                                                                                                                  |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_BACKEND` | `huggingface`             | Yes — `src/app/api/health/route.ts` reports it                                                                                                                                              |
| `HF_REPO`         | `aliasfox/srtm30m-merged` | No — no handler reads it; the HuggingFace dataset ids are constants in `src/app/api/dem-tile/[z]/[x]/[y]/route.ts` (`srtm30m-ozt2-v2`) and `src/lib/client-elevation.ts` (`srtm30m-merged`) |
| `USE_MERGED`      | `true`                    | No — declared only                                                                                                                                                                          |

**Secrets** (set with `wrangler pages secret put <NAME> --project-name openzenith`):
`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `AISSTREAM_KEY`,
`FIRMS_MAP_KEY`, `ADSB_EXCHANGE_KEY`.

**Read from the environment by `src/`:** `STORAGE_BACKEND` (health route),
`ALLOWED_ORIGINS` (`src/middleware.ts` CORS allowlist), `GEBCO_TILE_URL`
(`src/lib/gebco/cog-reader.ts` self-hosted bathymetry override), `NODE_ENV`.
`DEM_TILES` appears in `.env.example` but nothing under `src/` reads it.

There are **no R2 bindings** — `wrangler.toml` declares none; tile reads go
to HuggingFace with the Workers Cache API in front
(`src/lib/storage/edge-cache.ts`).

## Registries (single sources of truth)

| Truth                               | Module                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 62 curated data layers              | `LAYERS` in `src/lib/layers/registry.ts`                                                                   |
| 54 layers with a 2D MapLibre loader | `MAP_2D_LAYER_IDS` in `src/app/map/lib/layers/index.ts` (derived from `LAYER_LOADERS`)                     |
| 10 basemaps                         | `BASEMAPS` in `src/lib/basemaps.ts` (`BASEMAP_ORDER` lists them; `GLOBE_BASEMAP_KEYS` is the globe subset) |
| 80 API route handlers               | `route.ts` files under `src/app/api/`                                                                      |

`src/lib/__tests__/docs-claims.test.ts` holds the first, third, and fourth of
these against the numbers the root `README.md` / `CLAUDE.md` publish.

## Runtime notes

- `src/middleware.ts` applies a best-effort per-isolate sliding-window rate
  limit (120 requests / 60s, in-memory `Map`) and CORS headers to `/api/*`,
  skipping `/api/health`. Per-isolate means it is not a global limit — use
  Cloudflare rate-limiting rules for that.
- Perf work is gated: `node scripts/perf-budget.mjs` (after `pages:build`)
  checks the bundle against `perf-budget-baseline.json` (`--update` for a
  deliberate move), and `node scripts/measure-perf.mjs` measures cold-load
  CDP metrics per route (`BASE=` overrides the target URL).
- Post-deploy verification scripts live at the repo root:
  `scripts/verify_pages_artifact.mjs` (required Pages functions present in the
  bundle), `scripts/verify_pages_deployment.mjs` (`EXPECTED_SHA` provenance),
  and `scripts/smoke_public_api.mjs` (`BASE_URL=<url>` contract smoke).
