# Performance Plan — 2026-10-02

Deep-dive audit of web-app performance: rendering, lazy-loading, bundle
composition, runtime main-thread work, caching, and data-layer lifecycle.
Every item is evidence-anchored (file:line or measurement) and has a
verification method. Work top-to-bottom; each item lands as its own commit
with its gate re-run.

## Results (2026-10-02, P0+P1 executed)

Deterministic evidence (build bytes, headers, prod E2E — reproducible):

| Slice | Evidence |
|---|---|
| Fonts (2) | 4 Google Fonts `@import` chains removed (about, contribute, explore, globe); one 31,432 B self-hosted variable woff2, preloaded with matching CORS mode |
| Landing render storm (3) | tooltip state local to `StatCard`; scroll rAF-batched; stable `lookup`/`onPick`/`setCoords` — landing page chunk unchanged at 61,762 B (the win is commits avoided, not bytes) |
| Dead code (4) | HeroParticles (177 lines) deleted; `oz-pulse` keyframes defined; emoji literals fixed |
| Budget gate (5) | `perf-budget.mjs` + baseline JSON + `bundle-budget` CI job; deliberate moves require `--update` + their own commit |
| Cesium preload (6) | globe route HTML preloads Cesium/satellite.js (classic-script CORS mode) + preconnects jsdelivr/cdnjs — the ~2.4 MB unpkg fetch now races hydration instead of following it |
| HeroMap (7) | map init deferred to `requestIdleCallback`; boundaries + elevation-accuracy attach after map `idle`; per-frame GPU filter removed; arcgisonline/openfreemap preconnects |
| Lazy barrel (8) | chunk 9157 (67 KB raw / 16.5 KB wire) off /map's initial closure — net ~9.4 KB wire after the split's own chunks; +17.5 KB raw total from per-chunk overhead (baseline refreshed); earthquakes stays eager |
| Layer timers (9) | map: per-layer interval/cleanup scoping + hurricane-animation isolation; globe: 17 push sites keyed across 19 modules, toggle-off reclaims timers, dynamicKeys complete (22 layers). Verified by suites + code paths; live toggle-network crawl still to do |
| Cache alignment (10) | dem-tile/elevation-color/elevation-accuracy/tile/WMTS-tiles emit `max-age=31536000, immutable` (prod-verified); geocode MISS→HIT with fresh requestIds; elevation HIT across `28.0/86.9` vs `28/86.90` (key normalization) — prod-verified via Playwright |
| Prod E2E | two ship.sh runs: 26 passed, then 25 passed + 1 flaky-retry (address search — watch for recurrence; geocode HIT may have shifted timing) |

Wall-clock deltas (FCP/LCP/long-tasks vs the baseline table above) are
**pending**: this host was mid co-tenant compile storm (loadavg 43-70)
at pass-end, which poisons CDP timings — re-measure when
`/proc/loadavg < 12` (`measure-perf.mjs`). One directional signal from
the noisy run: /globe LCP 4,416 → 3,064 ms, consistent with the
preload racing hydration.

## Method

1. **Fresh production build** (`npm run pages:build`, 2026-10-02) and full
   chunk census of `.vercel/output/static/_next/static/chunks` (157 js files,
   1.71 MB raw).
2. **CDP cold-load measurement** of prod (Playwright chromium, 1440×900,
   empty cache): wire bytes by host/type, FCP/LCP/CLS, long-task census
   (5 s idle + full-page scroll pass), request counts. Single-run numbers on
   a shared NAS — directional, not lab-grade; re-measure after each slice.
3. **Code inventory** — three parallel sweeps: asset/JS loading, landing
   render path, map/globe data-layer lifecycle.

## Baseline (prod, cold, 2026-10-02)

| Route | Wire | Reqs | FCP | LCP | Long-task ms (all after load) |
|---|---|---|---|---|---|
| `/` | 1,308 KB | 121 | 652 | 912 | 734 (11 tasks; scroll adds 0) |
| `/map` | 417 KB | 94 | 520 | 520 | 1,855 (25) — worst offender |
| `/globe` | 2,455 KB | 59 | 828 | **4,416** | 2,656 (18) |
| `/explore` | 21 KB | 36 | 124 | 208 | 111 |
| `/studio` | 22 KB | 73 | 608 | 864 | 1,515 (13) |
| `/demo` | 7 KB | 59 | 936 | 936 | 1,241 |
| `/wasm-demo` | 25 KB | 15 | 688 | 688 | 0 |

