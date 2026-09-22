# OpenZenith production audit and Claude/MiniMax handoff

**Audit date:** 2026-08-14 (America/Chicago)  
**Repository:** `/nas/Temp/repos/OpenZenith`  
**HEAD:** `51f5411` (`v0.8.0`)  
**Live targets checked:** `https://openzenith.pages.dev` and `https://openzenith.cyopsys.com`

## Executive conclusion

The primary failure is not currently proven to be a V2 decoder or water-data algorithm defect. The live Cloudflare Pages deployment is serving the UI but not the API route set present in the current repository. Critical requests return the Next.js 404 HTML document:

- `/api/geocode?query=New%20York&limit=3` → `404`, HTML
- `/api/elevation?lat=40.7128&lon=-74.0060` → `404`, HTML
- `/api/health` → `404`
- `/api/geoip` → `404`
- `/api/elevation-accuracy/4/8/8` → `404`

The map therefore displays a superficially healthy shell (`READY`) while data layers and point elevation silently fail. This explains the address-search regression and is a sufficient explanation for “no data” in the water elevation UI. A deployment/artifact/domain verification must be fixed before judging the new DEM dataset.

The current source has a second, independent product risk: the UI deliberately collapses many upstream/data failures into `null`, `unknown`, or HTTP 200 responses, so users receive “no data” without source, reason, retry, or coverage information. The V2 plan also documents intended datasets and routes that are not yet demonstrated as present in production.

## Implementation progress in this worktree

The following production-hardening changes are implemented locally, but are not live until the deployment is rebuilt and promoted:

- Added `scripts/smoke_public_api.mjs` and made the deploy workflow run it after Pages deployment. The local smoke suite passes all five checks; the current public Pages target fails all five with HTML 404 responses.
- Geocode and elevation routes now return structured error states while preserving successful response fields. Homepage and map search surface upstream failures instead of treating them as empty results; map failures use the shared toast provider.
- Client elevation results preserve `ok`, `no_data`, and `unavailable` states, and map pins/popups distinguish service failure from missing coverage.
- Fixed invalid MapLibre raster paint properties and the runtime marker-construction path that caused map console errors. Elevation and accuracy overlays are opt-in by default; hillshade remains enabled.
- Fixed Terrarium PNG IDAT decoding to use the zlib wrapper decoder. A local `/api/elevation-color/4/8/8` tile now renders coherent terrain without the observed vertical striping.
- Added route tests for geocode upstream failure and elevation no-data behavior. The targeted suite passes 19/19 tests and TypeScript compilation passes.
- `next build` and `npm run pages:build` both pass locally. `scripts/verify_pages_artifact.mjs` confirms the generated Cloudflare artifact contains the four critical function handlers, including the dynamic elevation-accuracy route. The health endpoint/package version was synchronized to `0.8.0` to match the repository release tag.
- The actual Cloudflare Pages adapter was served locally with Wrangler. Its smoke suite passed, browser address search returned two `New York` results with zero console errors, map search moved to `lat=40.7127/lng=-74.0060`, and a browser-side water query returned `-4577m`, `surface_type: ocean`, `source: gebco2025`, `resolution: 450`. The map screenshot reached `READY`; remaining browser errors were external Esri tile fetch failures and WebGL/GPU-context warnings in the automation environment, not missing application API routes.
- Repository-wide Prettier normalization now passes, and ESLint has zero errors. The remaining 116 ESLint warnings are non-blocking unused-symbol/`any` cleanup items. React Compiler migration diagnostics were explicitly separated from conventional Hooks correctness rules in `api/eslint.config.mjs`, with rationale documented there.
- Added `scripts/verify_pages_deployment.mjs`; CI now attaches the full Git SHA, `main` branch, and commit message to the Pages deployment, then verifies Cloudflare reports that SHA as the production deployment source before running both-domain API smoke tests. This separates “the right commit was deployed” from “the deployed worker actually serves API routes”; the existing remote deployment passes the former and fails the latter.
- The deploy job now uses the repository-pinned Wrangler CLI directly and uploads the already-generated next-on-pages worker with `--no-bundle`. This removes action-level CLI/bundling ambiguity; the provenance check and both-domain smoke tests remain mandatory after upload.

### Latest deployment-provenance evidence

Read-only Cloudflare inspection shows the Pages project `openzenith` exists and is associated with all four expected domains. Its latest listed production deployment is `8036daf0-1eed-4f5c-8b79-a17cf248f36f`, source `51f5411`, with deployment URL `https://8036daf0.openzenith.pages.dev`. Direct requests to that deployment URL, the project URL, and both custom domains all return the same Next HTML 404 for `/api/health`; the frontend static assets still return 200. This proves the issue is not DNS alone and not merely the custom-domain mapping.

