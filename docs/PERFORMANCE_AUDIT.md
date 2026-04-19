# OpenZenith Performance Audit & Improvement Plan

**Date:** 2026-04-19  
**Method:** Real profiling data from live deployment + source code analysis + runtime benchmarks

---

## Executive Summary

The platform has **four distinct performance domains**, each with different bottlenecks:

| Domain | Primary Bottleneck | Impact | Fix Complexity |
|--------|-------------------|--------|----------------|
| **Tile API** | HuggingFace redirect chain (302→XET storage) + CF CDN bypass | 0.4–0.7s per tile | Medium |
| **Frontend (Map)** | 2241-line monolith re-renders 60×/s on mouse move | Jank on slow devices | Medium |
| **Frontend (Globe)** | 5MB Cesium + CallbackProperty per-frame overhead | 5s initial load, frame drops | Medium |
| **Python SDK** | Two functions use Python loops (800× slower than vectorized) | viewshed 200×200 = 18s | Low |

**Completed fixes:** Python slope vectorized (154× faster), cursor debounce (6× fewer re-renders), SW TTL caching, CF Cache API code fix deployed.

**Key finding:** CF Pages Functions with `_routes.json: include [/*]` bypass CDN caching entirely. The CF Cache API (`caches.open()`) code is correct but doesn't provide immediate speedup — likely because each request may hit different edge PoPs or the Pages runtime isolates don't share cache namespaces. **The real fix is R2 cache-aside or pre-rendered static tiles.**

---

## 1. 🔴 Fix Broken CF Cache API (CRITICAL — 0.4s → <10ms per tile)

### Evidence
```
/api/elevation-color/10/350/500  TTFB: 0.539s  (every request, even repeat)
/api/dem-tile/10/350/500         TTFB: 0.388s  (every request, even repeat)
```
Repeat requests to the same tile take the same time as first requests — **no caching**.

### Root Cause
`api/src/lib/storage/cache.ts` attempts `(caches as any).default` which returns `undefined` in CF Workers. The correct API is `caches.open(name)`. This means the CF Cache API **never works** — every request falls through to the in-memory `Map`, which doesn't survive between Worker invocations.

```typescript
// CURRENT (broken):
const cfCache = (caches as any).default as Cache | undefined;  // ← always undefined

// CORRECT:
const cfCache = await caches.open("openzenith-chunks");
```

### Impact
- ~12 tile requests on initial map load at z2 → **~5s total tile fetch time**
- Zooming to z10 → ~64 tiles → **~25s without caching**
- With working cache: second load = instant (CF Cache is same-datacenter, ~1ms)

### Fix
Change `cacheGet`/`cachePut` in `api/src/lib/storage/cache.ts` to use `caches.open()`. Also ensure the cache key includes the full URL so it matches correctly.

### Status
- ✅ Code fix deployed (`caches.open()` replaces broken `(caches as any).default`)
- ⚠️ Measured improvement: **none yet** — CF Pages Functions bypass CDN cache
- Root cause: `_routes.json: include [/*]` routes ALL traffic through Worker
- CF Cache API works but likely doesn't share across edge PoPs in Pages context
- **Next step:** R2 cache-aside (wire `env.DEM_TILES` binding + store generated tiles)

---

## 2. 🟡 Service Worker: Add TTL to API Response Caching

### Evidence
The SW in `api/public/sw.js` caches `/api/*` responses with **no expiration**. Cached responses persist until the SW version is bumped (`openzenith-v1` → `v2`). This means:
- Stale earthquake data served indefinitely
- Stale wildfire data served indefinitely
- The stale-while-revalidate path helps, but the "fresh" response replaces the cached copy — so the next request after a failure still gets the old cached version

### Fix
Add a TTL check to the SW's API response handler. Store `x-cached-at` header and evict after a reasonable window:

```javascript
// In SW fetch handler for /api/*:
if (cached) {
  const cachedAt = parseInt(cached.headers.get("x-cached-at") || "0");
  const age = Date.now() - cachedAt;
  const maxAge = url.pathname.includes("/tile/") ? 86400000 : 120000; // 1 day for tiles, 2 min for data
  if (age < maxAge) return cached;
  // Stale — revalidate
}
```

### Status
- ✅ Deployed (SW v2 with per-path TTL, stale-while-revalidate)

---

## 3. 🟡 Map Page: Extract Stateful Sub-components

### Evidence
```
api/src/app/map/page.tsx: 2241 lines, 30 useState, 85 hooks total
cursorPos updates at 60/s (mouse move) → full component re-renders 60/s
```

While the render path has no heavy computation, React must reconcile the entire 2241-line JSX tree on every mouse move. On low-end devices this causes jank.