Landing byte budget: 67% is third-party — `server.arcgisonline.com` hero
tiles 629 KB + `unpkg.com` MapLibre 253 KB. Globe: 2,392 KB of 2,455 KB is
unpkg (Cesium). Per-route JS raw budgets: shared baseline ~529 KB
(framework 190 + two Next runtime chunks 347 + polyfills 113) before any
page code; page chunks: globe 149 KB, map 62 KB + layers barrel 67 KB,
landing 61 KB.

---

## P0 — contained, high-confidence wins (this pass)

### 1. Kill the 113 KB polyfills chunk with a modern browserslist

**Status: RETRACTED** — browserslist config produced a byte-identical polyfills chunk; the Next 15 app-router polyfills bundle is a fixed compiled artifact, not browserslist-gated. Config reverted.
No `browserslist` in `api/package.json`, so Next applies its default
(~chrome 64+, wide core-js set) → `polyfills-*.js` 112,594 B raw on
**every** route. Target evergreen browsers; verify the chunk shrinks after
rebuild; if Next ignores the config for the app-router polyfill bundle,
retract the item. **Verify:** diff polyfills chunk before/after; landing
E2E green (guards behavior).

### 2. Self-host JetBrains Mono via `next/font` (4 render-blocking chains)

**Status: SHIPPED** (fc36011, ed65dda) — self-hosted variable woff2 + real `@font-face` keeping the family name (`next/font` rejected: ~45 hardcoded `'JetBrains Mono'` strings, including Cesium canvas `ctx.font`, cannot take a CSS variable); all four `@import` chains deleted.
`@import` of Google Fonts inside injected `<style>` blocks at
`src/app/globe/lib/styles.ts:2`, `explore/page.tsx:36`, `about/page.tsx:24`,
`contribute/page.tsx:24` — each is a discover→download serial chain
(measured: `fonts.gstatic.com` 31 KB on /globe) and blocks first paint of
those pages. Replace with one `next_font/google` Inter+JetBrains Mono setup
in `layout.tsx` (self-hosted, preloaded, immutable) and delete all four
`@import`s. **Verify:** no `fonts.googleapis` in src; CSS chain gone in
built HTML; pages render fonts (screenshot spot-check).

### 3. Landing render storm: tooltip state re-renders 28 flip cards

**Status: SHIPPED** (ed65dda) — tooltip state localized into `StatCard`, scroll handler rAF-batched, `lookup`/`onPick`/`setCoords` given stable identities.
`page.tsx` is one 1,566-line client component with page-level `tooltip`
state (set by all 8 stat-card hover targets, `page.tsx:633-637`) and
`showTop` (`:200` scroll → `setState` per event, unthrottled). Every hover
re-renders the whole tree including 28 `FlipCard`s and 4 `CodeBlock`s with
freshly-allocated JSX props (memo would not help without restructuring).
**Fix at the state site:** move tooltip into the stat-card component
(local state), rAF-batch the scroll handler, `useCallback` the `lookup`
closure passed to `SearchBox`. **Verify:** landing E2E (13 tests × 2
browsers) green; React DevTools not required — the win is fewer wasted
commits; count renders via a temporary counter if needed.

### 4. Dead/defective code on the landing path

**Status: SHIPPED** (ed65dda) — HeroParticles deleted, `oz-pulse` keyframes defined (disabled under prefers-reduced-motion), emoji literals fixed.
- `HeroParticles.tsx` (177 lines, O(n²) particle loop) is imported by
  **nothing** — delete (anti-pattern rule: no dead code).
- `@keyframes oz-pulse` referenced in `map-helpers.ts:20` is defined
  nowhere — the pin pulse is a silent no-op; either define it or drop the
  property (define: it is a designed effect).
- `page.tsx:1038,1079` render literal `📤` text instead of the
  📤 emoji (double-escaped in JSX). Fix to real characters.
**Verify:** build clean, lint clean, landing E2E green, eyeball prod.

### 5. Budget gate so the wins cannot silently regress

**Status: SHIPPED** (c6f8013, 0552b62) — `scripts/perf-budget.mjs` + committed baseline + `.gitforge.yml` `bundle-budget` job; baseline refreshed deliberately for item 8's chunk split.
`scripts/perf-budget.mjs`: reads a committed baseline JSON (per-route
wire-KB from the CDP script + key chunk sizes from the build output) and
fails on growth beyond a threshold; wire it into `.gitforge.yml` as a
`bundle-budget` job after `typecheck` and into the local pre-ship flow.
Baseline stored with this doc; update deliberately when a slice moves it.

---

## P1 — structural (next pass, each independently shippable)

### 6. `/globe` LCP 4.4 s — start the Cesium fetch earlier, keep CDN

