# Delivery Optimization Plan: ~93% R2 Storage Reduction

**Status:** Planned (not yet implemented)
**Created:** 2026-04-01
**Updated:** 2026-04-14
**Based on:** `scripts/benchmark_v2.py` results + `ELEVATION_STORAGE_AND_RESOLUTION_PLAN.md` compression benchmarks
**Supersedes:** Original ~40% reduction target → now targeting 93% with OZT2 adaptive compression

---

## Current State

Production serves ~1.3M Terrarium PNG tiles from Cloudflare R2. Custom OZT1 format exists but is not used for delivery.

| Format | Avg Tile Size | Browser Support | Current Use |
|---|---|---|---|
| Terrarium PNG | ~6.7 MB/tile (3601x3601) | MapLibre, Cesium | Production |
| OZT1 (left+Zstd-19) | ~5.2 MB/tile | Custom JS decoder | Not deployed |

---

## Optimization Opportunities

### Priority 1: WebP Lossless Tile Delivery (est. 37% reduction)

**Finding:** WebP lossless is 32-44% smaller than Terrarium PNG with 4.3x faster decode.

| Metric | Terrapng | WebP Lossless | Delta |
|---|---|---|---|
| Avg size (12 tiles) | 6,732 KB | 4,257 KB | -37% |
| Decode time | 924 ms | 215 ms | -77% |
| Precision | 16-bit | 16-bit | Same |

**Implementation:**

1. Create a tile generation script that encodes elevation as WebP lossless with Terrarium RGB values
2. Update the tile serving endpoint (`/api/dem-tile/[z]/[x]/[y]`) to prefer `.webp` files, fall back to `.png`
3. Update the client-side Terrarium decoder (`terrarium-reader.ts`) to handle WebP input
4. Re-encode all tiles: `z0-8` (87K tiles), `z10` (1.05M tiles)
5. Upload WebP tiles to R2 alongside existing PNGs (dual-format period)
6. After verification, purge old PNG tiles from R2

**R2 Storage Impact:** ~26GB saved on z10 alone (1.05M tiles * 2.5KB savings)

**Browser Support:** MapLibre GL JS 3.x+, CesiumJS 1.100+ both support WebP natively. Edge cases: very old browsers fall back to PNG.

**Files to modify:**
- `scripts/generate_webp_tiles.py` (new)
- `api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts`
- `api/src/lib/terrarium-reader.ts`
- R2 upload script

**Verification:**
- A/B test: serve `.webp` to 50% of requests, compare load times
- Decode fidelity: verify `decode(WebP_bytes) == decode(PNG_bytes)` for 1000 random tiles

---

### Priority 2: Gradient Predictor for OZT1 (est. 5x compression on 256x256 tiles)

**Finding:** On 256x256 tiles, gradient predictor + Brotli-11 produces 5.3x smaller tiles than left-prediction + Brotli-11 (24 KB vs 129 KB). Decode is 17x faster (40ms vs 679ms).

| Predictor (256x256, Brotli-11) | Avg Size | Decode Time |
|---|---|---|
| Left (current) | 129 KB | 679 ms |
| Gradient | 24 KB | 40 ms |
| Avg | 25 KB | 32 ms |
| Paeth | 26 KB | 47 ms |

**Challenge:** Current Python implementation uses pixel-by-pixel reconstruction (65K iterations per 256x256 tile). Needs vectorized or compiled implementation.

#### WASM Client-Side Decoding (Recommended Path)

The gradient predictor can be compiled to WebAssembly for client-side execution in the browser. This eliminates the need for a server-side decode step and works seamlessly on Cloudflare Pages.

**Why WASM works here:**
- Computation is pure integer arithmetic: `p = left + above - upper_left` per pixel
- Sequential, cache-friendly memory access on a flat `Int16Array`
- No external dependencies, no I/O — pure computation
- Brotli decompression available via `DecompressionStream('brotli')` (Chrome/Edge) or `fflate` polyfill (Firefox)