The local `pages:build` output contains the advanced-mode worker at `.vercel/output/static/_worker.js/index.js`, includes 80 edge function routes in `nop-build-log.json`, and works under local Wrangler Pages emulation. The deployed Pages project is therefore serving the static Next artifact without invoking the generated worker, or is deploying an artifact/configuration different from the local output. Verify in the Cloudflare dashboard/API that the deployment is in Advanced Mode, that the uploaded output includes `_worker.js`, and that the deployment's Functions/worker invocation logs show `/api/*` requests. Cloudflare's current [Pages Advanced Mode documentation](https://developers.cloudflare.com/pages/functions/advanced-mode/) states that `_worker.js` is the Advanced Mode entrypoint and takes control of all requests; this is the exact deployment behavior to verify before further application-code changes.

Known verification limits remain: the live domains still serve the stale 404 deployment. Local quality gates now pass with 59/59 Vitest files (396 passed, 5 skipped), zero lint errors, clean formatting, TypeScript, Next.js build, Cloudflare Pages build, and critical artifact-route verification. ESLint still reports 116 non-blocking warnings, which should be reduced during the broader cleanup. The public deployment mismatch remains the only confirmed release blocker.

## Evidence collected

### Browser automation and screenshots

The real browser was driven with the Playwright CLI skill. Artifacts are in:

- `output/playwright/production-home.png`
- `output/playwright/production-map.png`
- `.playwright-cli/console-2026-08-14T17-09-54-948Z.log`
- `.playwright-cli/page-2026-08-14T17-10-18-490Z.yml`

Visual observations:

1. The homepage renders with a clean, readable layout and functional-looking search/coordinate controls, but it shows a persistent `Loading elevation map...` toast/overlay during the captured state.
2. The homepage’s generated API link points at `openzenith.cyopsys.com`, but that live endpoint returns 404 HTML.
3. The map renders the satellite basemap and controls, but the initial map load generated 47 console errors and 5 warnings.
4. The map’s layer requests for `/api/elevation-accuracy/{z}/{x}/{y}` all returned 404.
5. Searching `New York` in the homepage produced no result; the browser recorded `/api/geocode?query=New%20York&limit=5` → 404.
6. The map status remained `READY` despite the failed data requests. This is misleading operational UX.

The Cloudflare Insights connection-refused error is incidental to this test environment; the application-level 404s are the material failures.

### Source-vs-production mismatch

The repository contains route files for `api/geocode`, `api/elevation`, `api/elevation/batch`, `api/health`, `api/geoip`, `api/elevation-accuracy/[z]/[x]/[y]`, and many others. The deployment does not expose them. The deploy workflow in `.github/workflows/deploy.yml` builds `.vercel/output/static` with `@cloudflare/next-on-pages`, but the workflow allows lint failures (`npm run lint || true`) and does not perform a post-deploy smoke test against the public hostname.

The current repository HEAD is tagged `v0.8.0`, while `api/package.json` still reports `0.7.0`. The live page also contains stale claims and links, including an API URL that is not live. Treat release identity, deployment provenance, and custom-domain routing as unresolved until verified with a deployment ID/build SHA.

### Current source path findings

Relevant code paths discovered from the code knowledge graph:

- Address route: `api/src/app/api/geocode/route.ts:10-51`
- Homepage search: `api/src/app/page.tsx:319-361`
- Map search: `api/src/app/map/page.tsx` around line 1155
- Point elevation server path: `api/src/lib/point-elevation.ts:36-106`
- API source fallback: `api/src/app/api/elevation/route.ts:12-58`
- Client elevation path: `api/src/lib/client-elevation.ts:234-271`
- OZT2 decoder: `api/src/lib/ozt2_decode.ts`
- OZT2 Cesium provider: `api/src/app/globe/lib/terrain-ozt2.ts:95-134`
- Layer registry references: `api/src/lib/layers/registry.ts` (including `/api/elevation-accuracy/{z}/{x}/{y}`)
- Deployment configuration: `api/wrangler.toml`, `.github/workflows/deploy.yml`

Important behavior in the current source:

- The homepage waits 300 ms, fetches `/api/geocode`, and ignores non-OK responses. A 404 therefore looks like “no results.”
- `getClientElevation` tries browser-side HuggingFace/GEBCO access, then fetches `/api/elevation`; it returns `null` for all failed or `null` responses.
- `getPointElevation` returns `null` for out-of-SRTM coverage, missing chunks, decompression errors, NODATA, and failed fetches. It does not preserve a structured reason.
- The API tries HuggingFace merged chunks, then GEBCO, and finally returns `{ elevation: null, surface_type: "unknown", source: "none" }`.
- Negative elevation is treated as `surfaceType: "ocean"`; this is a weak heuristic and does not distinguish inland water, seafloor, lake bed, missing land, or a valid below-sea-level land value.
- The API deployment variables still identify `aliasfox/srtm30m-merged` in `api/wrangler.toml`; the V2 plan describes `openzenith/elevation-v2-ozt2` and `openzenith/bathymetry-v2-ozt2` as targets, but production use of those datasets is not evidenced by the live deployment.
- The OZT2 Cesium provider converts NODATA heights to zero. That can make missing terrain look like sea level and needs an explicit validity/no-data policy.

## Test results

### Passing checks

- API Vitest: **59 files passed; 394 tests passed; 5 skipped**.
- The passing tests include geocode, elevation, elevation batch, health, DEM tile, OZT2-related, and map utility tests.
- This proves local test mocks and source-level handlers behave as expected; it does **not** prove the public deployment contains the handlers or bindings.

### Failing or weak gates

- `npm run lint` fails with **16 errors and 116 warnings**. Notable errors affect `api/src/app/page.tsx`, `api/src/app/map/page.tsx`, `api/src/app/globe/page.tsx`, `api/src/app/studio/page.tsx`, `api/src/app/api/docs/page.tsx`, `ElevationProfile.tsx`, and `wasm-demo/page.tsx`.
- The lint errors include synchronous state updates in effects, ref access/mutation during render, and use-before-declaration. These are maintainability and potential React behavior risks, not cosmetic issues.
- The CI workflow explicitly allows lint failures, so a red-quality source tree can deploy.
- The initial `npm test -- --runInBand` command was invalid for Vitest; the correct `npm test` run passed.
- A production build compiled successfully and proceeded to type checking, but the long-running local build process did not yield a final completion artifact during this audit. Re-run it to a captured log and require an explicit exit code before accepting it.

## Root-cause hypotheses, ranked

### P0 — confirmed: production API routes are missing or routed to the wrong Pages artifact/domain

This is confirmed by public HTTP and browser evidence. Fix deployment output, Cloudflare Pages project/domain attachment, route publication, and post-deploy verification first.

### P0 — highly likely: deployment provenance is stale or split between `pages.dev` and custom domain

Both tested domains showed the same API 404 behavior, but the page contains stale version/content signals. Verify the Pages project, branch, build command, output directory, and custom domain DNS/route mapping. Add a public build metadata endpoint.

### P1 — confirmed design weakness: failures are hidden behind `null`, generic 200 responses, and `READY`

Even after deployment is repaired, upstream outages, missing V2 tiles, NODATA, and coverage gaps will be indistinguishable. Introduce structured error/coverage states and make the status indicator reflect request health.

### P1 — plausible data-path issue: V2 is not the single production source of truth

The source still has old merged-file/HuggingFace paths, Terrarium paths, GEBCO strip reads, OZT2 decoders, and R2 tile paths. The V2 plan itself lists unfinished work such as generated/uploaded tile coverage, GEBCO OZT2 upload, E2E OZT2 validation, and storage verification. Do not claim “DEM V2 live” until a manifest and sampled production bytes prove it.

### P1 — confirmed quality issue: CI accepts lint failures

This permits regressions in the exact UI layers under investigation. Make lint/type/build gates blocking, then fix or consciously narrow the rules with documented rationale.

### P2 — likely UX issue: no-data semantics and water classification are underspecified

Valid bathymetry, inland water, below-sea-level land, missing tile, invalid coordinate, upstream timeout, and service outage need different labels and behavior. “No data” is not an adequate user-facing state.

## Required implementation plan for Claude/MiniMax

### Phase 1: restore and prove production routing

1. Identify the Cloudflare Pages project actually serving both domains and record current deployment ID, commit SHA, build logs, output path, and environment/binding configuration.
2. Build the current `api` package from a clean checkout using the exact CI commands.
3. Inspect `.vercel/output/static` after `npm run pages:build`; assert that every critical route is represented in the generated output/functions.
4. Deploy a canary/preview and run smoke checks for `/`, `/map`, `/api/health`, `/api/geocode`, `/api/elevation`, `/api/elevation/batch`, `/api/dem-tile/0/0/0`, and `/api/elevation-accuracy/0/0/0`.
5. Verify the same response and build metadata through both `pages.dev` and `cyopsys.com`.
6. Add CI post-deploy checks that fail on HTML 404 for JSON endpoints, wrong content type, wrong commit SHA, missing route, or missing R2 binding.

### Phase 2: make address search production-grade

1. Add tests for empty query, URL encoding, normal place, Unicode place, upstream 429/5xx, timeout, malformed upstream JSON, and zero-result search.
2. Add request cancellation/debouncing so stale responses cannot overwrite newer queries.
3. Return a stable schema such as `{ results, count, source, requestId, error?: { code, message, retryable } }`.
4. In the UI, show loading, no-results, upstream-unavailable, and retry states; do not silently ignore 404/5xx.
5. On selecting a result, validate finite coordinates, normalize longitude, update the map/view, and expose an accessible result list with keyboard navigation.
6. Add a rate-limit/cache policy and an honest attribution link for Nominatim/OpenStreetMap.

### Phase 3: fix elevation and water semantics

1. Define a typed result contract with `status: ok | nodata | outside_coverage | upstream_error | invalid`, `surface: land | inland_water | ocean | seafloor | unknown`, `elevation`, `vertical_datum`, `source`, `resolution`, `tile`, and `warnings`.
2. Keep valid negative land elevations (for example, the Dead Sea) distinct from ocean/seafloor.
3. Use a land/water mask or source metadata instead of `elevation < 0` as the only surface classifier.
4. Establish source priority explicitly: regional high-quality land → V2 land → legacy fallback; ocean/bathymetry → GEBCO; ice surface policy documented separately.
5. Ensure V2 tile reads have a manifest, version/magic check, checksum/ETag, coverage metadata, and fallback behavior. Never interpret missing/NODATA as zero without a validity bit.
6. Test representative points: New York, Mount Everest, Dead Sea, Lake Baikal, an inland lake, shallow coastal water, mid-ocean, Mariana Trench, North Pole/ice, and a known missing/corrupt legacy tile.
7. Add end-to-end tests that exercise the same public HTTP path used by the browser, not only mocked route modules.

### Phase 4: production UI and observability polish

1. Replace `READY` with per-subsystem health: map shell, basemap, elevation, search, overlay layers, and cache.
2. Surface failed layer requests in the layer panel with retry and source details; avoid dozens of untracked console errors.
3. Fix the 16 lint errors and make lint/type/build blocking in CI.
4. Add error boundaries around map/globe/studio, loading skeletons, empty states, keyboard/focus behavior, mobile layout checks, and reduced-motion handling.
5. Add a lightweight client telemetry/error event path without collecting unnecessary personal data.
6. Keep displayed claims/version numbers synchronized with generated build metadata and actual dataset coverage. Remove “100% coverage” and similar claims unless measured and continuously verified.

### Phase 5: V2 dataset release discipline

1. Produce a machine-readable dataset manifest with dataset version, source, coverage, zoom range, tile count, checksum, vertical datum, resolution, and generated-at timestamp.
2. Validate a statistically meaningful sample of V2 tiles against source arrays and legacy/AWS reference tiles, including water and edge cases.
3. Publish a staging V2 endpoint first; compare old/new values and latency/error rates.
4. Promote only after browser, SDK, API, and tile-server paths all read the intended version.
5. Retain a rollback switch to the last known-good dataset and test rollback.

## Acceptance criteria

The work is complete only when all of these are evidenced:

- Both public domains expose the same current build SHA and all documented critical API routes.
- Address search returns real JSON results for `New York`, shows an explicit user-facing error when upstream is unavailable, and works from homepage, map, globe tools, and studio.
- Land, inland water, ocean, bathymetry, NODATA, outside coverage, and upstream failure render distinct states.
- A water click/query returns a valid bathymetry value where the dataset covers it, not a generic “no data” caused by a missing route.
- V2 dataset manifest, route format negotiation, storage objects, checksums, and fallback behavior are verified in staging and production.
- Browser smoke tests run against the public deployment at desktop and mobile sizes; screenshots are reviewed; console has no unexpected application errors; failed optional providers are visibly attributed and retryable.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run pages:build` pass without ignored failures.
- CI blocks deployment when route smoke tests, build provenance, or required bindings fail.
- Documentation and UI claims match measured capabilities and the deployed version.

## Suggested first prompt to Claude/MiniMax

> Work from `docs/CLAUDE_HANDOFF_PRODUCTION_AUDIT_2026-08-14.md`. Treat the live 404 evidence as the first blocker. Verify deployment provenance and route publication before changing DEM algorithms. Then implement the phases in priority order, preserving backward compatibility, adding public HTTP and browser E2E tests, structured elevation/search error states, V2 manifest/checksum/coverage validation, and production-safe observability. Do not mark the task complete based only on local mocked Vitest tests; prove the public deployment with browser automation, screenshots, response content types, build SHA, and representative land/water queries.