**Status: SHIPPED** (fc36011) — route-scoped preload (no `crossOrigin`: cesium-init injects classic scripts, and a CORS-mode mismatch would double-download) + preconnects for jsdelivr/cdnjs.
92% of globe wire bytes are unpkg (Cesium 1.119 + Workers/Assets), fetched
only after hydration because `cesium-init.ts:30-47` injects the script
from a mount effect. Add `<link rel="preload" as="script">` +
`rel="preconnect"` for unpkg/jsdelivr/cdnjs from the globe route's server
HTML (React 19 hoists `<link>` from components) so the download races the
bundle instead of following it. Optionally self-host Cesium on Pages later
(edge + brotli + our immutable headers) — separate decision, deploy-size
tradeoff (~30 MB). **Verify:** globe LCP re-measured (target < 3 s cold).

### 7. HeroMap: idle-init + defer non-critical layers + drop the GPU filter

**Status: SHIPPED** (ed65dda) — `requestIdleCallback` init with timeout fallback and dual cancel, boundaries/accuracy attached after map `idle`, GPU filter removed, arcgisonline/openfreemap preconnects.
`HeroMap.tsx:31` constructs the map on mount; boundaries vector
(`:84-89`) and elevation-accuracy raster (`:109-126`) load with it; dark
mode applies a per-frame GPU `filter: brightness(1.4) contrast(0.9)
saturate(0.6)` (`:209`) although the basemap in dark mode is already Esri
World **Dark Gray** — remove the filter. Initialize the map on
`requestIdleCallback` (fallback timeout), attach boundaries/accuracy after
map `idle`. Add `preconnect` to `server.arcgisonline.com` +
`tiles.openfreemap.org` (landing pulls 629 KB from ArcGIS with no
preconnect today; `layout.tsx:107` only preconnects unpkg).
**Verify:** landing FCP/LCP unchanged-or-better, long-task ms down,
E2E `waitInteractive` guard still green (it polls result values, not map
init).

### 8. `/map` layers barrel → per-layer dynamic imports (mirror the globe)

**Status: SHIPPED** (d597514) — dispatcher holds dynamic imports keyed by registry id; earthquakes stays eager (default-on, sync timeline API). Measured: chunk 9157 (67 KB raw / 16.5 KB wire) left /map's initial closure; net ~9 KB wire after the split's own chunks; +17.5 KB raw total from per-chunk overhead (baseline refreshed). **Finding (no action):** the ~108 KB wire of foreign-route chunks seen on every route is Navbar prefetch and starts only after `load` — idle cache warming, no FCP/LCP contention; disabling it would trade navigation latency for nothing.
`src/app/map/lib/layers` barrel (248-line index, ~50 modules) is
statically imported by `/map` and `/studio` → 67 KB chunk `9157` parsed on
every visit; `/map` has the app's worst long-task total (1,855 ms). The
globe already proved the pattern (22 lazy layer chunks, `globe/page.tsx:
706-769`). Convert map layer registration to lazy `await import()` per
enabled layer. **Verify:** chunk `9157` no longer in the `/map` initial
manifest; map E2E green.

### 9. Layer timer + fetch lifecycle (perf *and* correctness)

**Status: SHIPPED except abort-on-teardown** — map side (d2945a3): per-layer timer/cleanup scoping in the dispatcher, hurricane animation isolated to its own module-level id, tab-hide no longer drains shared state; globe side (1496d51): entries are `{key, id}` pairs across all 17 push sites in 19 modules, toggle-off clears exactly that layer's timers, dynamicKeys restored to all 22 layers. Residual documented in 1496d51: toggle-off during a layer's initial fetch lets that fetch's timer land after the clear (reaped next cycle). **Still open:** aborting in-flight data-fetcher requests on teardown (all fetchers accept `signal`, no caller passes one).
- Globe layers guard interval callbacks with `if (!stateLayers.X) return`
  but never `clearInterval` on toggle-off, and re-enabling stacks a second
  timer (`globe/lib/layers/*`).
- `globe/page.tsx:235-250` `dynamicKeys` restore list omits 7 layers
  (airQuality, aviationWeather, volcanoes, gdacs, marineWeather,
  wildfires, lightning) — they lose polling permanently after one
  tab hide/show.
- `stopHurricaneAnimation` (`map/lib/layers/hurricanes.ts:271-275`) pops
  the **shared** interval registry, killing every other layer's polling.
- `handle.cleanup` (`lightning.ts:103-108`) has zero callers.
- All 20+ data-fetchers accept `signal` and every caller passes nothing
  (`globe/lib/data-fetchers.ts`) — no abort on unmount/toggle-off.