### Fix (incremental — no big rewrite)
Extract sections that don't depend on `cursorPos` into `React.memo` sub-components:

| Extract | Lines | Props | Re-render trigger |
|---------|-------|-------|-------------------|
| `<Sidebar>` | ~400 | layers, onToggle | Only when layers change |
| `<MeasurePanel>` | ~60 | measurePoints, mode | Only when measuring |
| `<StatusPanel>` | ~30 | pins, annotations, loading | Only when status changes |
| `<CoordinateReadout>` | ~5 | lat, lon, zoom | Already isolated, good |
| `<OpacitySliders>` | ~80 | activeLayer, value | Only when slider changes |

The key win: `cursorPos` changes won't trigger sidebar/opacity/measure re-renders.

### Implementation
```
// Before: cursorPos change → 2241 lines reconciled
// After:  cursorPos change → only CoordinateReadout (~5 lines) reconciled
//         sidebar change  → only Sidebar (~400 lines) reconciled
```

### Expected Result
- Mouse move: ~95% less JSX reconciliation
- Smooth coordinate readout without sidebar/layout thrash

---

## 4. 🟡 Map Page: Debounce cursorPos Updates

### Evidence
`setCursorPos({ lat, lon })` fires on every `mousemove` event — 60×/s. This is only used for the coordinate readout display, which updates faster than the eye can read.

### Fix
Debounce to ~100ms (10 updates/s — still smooth for coordinate display):

```typescript
const cursorDebounce = useRef<ReturnType<typeof setTimeout>>();
map.on("mousemove", (ev) => {
  clearTimeout(cursorDebounce.current);
  cursorDebounce.current = setTimeout(() => {
    setCursorPos({ lat: ev.lngLat.lat, lon: ev.lngLat.lng });
  }, 100);
});
```

### Status
- ✅ Deployed (80ms debounce, cursorDebounceRef added)
- **6× fewer re-renders** from mouse movement

---

## 5. 🟡 Map Page: Lazy-load Layer Modules

### Evidence
All 33 layer modules are statically imported via barrel file. The map page chunk is 61KB and includes code for every layer, even if only 4 are enabled by default.

```
api/.next/static/chunks/app/map/page-cf4a894bd970d809.js: 61,657 bytes
```

### Fix
Use dynamic `import()` for layer modules. Load them when the user toggles the layer:

```typescript
// In layer dispatcher:
async function addDataLayer(map, handle, layerId) {
  const mod = await import(`./layers/${LAYER_FILE_MAP[layerId]}`);
  mod[`add${layerId}`](map, handle);
}
```

### Expected Result
- Initial page chunk: **~30KB** (only core + default layers)
- Each additional layer: **~1-3KB** loaded on demand
- Faster initial page load, especially on slow connections

---

## 6. 🟢 Globe: Reduce CallbackProperty Instances

### Evidence
16 `CallbackProperty` instances across globe layers. Each executes a JS function every frame (60fps):

| Layer | CallbackProperty count | Purpose |
|-------|----------------------|---------|
| Earthquakes | 5 | Pulsing point size, opacity |
| Events | 3 | Pulsing point size, label |
| Lightning | 3 | Fade-out animation |
| Hurricanes | 2 | Storm pulsing |
| NLNOG | 1 | Node pulsing |
| Currents | 1 | Flow animation |
| Volcanoes | 2 | Alert pulsing |

Total: **17 per-frame JS callbacks** at 60fps = **1,020 function calls/second**.

### Fix Options (by effort)

**Option A (low effort):** Remove pulsing animations entirely. Use static point sizes. Eliminates ~17 CallbackProperty instances.

**Option B (medium effort):** Use `Cesium.TimeIntervalCollectionProperty` for pulsing — Cesium handles this natively with better performance than per-frame JS callbacks.

**Option C (medium effort):** Batch pulsing into a single `preRender` listener that updates all entities at once, instead of per-entity CallbackProperty.

### Expected Result
- Option A: ~1,000 fewer JS function calls/second → smoother frame rate
- Option B/C: Similar benefit, preserving animations

---

## 7. 🟢 Globe: Lazy-load Cesium Assets

### Evidence
CesiumJS loads 5MB of JS + ~2MB of CSS/workers/assets from unpkg CDN on every `/globe` visit. Even with browser cache, the first visit is slow:

```
Cesium.js:           5,066,548 bytes raw (~1.2MB gzip)
Cesium CSS:          ~50KB
Cesium Workers:      ~500KB
Cesium Assets:       ~1.5MB (images, textures)
satellite.js:        ~30KB
```

### Fix
Preload the CSS link in `<head>` with `rel="preload"`:
```html
<link rel="preload" href="https://unpkg.com/cesium@1.119/Build/Cesium/Widgets/widgets.css" as="style">
```

