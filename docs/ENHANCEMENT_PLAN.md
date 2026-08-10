# OpenZenith Enhancement Plan — Post-Session Audit

Generated from systematic fan-out audit of Python SDK, Rust core, and frontend.

---

## Priority Matrix

| Priority | Item | Area | Est. Impact |
|---|---|---|---|
| CRITICAL | Fix bare `except Exception` swallows (Python) | Errors | Correctness |
| CRITICAL | Fix `load_elevation_grid` pixel loop vectorization | Perf | 50-100x speedup |
| HIGH | Fix viewshed bilinear nodata bug (Rust) | Correctness | Bug fix |
| HIGH | Add `stream_order` Python binding + CLI | Feature | Hydrology |
| HIGH | Add `gradient_predict` CLI + Python binding | Feature | OZT2 encode |
| MEDIUM | Add `OZT2HFBackend` async variants | Perf | I/O overlap |
| MEDIUM | Vectorize `tpi`/`tri`/`roughness` neighbor loops | Perf | 5-10x |
| MEDIUM | Vectorize viz.py `_palette_color` per-vertex calls | Perf | 5-10x |
| MEDIUM | Fix Rust viewshed test "blocks behind hill" | Tests | Correctness |
| MEDIUM | Add Rust tests for stream_order, flow_accum edge cases | Tests | Coverage |
| LOW | Fix TypeScript `any` refs in globe page | Types | Maintainability |
| LOW | Add client-side cache (stale-while-revalidate) | Perf | Reduced re-fetch |
| LOW | Add GPS-jamming / space-weather / coverage API routes | Feature | Missing endpoints |
| LOW | Fix WASM demo to fetch real OZT2 tiles | Feature | Demo quality |
| LOW | Fix WASM memory management (try/finally) | Correctness | No leaks |
| LOW | Add `tpi`, `roughness`, `curvature` CLI commands | Feature | Terrain indices |

---

## CRITICAL: Python Error Handling — Bare `except Exception` Swallows

**Files with silent exception swallows** (16 occurrences):

| File | Line | Context |
|---|---|---|
| `elevation.py` | 102 | `get_elevation()` — zoom loop, decode/open errors |
| `elevation.py` | 292 | `load_elevation_grid()` — tile read errors |
| `elevation.py` | 419 | `_get_elevation_from_ozt2()` — tile decode |
| `fuse.py` | 281 | `FusedDEM._srtm_elevation()` — merged file read |
| `fuse.py` | 368 | `FusedDEM._gebco_from_http()` — network errors |
| `tracing.py` | 242 | `_load_grid_at()` — load_elevation_grid errors |
| `backends/ozt2.py` | 57, 200, 210, 272, 295, 319, 335, 369 | All backends swallowing errors |

**Fix approach:**
- Define `OpenZenithError(Exception)` base class in `__init__.py`
- Subclass: `TileNotFoundError`, `TileDecodeError`, `NetworkError`, `DataError`
- Replace each `except Exception: continue` with:
  - Specific exception type catching
  - A warning log (using stdlib `logging`)
  - Re-raise as SDK-specific type or skip with debug log
- In backends: `TileNotFoundError` → return None (expected); `TileDecodeError` → log+skip; `NetworkError` → retry once

---

## CRITICAL: Python Perf — `load_elevation_grid` Pixel Loop

**File:** `openzenith/elevation.py` lines 301-313

Current nested loop copies tile data pixel-by-pixel:
```python
for gy in range(th):
    for gx in range(tw):
        val = tile_data[gy, gx]
        if not math.isnan(val):
            grid[local_y, local_x] = val
```

**Fix:** Replace with vectorized slice assignment:
```python
valid = ~np.isnan(tile_data)
valid_masked = np.where(valid)
gy_vals, gx_vals = valid_masked[0], valid_masked[1]
ly = gy_vals - (global_y_start - min_pixel_y)
lx = gx_vals - (global_x_start - min_pixel_x)
within_grid = (ly >= 0) & (ly < grid_rows) & (lx >= 0) & (lx < grid_cols)
grid[ly[within_grid], lx[within_grid]] = tile_data[gy_vals[within_grid], gx_vals[within_grid]]
```
Or simpler: compute the target slice ranges and use direct slice assignment if tile is fully within grid bounds.

