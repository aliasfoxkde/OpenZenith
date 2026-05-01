# Globe Page Revamp Plan

## Status: ACTIVE

## Background

The `/globe` page at openzenith.pages.dev is loading but showing **console errors** that prevent proper rendering:

### Error Analysis

1. **`hasVertexNormals` setter error** — ✅ FIXED (b8a80e2, deployed)
2. **`Tracking Prevention blocked storage`** — 36× for localStorage calls. All wrapped in try/catch. **Not app-breaking**, caused by browser extensions or ETP in strict privacy mode.
3. **`beacon.min.js:1 ERR_BLOCKED_BY_CLIENT`** — Ad-blocker blocking third-party beacon. **Not in our code.**
4. **`api.cesium.com/v1/assets/2/endpoint 401`** — Cesium Ion default asset without token. **Known, suppressed.**
5. **`requestAnimationFrame handler 173ms`** — preRender too heavy. **Performance warning.**
6. **Page not loading** — The deployment URL `3313b2ef.openzenith.pages.dev` was from a test deploy. The main `openzenith.pages.dev` may be serving cached old build.

## Root Cause: Cached Build

The `openzenith.pages.dev` deployment was from **April 21** (10 days ago, based on `age: 282726` = ~3.3 days cache, but the HTML ETag suggests old build). The `hasVertexNormals` fix was pushed today but the Cloudflare Pages deployment was NOT triggered because it requires pushing to `origin/main`.

**Actual state**: The CI/CD workflow should deploy automatically on push to main. But `openzenith.pages.dev` may be on an older deployment path (Vercel vs Cloudflare Pages).

## Deployment Strategy

1. **CI/CD trigger**: Push to main → GitHub Actions → deploy to Cloudflare Pages
2. **Manual trigger**: `wrangler pages deploy` (for immediate fix)

## Revamp Phases

### Phase 1: Fix Critical Errors (Now)
- [x] Fix `hasVertexNormals` — deployed via b8a80e2
- [ ] Verify Cloudflare Pages auto-deploys
- [ ] Test with fresh browser (no extensions) to confirm no other errors
- [ ] Fix `requestAnimationFrame` performance (defer LOD/atmosphere updates)

### Phase 2: Deep Research on gods-eye.app (Reference)
- [ ] Crawl gods-eye.app/globe for feature set
- [ ] Identify missing features vs our current implementation
- [ ] Document comparison

### Phase 3: Globe Architecture Refactor
- [ ] Extract page.tsx into sub-components (reduce from 1,423 lines)
- [ ] Move all layer loading into a unified LayerManager class
- [ ] Create a DataSource abstraction (abstracts API calls, retries, polling)
- [ ] Add proper error boundaries around each widget
- [ ] Refactor preRender handler (too heavy — 173ms violations)

### Phase 4: Testing & Validation
- [ ] Playwright E2E tests for globe page
- [ ] Console error validation (0 critical errors)
- [ ] Performance profiling with Chrome DevTools

### Phase 5: Documentation
- [ ] Update docs/globe/README.md with architecture
- [ ] Document all layer sources and refresh rates
- [ ] Update ROADMAP.md

## Globe Architecture (Current)

```
globe/page.tsx (1,423 lines) — Main component
├── lib/cesium-init.ts — Viewer creation, terrain, imagery
├── lib/terrain-csr.ts — CSR terrain provider
├── lib/styles.ts — All CSS
├── lib/helpers.ts — Hash parsing, basemap switching
├── lib/lod.ts — Level-of-detail zone transitions
├── lib/constants.ts — Themes, basemaps, sidebar sections
├── lib/types.ts — TypeScript interfaces
├── lib/data-fetchers.ts — API calls with retry
├── lib/clustering.ts — Entity clustering
├── lib/space-scene.ts — Stars + planets
├── lib/layers/ (25 files)
│   ├── earthquakes.ts, flights.ts, vessels.ts, military.ts
│   ├── satellites.ts, hurricanes.ts, warnings.ts, radar.ts
│   ├── volcanoes.ts, wildfires.ts, lightning.ts, currents.ts
│   ├── gps-jamming.ts, day-night.ts, and 12 more
├── lib/widgets/ (8 files)
│   ├── BasemapWidget, LayersWidget, ToolsWidget, SettingsWidget
│   ├── useWidgetManager, WidgetShell, WidgetBar, types
├── lib/tools/ (6 files)
│   ├── tools.ts, measure.ts, elevation-profile.ts
│   ├── bookmarks.ts, annotations.ts, range-rings.ts, screenshot.ts
├── lib/components/ (3 files)
│   ├── ContextMenu.tsx, HudOverlays.tsx
```

## Reference: gods-eye.app Features

From crawl of https://gods-eye.app:
- Boot/loading sequence animation
- Country deep-dive panels
- Terminal-style text
- Panel-based layout
- Skeleton loading shells
- Live news integration
- Market data
- Military tracking (different from our flights/vessels)
- Infrastructure monitoring
- Geopolitical overlays

**Key difference**: gods-eye.app appears to be a **general intelligence dashboard** (news + markets + politics) while openzenith's globe is a **geospatial visualization platform**. The "globe" is one view among many.

## What's Missing From Current Globe

From the ROADMAP.md and known issues:
1. Time-series animation (hurricane tracks with play/pause)
2. PWA / offline tile caching
3. Mobile-responsive sidebar
4. 3D building extrusion
5. i18n
6. WASM client-side format conversion (for Studio)
7. Shareable map state via URL hash (partially done)

## Backup Location

All original files backed up to: `api/src/app/globe.bak/`

## Deployed Fix Verification

After CI/CD deploys b8a80e2, verify at openzenith.pages.dev/globe:
1. Open DevTools → Console
2. Filter for errors (not warnings)
3. Confirm no `hasVertexNormals` error
4. Confirm globe renders (Cesium widget visible)
5. Confirm all layers toggleable