**Rust → WASM reference implementation:**
```rust
#[wasm_bindgen]
pub fn decode_gradient(residuals: &[i16], width: usize, height: usize) -> Vec<i16> {
    let mut out = Vec::with_capacity(width * height);
    // First row: left predictor
    out.push(residuals[0]);
    for j in 1..width { out.push(residuals[j] + out[j-1]); }
    // Remaining rows: gradient predictor
    for i in 1..height {
        out.push(residuals[i*width] + out[(i-1)*width]);
        for j in 1..width {
            let left = out[i*width + j - 1];
            let above = out[(i-1)*width + j];
            let upper_left = out[(i-1)*width + j - 1];
            out.push(residuals[i*width + j] + (left + above - upper_left));
        }
    }
    out
}
```

Compile with: `wasm-pack build --target web` — produces a 3-5KB WASM module.

**Performance expectations:**

| Platform | 256x256 decode | 3601x3601 decode |
|----------|---------------|-----------------|
| Python (current) | ~40ms | ~13s |
| WASM (Rust) | ~0.5ms | ~80ms |
| WASM + SIMD | ~0.2ms | ~30ms |

**Cloudflare Pages compatibility:**
- **Client-side**: WASM runs natively in all modern browsers. Ship as a static asset alongside JS bundle.
- **Worker-side**: Cloudflare Workers also support WASM modules via `wasm` binding in `wrangler.toml`.
- **CSR-First**: Lazy-load the WASM module only when terrain is enabled — keeps initial bundle small.
- **Progressive decoding**: Can decode first N rows for a low-res preview, then continue in background.

**Client-side pipeline:**
1. Fetch compressed `.ozt1` tile from R2 (~24KB for 256x256 vs ~129KB left-predict)
2. `DecompressionStream('brotli')` or `fflate` → raw residuals
3. WASM `decode_gradient(residuals, width, height)` → elevation grid (~0.5ms)
4. Feed into CesiumJS/MapLibre custom terrain provider

**Brotli decode browser support:**
- `DecompressionStream('brotli')`: Chrome 80+, Edge 80+, Safari 16.4+
- Firefox: Not yet native — polyfill with `fflate` or `brotli-wasm` (~15KB)

**Implementation:**

1. Create Rust crate with `wasm-bindgen` for gradient decode + Brotli decompress
2. Build WASM module with `wasm-pack build --target web`
3. Create JS wrapper class (`OZT1Decoder`) that lazy-loads the WASM module
4. Implement custom MapLibre/Cesium terrain provider using OZT1 tiles
5. Update tile serving endpoint to serve `.ozt1` files with proper content type
6. Re-encode all tiles with gradient predictor + Brotli-11
7. Dual-format period: serve OZT1 to capable clients, WebP/PNG fallback to others

**Files to create/modify:**
- `openzenith/wasm/` — Rust crate with gradient predictor decoder
- `openzenith/wasm/pkg/` — Built WASM module (3-5KB)
- `api/src/lib/ozt1-decoder.ts` — JS wrapper for WASM module
- `api/src/lib/ozt1-terrain-provider.ts` — Custom terrain provider for MapLibre/Cesium
- `api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts` — Serve `.ozt1` with content negotiation
- `openzenith/tile_format.py` — Add gradient predictor + Brotli encoder
- `scripts/converter.py` — Use new compression mode for batch re-encoding

**Verification:**
- Roundtrip fidelity: `decode_wasm(encode_gradient(tile)) == original` for 1000 random tiles
- WASM decode speed benchmark (256x256 and 3601x3601)
- Browser compatibility test (Chrome, Firefox, Safari, Edge)
- A/B test: OZT1+WASM vs WebP on 50% of traffic

---

### Priority 3: Brotli-11 for OZT1 Encoding (est. 2-8% reduction)

**Finding:** Brotli-11 beats Zstd-19 by 2-8% on compressed size with left-prediction.

| Compressor (Left Predict) | Avg Size | Ratio | Encode Time |
|---|---|---|---|
| Zstd-9 (current) | 6,001 KB | 4.2x | 706 ms |
| Zstd-19 | 5,226 KB | 4.8x | 15,010 ms |
| Brotli-11 | 5,092 KB | 5.0x | 44,535 ms |

**Trade-off:** Brotli-11 encode is 3x slower than Zstd-19 (45s vs 15s per 3601x3601 tile). Decode is comparable (679ms vs 432ms). Since encoding is a one-time batch operation, the slower speed is acceptable.