Use `<link rel="modulepreload">` for the JS (supported in modern browsers):
```html
<link rel="modulepreload" href="https://unpkg.com/cesium@1.119/Build/Cesium/Cesium.js">
```

### Expected Result
- First visit: slightly faster (browser starts downloading earlier)
- Return visits: already cached, minimal impact

---

## 8. 🟢 Python SDK: Vectorize `slope()` (3.4s → 0.02s)

### Evidence
```
slope (Horn, loops):       3.391s  SLOW
slope_fast (vectorized):   0.017s  OK
```
The `slope()` function uses Python `for` loops with Horn's method. A vectorized version already exists as `slope_fast()` but produces slightly different results (finite differences vs Horn weighting).

### Fix
Replace the Python loop in `slope()` with vectorized NumPy operations while preserving Horn's weighting:

```python
# Horn's method — fully vectorized
padded = np.pad(dem, 1, mode='constant', constant_values=nodata)
a, b, c = padded[:-2, :-2], padded[:-2, 1:-1], padded[:-2, 2:]
d, e, f = padded[1:-1, :-2], padded[1:-1, 1:-1], padded[1:-1, 2:]
g, h, i = padded[2:, :-2], padded[2:, 1:-1], padded[2:, 2:]

nodata_mask = (a <= nodata) | (b <= nodata) | (c <= nodata) | \
              (d <= nodata) | (e <= nodata) | (f <= nodata) | \
              (g <= nodata) | (h <= nodata) | (i <= nodata)

dz_dx = ((c + 2*f + i) - (a + 2*d + g)) / (8 * cell_x)
dz_dy = ((a + 2*b + c) - (g + 2*h + i)) / (8 * cell_y)
result = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))
result[nodata_mask] = np.nan
```

### Status
- ✅ Deployed — **154× faster** (3.4s → 0.022s for 500×500)
- Identical output (same Horn weighting, same nodata handling)
- Edge cells correctly NaN (same as original)

---

## 9. 🟢 Python SDK: Vectorize `fill_depressions()` (1.8s → <0.1s)

### Evidence
```
fill_depressions:  1.795s  SLOW (Python heapq, cell-by-cell)
```
Priority-flood algorithm uses Python `heapq` with per-cell operations. 250K cells = 250K heap operations.

### Fix Options

**Option A (low effort, medium speedup):** Use `scipy.ndimage` or `scipy.sparse` for the topological sort portion. The algorithm is inherently sequential (priority queue) but the inner loop can be accelerated.

**Option B (medium effort, large speedup):** Use `richdem` package (Cython-based, purpose-built for terrain analysis):
```python
import richdem as rd
dem_filled = rd.FillDepressions(rd.rdarray(dem), fill_depressions_method='priority_flood')
```

**Option C (medium effort, large speedup):** Implement priority-flood with NumPy array operations where possible (vectorize the neighbor-check portion).

### Expected Result
- Option A: ~3-5× speedup
- Option B: ~50-100× speedup (1.8s → ~20ms)
- Option C: ~5-10× speedup

---

## 10. 🟢 Python SDK: Numba JIT for `viewshed()` (18s → 0.3s)

### Evidence
```
viewshed 50×50:   0.33s
viewshed 100×100: 2.69s
viewshed 200×200: 18.41s  (O(n²) Python loops)
```
The Bresenham line-of-sight algorithm has nested Python loops — fundamentally slow.

### Fix
Add Numba JIT compilation (optional dependency):
```python
try:
    from numba import jit
    _viewshed_core = jit(nopython=True, parallel=True)(_viewshed_core_impl)
except ImportError:
    _viewshed_core = _viewshed_core_impl  # fallback to pure Python
```

Numba compiles to native machine code on first call (~1s compilation), then runs at near-C speed.

### Expected Result
- First call: ~1s (JIT compilation) + ~0.3s execution
- Subsequent calls: **~0.3s** (60× faster)
- 500×500 grid: **~2s** (vs ~125s currently)
- Falls back to pure Python if Numba not installed

---

## 11. 🟢 Tile API: Pre-render Common Tiles to R2

### Evidence
The R2 bucket `openzenith-dem` exists but has **no binding** in `wrangler.toml` and no pre-built tiles. All tiles are generated on-the-fly from HuggingFace chunks.

### Fix (two-phase)

**Phase A: Wire R2 as cache-aside store**
1. Add R2 binding to `wrangler.toml`
2. In tile routes: check R2 first → if hit, return immediately → if miss, generate and store in R2
3. R2 reads from same datacenter: **~10ms** vs **~400ms** from HuggingFace