**Fix:** per-layer timer registry with clear-on-disable; complete
`dynamicKeys`; scope hurricane stop to its own handle; abort in-flight
fetches on teardown. **Verify:** vitest + targeted E2E; manual toggle
crawl on /globe (network request count stops growing when layers off).

### 10. Cache alignment: immutable tiles + edge-cache the hot query routes

**Status: SHIPPED** (00c88dd + bf9f26f) — tile-rendering routes now emit `public, max-age=31536000, immutable` (dem-tile, elevation-color, elevation-accuracy gains the token, OZT1/terrarium tile route, WMTS tiles route); namespace version is the invalidation lever, and the x-cached-at freshness check inherits the 1y window. geocode (5 min, nominatim etiquette) and elevation point queries (1 day, coordinate key normalized to 7 dp) wrap the edge Cache API success-only with X-Cache observability. Batch elevation deliberately uncached (near-unique keys); gebco-tile/pmtiles excluded (explanatory JSON / mutable catalog).
- `dem-tile` route emits `max-age=3600` (`route.ts:61`) while
  `public/_headers` declares `/api/dem-tile/*` immutable 1y — route
  headers win on Pages (worker-served), so tiles re-download hourly and
  the edge revalidates to HF hourly. Tiles are coordinate-immutable: emit
  `public, max-age=31536000, immutable` and raise the edge-cache TTL to
  match (`storage/edge-cache.ts`). Same audit for `ozt2-tile`,
  `elevation-color`, `gebco-tile`.
- `geocode`, `overpass`, `elevation`, `elevation/batch` set cache headers
  but no edge Cache API — on Pages, worker responses are NOT CDN-cached,
  so every request walks to Nominatim/Overpass. Wrap in the existing
  Cache API pattern (`cacheTtl` keys include query string). Respect
  upstream etiquette (only cache success responses; short TTLs for
  nominatim).
**Verify:** vitest route tests; curl-through-browser check of
`cf-cache-status`-equivalent (Pages: second request latency drop); E2E
green.

---

## P2 — tracked, do after P0/P1 (not scheduled this pass)

### 11. Theme flash / double commit on the landing
`useTheme.ts:53` server snapshot is hardcoded `false`; 19 `dark ?`
branches in `page.tsx` inline styles mean dark-preference visitors get a
light-styled first paint, then a full-page re-render at hydration (the
pre-paint bootstrap script fixes `data-theme` but not inline styles).
Right fix: move the branchy inline styles to `[data-theme]` CSS custom
properties. Medium effort, visual-polish payoff.

### 12. Globe page chunk split
`app/globe/page-*.js` 148,981 B from 34 static imports (ContextMenu 848
lines, elevation-profile canvas tool 457, space-scene, widgets). Lazy-load
the tools/widgets that are not needed before first render, as the layer
modules already are.

### 13. Offload terrain compute from the main thread
OZT2 decode (`lib/ozt2_decode.ts`, fflate inflate) and satellite SGP4
(1,500 sats) run on the main thread; the WASM D8/viewshed kernels are
consumed only by `/wasm-demo`. One worker exists (`lib/worker-utils.ts`,
studio-only). Move OZT2 decode + propagation into workers via
`lib/worker-utils.ts`.

### 14. Cesium quality/cost knobs
`requestRenderMode: true` is set but `maximumScreenSpaceError`,
`tileCacheSize`, `resolutionScale` have zero hits in src — tune for
default-viewport quality per frame budget; expose in SettingsWidget
later.

### 15. Misc asset hygiene
`public/icon-512.png`, `icon-192.png`, `apple-touch-icon.png` are 16-bit
gray+alpha PNGs (~2× the 8-bit size); re-encode to 8-bit. Remove the dead
580px hero rule in `globals.css:75` (inline 660px wins).

## Non-goals / explicitly rejected
- Tailwind/PostCSS or CSS framework changes (none present; not a cost).
- `next/image` (no raster `<img>` in the app at all).
- Self-hosting MapLibre (CDN copy is fine; not on the critical hero path
  once item 7 lands — revisit only if unpkg latency regresses).
- Replacing Cesium (out of scope).

## Measurement discipline
Re-run `node /tmp/oz-perf-measure.mjs` (promote to `api/scripts/`) after
each slice and record deltas in the MASTER_PLAN progress log. Long-task
and wire-KB are the two primary metrics; FCP/LCP secondary (box load adds
noise). Deploy user-facing slices through `scripts/ship.sh` and
prod-verify — commits are not deploys.