---

## HIGH: Rust Viewshed Bilinear Nodata Bug

**File:** `core/src/viewshed.rs` lines 98-116

Current code averages valid corners when nodata is present. True bilinear interpolation weights each corner by its fractional distance from the sample point. The current approach systematically overestimates elevation at land/nodata boundaries.

**Fix:** Use proper bilinear weights — when nodata corners exist, compute weighted average using only valid corners with proper fractional distance weighting.

---

## HIGH: `stream_order` and `gradient_predict` CLI/Python Binding

**File:** `core/src/lib.rs`

Missing from Python `__init__.py` and CLI:
- `stream_order` — Strahler stream order from flow accumulation
- `gradient_predict` — OZT2 encode (gradient prediction)
- `left_reconstruct` — available in CLI but not Python

**Fix:**
1. Add `stream-order` CLI command in `main.rs`
2. Add `gradient-predict` CLI command in `main.rs`
3. Add `stream_order` and `gradient_predict` to Python `__init__.py` `__all__`
4. Add `stream_order` and `left_reconstruct` to `__all__`

---

## MEDIUM: Async `OZT2HFBackend`

**File:** `openzenith/backends/ozt2.py`

`OZT2HFBackend` is sync. `prefetch_tiles()` downloads sequentially.

**Fix:**
- Add `fetch_tile_async()` using `aiohttp`
- Add `prefetch_tiles_async()` using `asyncio.gather()` with semaphore
- Make existing sync methods call async variants via `asyncio.run()` for backward compat

---

## MEDIUM: Terrain Neighbor Loop Vectorization

**Files:** `openzenith/terrain.py`

- `tpi()` lines 502-506: double Python loop collecting 8 neighbor slices
- `tri()` lines 714-719: same pattern for Terrain Ruggedness Index
- `roughness()` lines 536-539: same pattern

**Fix:** Pre-compute all 8 neighbor windows as a single (8, rows, cols) array using vectorized slicing, then use `np.mean(..., axis=0)` for TPI. For TRI/roughness: stack all differences into (8, rows, cols) and compute `np.mean(np.abs(...), axis=0)`.

---

## MEDIUM: Viz Palette Lookup Vectorization

**File:** `openzenith/viz.py`

`terrain_to_glb()` calls `_palette_color()` per vertex (line 443-458). 100k vertices = 100k function calls.

**Fix:** Apply `np.searchsorted` on full elevation array once, then slice into vertex color array — same pattern as the already-vectorized `terrain_to_png`.

---

## Implementation Order

1. ✅ Python: Custom exception hierarchy (`OpenZenithError`, `TileNotFoundError`, `TileDecodeError`, `NetworkError`) — add to `__init__.py`
2. ✅ Python: Replace bare `except` swallows in `elevation.py`, `fuse.py`, `tracing.py`, `backends/ozt2.py` with structured logging + typed exceptions
3. ✅ Python: Vectorize `load_elevation_grid` pixel loop in `elevation.py`
4. ✅ Python: Vectorize `tpi`, `tri`, `roughness` neighbor loops in `terrain.py`
5. ✅ Python: Vectorize `viz.py` `_palette_color` per-vertex calls
6. ✅ Rust: Fix viewshed bilinear nodata bug in `viewshed.rs`
7. ✅ Rust: Add `stream_order` and `gradient_predict` CLI commands
8. ✅ Rust: Add Python bindings for new Rust functions
9. ✅ Rust: Improve Rust tests (viewshed "blocks behind hill", stream_order correctness, edge cases)
10. ✅ Python: Add `tpi`, `roughness`, `curvature` CLI commands
11. ✅ Python: Add `OZT2HFBackend` async variants

---

## Verification

```bash
# Python tests
pytest openzenith/tests/ -q --timeout=60

# Rust tests
cd core && cargo test

# Clippy
cargo clippy --workspace --all-targets -- -D warnings
```