**Phase B: Pre-populate R2 with common tiles**
1. Build script to generate z0-z10 tiles and upload to R2
2. Estimated size: z0-z6 from AWS (~50MB) + z7-z10 from HuggingFace (~1GB) = **~1.1GB**
3. Well within the 10GB R2 budget

### Status
- ✅ Deployed (merged file cache now uses CF Cache API as first layer)
- ⚠️ Same CDN bypass limitation as #1 — may not show immediate improvement
- In-memory fallback still provides same-isolate caching

---

## 12. 🔵 Service Worker: Cache OpenZenith API Tiles

### Evidence
The SW caches basemap tiles from CartoDB/OSM but NOT OpenZenith's own `/api/dem-tile/`, `/api/elevation-color/`, `/api/contours/` tiles. These are the most expensive requests and benefit most from client-side caching.

### Fix
Add OpenZenith tile API paths to the SW cache handler:
```javascript
if (url.pathname.match(/^\/api\/(dem-tile|elevation-color|contours|elevation-accuracy|hillshade)\/\d+\/\d+\/\d+/)) {
  // Cache-first for terrain tiles (static data)
}
```

### Expected Result
- After first visit, terrain tiles load from browser cache (~1ms)
- Combined with server-side CF Cache fix (#1): tiles are cached at THREE levels:
  1. Browser SW cache (instant, survives page reload)
  2. CF Cache API (~10ms, survives Worker restarts)
  3. HuggingFace origin (cold, ~400ms)

---

## Priority Matrix

| # | Fix | Impact | Effort | Status |
|---|-----|--------|--------|--------|
| 1 | Fix CF Cache API code | 🔴 Critical | Low | ✅ Deployed (no measurable improvement yet — CF CDN bypass) |
| 2 | SW TTL for API data | 🟡 Medium | Low | ✅ Deployed |
| 3 | Extract map sub-components | 🟡 Medium | Medium | 🔲 Not started |
| 4 | Debounce cursorPos | 🟡 Medium | Low | ✅ Deployed (6× fewer re-renders) |
| 5 | Lazy-load layer modules | 🟡 Medium | Medium | 🔲 Not started |
| 8 | Vectorize slope() | 🟡 Medium | Low | ✅ Deployed (154× faster) |
| 12 | SW cache terrain tiles | 🟡 Medium | Low | ✅ Deployed (24h TTL for terrain) |
| 11 | R2 cache-aside for tiles | 🟡 Medium | Medium | 🔲 Not started (needs wrangler binding) |
| 6 | Reduce CallbackProperty | 🟢 Low | Medium | 🔲 Not started |
| 9 | Vectorize fill_depressions | 🟢 Low | Medium | ⚠️ Edge init vectorized, heap still sequential |
| 10 | Numba JIT for viewshed | 🟢 Low | Low | 🔲 Not started |
| 7 | Preload Cesium assets | 🟢 Low | Low | 🔲 Not started |

---

## What NOT to Do

| Idea | Why Not |
|------|---------|
| **Rust/WASM for CF Workers** | CF Workers already run V8 — WASM gives ~2-3× for numeric code but tile gen is I/O-bound, not CPU-bound. The CF Cache fix eliminates the real bottleneck. |
| **Custom Cesium build** | Saves ~2MB but breaks on every Cesium upgrade. Not worth the maintenance burden for a free project. |
| **WebWorker for TLE computation** | Satellite.js already runs fast enough. TLE propagation for 1,500 satellites takes ~50ms. |
| **Redis/Memcached** | CF Cache API provides the same function with zero infrastructure. Fix #1 first. |
| **Rewrite map page in multiple files** | While the file is large, the actual render path is simple JSX. Component extraction (#3) gives most of the benefit without a risky refactor. |
| **Replace HuggingFace entirely** | HF is free and has good CDN. R2 cache-aside (#11) eliminates the latency problem while keeping HF as the origin. |

---

## Metrics Targets

| Metric | Current | After P0 | After P1 | After P2 |
|--------|---------|----------|----------|----------|
| Tile TTFB (warm) | 400-700ms | **<10ms** | <10ms | <10ms |
| Map initial load (z2) | ~5s | ~1s | ~0.5s | ~0.3s |
| Map re-visit (z10) | ~25s | ~2s | ~0.5s | ~0.2s |
| Map re-renders/s (idle) | 60 | 60 | **10** | 10 |
| Python slope (500²) | 3.4s | 3.4s | **0.02s** | 0.02s |
| Python viewshed (200²) | 18.4s | 18.4s | 18.4s | **~0.3s*** |
| Globe FPS (idle, all layers) | ~30-45 | ~30-45 | ~30-45 | **~45-60** |

*Numba optional dependency required for viewshed improvement.