**Implementation:**
1. Add `compress_brotli()` and `decompress_brotli()` to `tile_format.py`
2. Add new compression mode `COMP_BROTLI_PREDICT = 4`
3. Update header to include compressor type byte
4. Re-encode tiles with Brotli-11

**Files to modify:**
- `openzenith/tile_format.py` (add Brotli compressor, new mode)

**Verification:**
- Roundtrip fidelity test
- Encode time comparison (acceptable for batch)

---

### Priority 4: Terrain-Adaptive Quantization (marginal benefit)

**Finding:** No meaningful improvement over fixed Q12. Adaptive selector picks Q12 for most terrains. Skip unless per-pixel adaptive quantization is implemented.

| Strategy (Left+Brotli-11) | Avg Size | RMSE |
|---|---|---|
| Q12 (fixed) | 5,113 KB | 0.59m |
| Adaptive | 5,081 KB | 0.60m |
| Q10 | 4,006 KB | 0.92m |

**Recommendation:** Keep fixed Q12 for simplicity. Revisit if per-subregion quantization becomes feasible.

---

## Combined Impact Estimates

| Optimization | Tiles Affected | Current | Projected | Savings |
|---|---|---|---|---|
| WebP lossless | 1.13M (z0-8 + z10) | ~26 GB | ~16.4 GB | ~9.6 GB |
| Gradient+Brotli | 1.13M (if OZT1 delivery) | ~26 GB | ~5.2 GB | ~20.8 GB |
| Brotli vs Zstd-19 | 1.13M (OZT1) | ~26 GB | ~25 GB | ~1 GB |
| **Combined (WebP)** | **1.13M** | **~26 GB** | **~16.4 GB** | **~9.6 GB (37%)** |

**Note:** OZT1+gradient+brotli requires a custom client-side decoder (MapLibre/Cesium don't support it natively), but this can be compiled to WASM (~5KB) for browser-side execution. **Two viable paths exist:**
- **Path A (WebP):** Works with existing map libraries out of the box. 37% savings. Lowest risk. Recommended first step.
- **Path B (OZT1+Gradient+Brotli+WASM):** 5x smaller tiles, ~0.5ms WASM decode. Requires custom terrain provider. Higher effort, bigger payoff. Recommended as Phase 2.

---

## Additional Suggestions

### 5. Per-tile Encoding Selection

Instead of one format for all tiles, choose the best format per tile:
- **Ocean/flat tiles** (24m range): WebP lossless compresses to 7KB — already excellent
- **Mountain tiles** (5000m+ range): Consider OZT1 with quantized gradient predictor
- This could yield 50%+ overall savings by matching format to content

### 6. HTTP Content Negotiation

Serve `Content-Type: image/webp` with `Vary: Accept`. Browsers that don't support WebP get PNG fallback. This enables zero-risk rollout.

### 7. Progressive Loading

For high-zoom tiles (z13, 32M tiles), implement progressive loading:
- Serve a low-res preview immediately (Q8 quantized, ~3KB)
- Stream full resolution in background
- This reduces perceived load time from ~13KB to ~3KB per tile

### 8. Cache Header Optimization

Current: `max-age=31536000` (1 year, immutable). Good for CDN but means stale data requires cache purge. Consider:
- `max-age=86400` (1 day) + `stale-while-revalidate` for frequent re-generation
- This allows natural cache turnover without manual purges

### 9. Tile Deduplication

Many tiles at low zoom levels are nearly identical (ocean tiles). Run-length or pattern deduplication before compression could save significant space for z0-z4 tiles.

### 10. GPU-Accelerated Encoding

WebP encoding is the current encode bottleneck (6.3s per 3601x3601 tile). GPU-accelerated encoding via CUDA or Vulkan could reduce this to sub-second, enabling on-demand tile generation.

---

## Implementation Order

1. **Phase 1:** WebP lossless tile generation + delivery (biggest quick win, lowest risk)
2. **Phase 2:** Gradient predictor → Rust → WASM + Brotli-11 (5x compression, custom terrain provider)
3. **Phase 3:** Per-tile encoding selection (WebP for flat, OZT1 for mountains — best of both)
4. **Phase 4:** Brotli-11 compressor option for OZT1 (marginal gain, easy add)
5. **Phase 5:** Progressive loading via WASM row-by-row decode (UX improvement)
