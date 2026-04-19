# OpenZenith — Gap Analysis & Improvement Plan

**Date:** 2026-04-19  
**Version:** 0.5.1  
**Scope:** System-wide audit for remaining improvements

---

## Priority 1: Wire Existing But Unconnected Features

### 1A — Annotations Layer (file exists, not in dispatcher)
- `annotations.ts` exists with `renderAnnotations`/`removeAnnotations`
- Imported in `page.tsx` and partially wired (drawing mode, state)
- **NOT in `LAYER_HANDLERS` dispatcher** — works independently via drawing mode
- **Status:** Working but isolated from layer toggle system
- **Fix:** Keep as-is (annotations are a tool, not a data layer — correct design)

### 1B — Hurricane Track Animation
- `startHurricaneAnimation`/`stopHurricaneAnimation` exported from `hurricanes.ts`
- Exported from `layers/index.ts`
- **NOT used in `page.tsx`** — animation controls never rendered
- **Fix:** Add play/pause button in sidebar when hurricane layer is active

### 1C — 9 Globe-Only Layers (no 2D handler)
These exist in registry but have no 2D MapLibre implementation:
| ID | Name | Feasibility |
|----|------|------------|
| `aviationWeather` | SIGMETs/AIRMETs | Easy — GeoJSON polygons |
| `bathymetry` | Bathymetry | Medium — GEBCO tile raster |
| `blueMarble` | Blue Marble | Easy — raster tiles |
| `flightArcs` | Flight Arcs | Hard — requires arc computation |
| `groundTracks` | Ground Tracks | Medium — needs TLE→ground track |
| `orbitalTracks` | Orbital Tracks | Hard — 3D concept, 2D unclear |
| `satellite` | GOES Satellite | Easy — raster tiles |
| `satellites` | Satellite Positions | Easy — points from TLE |

**Recommended to add (high value, low effort):**
- `aviationWeather` — polygon overlay (fetch from NOAA)
- `satellites` — scatter points from Celestrak
- `bathymetry` — tile raster (already have API route)
- `satellite` — GOES-East raster tiles

**Skip (3D concepts or high effort):**
- `flightArcs` — animated 3D arcs don't translate well to 2D
- `orbitalTracks` / `groundTracks` — complex TLE computation
- `blueMarble` — low priority, have satellite imagery already

---

## Priority 2: Data Quality & Resilience

### 2A — AISstream Dead (vessels return no data)
- **Status:** WebSocket connects, subscription accepted, ZERO data
- **Impact:** Vessel layer shows loading forever, then empty
- **Fix:** Add timeout + graceful empty message
- **Doc:** See `VESSEL_AIRCRAFT_DATA_OPTIONS.md`

### 2B — OpenSky Rate Limiting
- Anonymous: 10 second interval between requests
- Authenticated: slightly better but still limited
- **Current mitigation:** SWR with 15min stale window
- **Enhancement:** Add request throttling + retry with backoff

### 2C — Layer Error Recovery
- Most layers have try/catch but some just silently fail
- **Fix:** Ensure all layers call `setStatus(handle, "error")` on failure
- **Fix:** Add auto-retry for transient failures (with exponential backoff)

---

## Priority 3: UX & Accessibility

### 3A — Accessibility (a11y) — CRITICAL
- **Current:** 1 `aria-label` in entire map page (2000+ lines)
- **Fixes needed:**
  - All toggle switches: `aria-label`, `role="switch"`
  - All buttons: descriptive labels
  - Sidebar sections: `role="region"`, `aria-label`
  - Map canvas: `role="application"`, keyboard instructions
  - Status indicators: `aria-live="polite"` for dynamic updates
  - Color contrast: verify WCAG 2.1 AA (4.5:1 ratio)

### 3B — Responsive Design — HIGH
- **Current:** 1 responsive class in entire map page
- Map page likely broken on mobile (< 768px)
- **Fixes needed:**
  - Sidebar: collapsible on mobile (overlay or drawer)
  - Layer controls: responsive grid
  - Position panel: hide or collapse on small screens
  - Touch: ensure MapLibre touch gestures work

### 3C — Keyboard Shortcuts
- **Current:** Only Enter key on bookmark save
- **Enhancements:**
  - `Escape`: close sidebar/popover, exit draw mode
  - `L`: toggle layer panel
  - `B`: toggle bookmarks
  - `F`: focus search
  - `?`: show help overlay

### 3D — Loading States
- Some layers show "loading" but others show nothing
- **Fix:** Standardize loading indicators across all layers
- **Enhancement:** Skeleton UI for sidebar while layers load

---

## Priority 4: Performance

### 4A — Service Worker Staleness
- `sw.js` exists at `/sw.js` (200 OK)
- Registered in both `layout.tsx` and `ServiceWorkerRegistration.tsx` (double registration!)
- **Fix:** Remove duplicate registration, ensure SW updates properly

### 4B — Large Page Components
- `map/page.tsx`: 2,019 lines
- `globe/page.tsx`: 1,393 lines
- `explore/page.tsx`: 1,601 lines
- **Enhancement:** Extract sidebar, layer panel, toolbar into separate components
- **Risk:** Medium (large refactor, but improves maintainability)

### 4C — Layer Refresh Optimization
- Many layers use `setInterval` for polling
- No cleanup on page hide/background
- **Fix:** Use `document.visibilitychange` to pause/resume polling
- **Fix:** Abort controller for fetch cancellation

---

## Priority 5: Python SDK

### 5A — pyproject.toml
- **Fixed:** Duplicate `[project.scripts]` section removed
- **Status:** `pip install -e .` works, 30 tests pass

### 5B — Missing Test Coverage
- `converter.py`: No tests
- `geo_utils.py`: No tests  
- `tile_format_v2.py`: No tests
- `tracing.py`: Partial tests
- **Fix:** Add tests for all modules

### 5C — Documentation
- Docstrings exist but no Sphinx/MkDocs site
- README is minimal
- **Fix:** Add comprehensive docstrings + example gallery

---

## Priority 6: Documentation & Polish

### 6A — README Improvements
- Add badges (CI, PyPI, license)
- Add screenshot/GIF of the platform
- Document all 30+ layers
- Document API endpoints
- Add architecture diagram

### 6B — API Documentation
- No OpenAPI/Swagger docs for API routes
- **Fix:** Add route descriptions, params, response formats

### 6C — Changelog
- `CHANGELOG.md` exists but may be incomplete
- **Fix:** Ensure all changes are logged

---

## Implementation Order

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase A** | 1B (hurricane animation), 2A (vessel timeout), 4A (SW dedup) | 1-2 hours |
| **Phase B** | 1C (4 new 2D layers: aviationWeather, satellites, bathymetry, satellite) | 2-3 hours |
| **Phase C** | 3A (accessibility), 3B (responsive) | 3-4 hours |
| **Phase D** | 2B-C (error recovery, retry), 3C (keyboard), 4C (perf) | 2-3 hours |
| **Phase E** | 5A-C (Python SDK tests + docs) | 2-3 hours |
| **Phase F** | 6A-C (README, API docs, changelog) | 1-2 hours |
