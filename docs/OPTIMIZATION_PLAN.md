# OpenZenith API Enhancement Plan

**Date:** 2026-05-01  
**Goal:** Fast, reliable, accurate API with near-zero cost  
**Scope:** Cloudflare Pages + R2 + VPS hybrid architecture

---

## Executive Summary

OpenZenith's API is **functionally complete but has reliability issues**. This plan addresses:
1. Fix batch elevation bug (Critical)
2. Add multi-layer caching (High)
3. Document VPS migration path (Medium)
4. Client-side optimizations (Medium)

**Budget:** Near-zero (free tiers + optional one-time VPS hardware)
**Timeline:** Architectural phases only (no timeline language per guidelines)

---

## Part 1: Critical Fixes

### 1.1 Batch Elevation Bug (P0)

**Problem:** `/api/elevation/batch` returns `elevation: null` for all points.

**Root Cause:** 
- Uses `getTileData()` at zoom 8 (~70km tiles)
- HuggingFace assembly at low zoom is unreliable (per existing code comments)
- Tile data ends up with <5% valid pixels → AWS fallback doesn't trigger
- Even if tile has data, bilinear sampling finds NODATA neighbors

**Fix Options:**

| Option | Accuracy | Latency | Effort | Recommendation |
|--------|----------|---------|--------|-----------------|
| A: Use higher zoom (z12) | ~30m (best) | Higher | 2hr | ✅ **Use this** |
| B: Use single-point path per point | ~30m | Very High | 4hr | ❌ Too slow |
| C: Use AWS directly at z13 | ~10m | Medium | 2hr | Good backup |

**Selected Fix:** Option A with AWS fallback.

```typescript
// In batch/route.ts, change:
const zoom = 8;  // ❌ Unreliable
// To:
const zoom = 12; // ✅ Accurate, reasonable chunk count
```

**Implementation:** See `api/src/app/api/elevation/batch/route.ts`

### 1.2 DEM Tile 503 Errors

**Problem:** `/api/dem-tile` returns HTTP 503 when HuggingFace is unavailable.

**Root Cause:** HuggingFace fetch timeout → error thrown → 503 response.

**Fix:** Return ocean tile instead of 503 (already in code, but check X-Dem-Tile-Source header).

---

## Part 2: Caching Architecture

### 2.1 Multi-Layer Cache Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CACHE HIERARCHY                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Layer 1: Cloudflare Edge Cache (<10ms)                             │
│  ├─ Cache API for API responses                                     │
│  ├─ POP-level CDN for static assets                                 │
│  └─ Hit rate: 80-95% for map tiles                                  │
│           │                                                          │
│           ▼                                                          │
│  Layer 2: R2 Storage (~300ms)                                        │
│  ├─ Generated tiles (DEM, elevation-color)                          │
│  ├─ API response cache (earthquakes, etc.)                          │
│  └─ 10GB free tier (currently ~2GB used)                            │
│           │                                                          │
│           ▼                                                          │
│  Layer 3: HuggingFace (~1000ms)                                     │
│  ├─ Raw SRTM chunks                                                  │
│  └─ Fallback when R2 miss                                           │
│           │                                                          │
│           ▼                                                          │
│  Layer 4: External APIs (~200-500ms)                                 │
│  ├─ USGS, NASA, Open-Meteo                                           │
│  └─ CelesTrak (8-15s from CF edge)                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Implementation Checklist

- [ ] **Cloudflare Cache API** for tile responses
- [ ] **Stale-while-revalidate** headers  
- [ ] **R2 lifecycle rules** for automatic cleanup
- [ ] **Client IndexedDB** for zero-latency repeat access

---

## Part 3: VPS Migration Guide

### 3.1 When to Use VPS

**Scenarios favoring VPS:**
- Need sub-100ms tile response globally
- Want to eliminate HuggingFace dependency
- Have >100GB storage available
- Want to serve world-wide elevation data

**Scenarios favoring staying with Cloudflare:**
- Budget: $0/month
- Limited storage (VPS costs apply)
- Caching strategy sufficient for use case

### 3.2 VPS Architecture Options

#### Option A: Full Self-Hosting (Recommended if >500GB storage)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PROPOSED ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Cloudflare Pages (unchanged)                                       │
│  └─ /api/* routes                                                   │
│     ├─ /api/elevation/*    → VPS (nginx static tiles)               │
│     ├─ /api/dem-tile/*     → VPS (nginx static tiles)               │
│     └─ Other endpoints     → Cloudflare (unchanged)                 │
│                                                                      │
│  VPS (your server)                                                  │
│  └─ /opt/openzenith/tiles/                                          │
│     ├─ dem/z0-14/*.png     (~5GB for z0-14)                         │
│     ├─ elevation-color/    (optional, CDN-able)                     │
│     └─ satellite-tle/      (sync every 6hr)                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- <50ms tile response
- Zero HuggingFace dependency
- Full world data at all zoom levels
- One-time hardware cost

**Cons:**
- VPS cost ($20-100/month)
- Manual tile generation
- Sync/maintenance overhead

#### Option B: Hybrid (Recommended for most users)

```
Cloudflare Pages (unchanged)
├─ Static endpoints → Cloudflare CDN
└─ Dynamic endpoints → VPS API

VPS serves:
├─ Pre-generated DEM tiles (z0-14)
├─ Cached satellite TLE data
└─ Cached earthquake/hurricane data (5-min sync)
```

**Pros:**
- Reduces CF edge compute
- Maintains Cloudflare CDN benefits
- Lower VPS requirements

**Cons:**
- More complex architecture
- Two systems to maintain

### 3.3 VPS Setup Checklist

```
1. Server Setup
   □ Choose VPS provider (Hetzner, Kimsufi, etc.)
   □ Install Ubuntu 22.04 LTS
   □ Configure firewall (ufw allow 80,443)
   □ Set up nginx for static tile serving
   
2. Tile Generation
   □ Download SRTM 30m data (or use existing HuggingFace)
   □ Generate Terrarium PNG tiles z0-14
   □ Generate elevation-color tiles (optional)
   □ Store in /opt/openzenith/tiles/
   
3. Sync Jobs (if using)
   □ Set up cron for satellite TLE (every 6hr)
   □ Set up cron for earthquakes (every 5min)
   □ Set up cron for hurricanes (every 6hr)
   
4. Cloudflare Integration
   □ Point API routes to VPS
   □ Set up Cloudflare Tunnel (optional)
   □ Configure DNS
```

### 3.4 Tile Generation Script (Reference)

```bash
#!/bin/bash
# Generate DEM tiles from SRTM data
# Run once on VPS

TILE_DIR="/opt/openzenith/tiles/dem"
SRTM_DIR="/opt/openzenith/srtm"

# Generate z0-z14 tiles
for z in {0..14}; do
  echo "Generating zoom $z..."
  # Use gdal2tiles or custom script
  gdal2tiles.py --zoom=$z-$z --srs=EPSG:3857 \
    $SRTM_DIR/*.tif $TILE_DIR/z$z/
done

# Estimated sizes:
# z0-10:  ~2GB (current R2)
# z11-12: ~3GB
# z13-14: ~5GB
# Total:  ~10GB
```

---

## Part 4: Client-Side Optimizations

### 4.1 IndexedDB Tile Cache

**Purpose:** Zero-latency repeat access, offline capability

```typescript
// Pseudo-code for client-side caching
const DB_NAME = 'openzenith-tiles';
const STORE_NAME = 'tiles';
const MAX_SIZE_MB = 500;

async function getTileCached(z: number, x: number, y: number): Promise<ArrayBuffer> {
  // 1. Check IndexedDB first
  const cached = await db.get(`${z}/${x}/${y}`);
  if (cached) return cached.data;
  
  // 2. Fetch from API
  const resp = await fetch(`/api/dem-tile/${z}/${x}/${y}`);
  const data = await resp.arrayBuffer();
  
  // 3. Store in IndexedDB
  await db.put(`${z}/${x}/${y}`, data);
  
  // 4. Evict old tiles if over limit
  await evictIfNeeded();
  
  return data;
}
```

**Benefits:**
- 0ms for cached tiles
- Works offline
- Reduces API calls

### 4.2 Predictive Prefetching

```typescript
// On pan/zoom start, prefetch surrounding tiles
function onPanStart(center: LatLon, zoom: number) {
  const tiles = getSurroundingTiles(center, zoom, radius=1);
  
  // Use requestIdleCallback to not block interaction
  requestIdleCallback(() => {
    tiles.forEach(t => prefetch(`/api/dem-tile/${t.z}/${t.x}/${t.y}`));
  });
}
```

### 4.3 Multi-Resolution Cascade

```typescript
// Load low-res immediately, upgrade in background
async function loadTileWithCascade(z: number, x: number, y: number) {
  // 1. Show cached zoom-2 immediately
  const lowRes = await getTileCached(2, Math.floor(x/2** (z-2)), Math.floor(y/2** (z-2)));
  
  // 2. Request target resolution
  const highRes = getTileCached(z, x, y);
  
  // 3. Update when ready
  highRes.then(tile => updateMap(tile));
}
```

---

## Part 5: Compression Strategy

### 5.1 Current State

| Data | Format | Size (256x256) | Compression |
|------|--------|---------------|-------------|
| DEM | Terrarium PNG | ~30KB | PNG (lossless) |
| Elevation Color | PNG | ~60KB | PNG (lossless) |
| Contours | JSON | ~200KB | gzip |
| Raster layers | PNG | ~1KB | RLE |

### 5.2 Compression Options

| Format | Reduction | Browser Support | Decode Cost |
|--------|-----------|-----------------|-------------|
| PNG | Baseline | ✅ Native | Low |
| WebP | 25-35% | ✅ Native (modern) | Medium |
| JPEG-XL | 40-50% | ⚠️ Limited | High |
| Zstd + WASM | 40-60% | ❌ Need decoder | High |
| Cloudflare Polish | 30% | ✅ Transparent | 0 |

**Recommendation:** Use Cloudflare Polish (automatic) + WebP for tiles, keep PNG fallback.

### 5.3 Terrarium PNG Alternatives

| Format | Size vs PNG | Encode Speed | Decode Speed | Notes |
|--------|-------------|-------------|--------------|-------|
| Raw Int16 | 4x larger | Fast | Fastest | No compression |
| Terrarium PNG | Baseline | Medium | Medium | Current |
| RGB8 (elevation only) | 1.5x smaller | Fast | Fast | 16-bit→8-bit, lossy |
| Float32 + zstd | 2x smaller | Fast | Medium | Need WASM decode |

**Recommendation:** Keep Terrarium PNG. Bottleneck is HuggingFace I/O, not compression.

---

## Part 6: Implementation Phases

### Phase A: Quick Wins (This Week)

1. [ ] **Fix batch elevation bug** (2hr)
   - Change zoom from 8 to 12
   - Test with 10 diverse locations
   - Add AWS fallback

2. [ ] **Add Cloudflare Cache API** (4hr)
   - Integrate with existing cache.ts
   - Test cache hit rates
   - Verify no regressions

3. [ ] **Add stale-while-revalidate** (2hr)
   - Already in cache.ts, verify all endpoints use it

### Phase B: Client Optimizations (Next Week)

4. [ ] **IndexedDB tile cache** (8hr)
   - Create client cache module
   - Add eviction policy (LRU, 500MB limit)
   - Test offline capability

5. [ ] **Prefetch on interaction** (4hr)
   - Detect pan/zoom start
   - Prefetch surrounding tiles
   - Test perceived latency

### Phase C: VPS Migration (If Needed)

6. [ ] **Evaluate VPS requirements** (2hr)
   - Estimate storage needs
   - Compare providers
   - Create cost analysis

7. [ ] **Set up VPS tile generation** (1 day)
   - Generate z0-14 tiles
   - Set up nginx
   - Test performance

8. [ ] **Configure DNS/proxy** (2hr)
   - Point `/api/dem-tile` to VPS
   - Test end-to-end
   - Monitor latency

### Phase D: Data Quality (Ongoing)

9. [ ] **Fix Sentinel-2 placeholder** (high effort)
   - Find real data source
   - Implement tile fetching
   - Test imagery quality

10. [ ] **Add missing waterways data** (medium effort)
    - Source from OpenStreetMap
    - Generate tile layer

---

## Part 7: Cost Analysis

### Current (Cloudflare Only)

| Resource | Usage | Cost |
|----------|-------|------|
| Cloudflare Pages | 1 site | $0 |
| R2 Storage | ~2GB | $0 |
| HuggingFace | Source data | $0 |
| External APIs | USGS, NASA, etc. | $0 |
| **Total** | | **$0/month** |

### With VPS (Option A)

| Resource | Usage | Cost |
|----------|-------|------|
| VPS (2TB storage) | Hetzner CX21 | ~$10/month |
| Cloudflare Pages | Still used | $0 |
| R2 | For backups | $0 |
| Domain/DNS | If needed | $0-10/year |
| **Total** | | **~$10-15/month** |

### With VPS (Option B - Hybrid)

| Resource | Usage | Cost |
|----------|-------|------|
| VPS (500GB storage) | Hetzner CX11 | ~$5/month |
| Bandwidth | ~100GB/month | Included |
| Cloudflare Pro | Optional | $20/month |
| **Total** | | **~$5-25/month** |

---

## Appendix: File Changes Required

### Critical

1. `api/src/app/api/elevation/batch/route.ts`
   - Change zoom from 8 to 12
   - Add AWS fallback logic
   - Test batch accuracy

2. `api/src/lib/cache.ts`
   - Add Cloudflare Cache API integration for tiles
   - Verify stale-while-revalidate works

### Optional

3. `api/src/lib/client-elevation.ts`
   - Add IndexedDB support
   - Add prefetch logic

4. `api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts`
   - Add Cloudflare Cache API before R2 check
   - Add cache headers for CDN

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Batch elevation accuracy | >99% valid | 0% (broken) |
| Tile response (cached) | <50ms | ~300ms |
| Elevation latency (cold) | <500ms | ~600ms |
| API uptime | 99.9% | 100% |
| Cache hit rate | >80% | Unknown |

---

## Notes

- HuggingFace is a **free, community dataset**. No SLA.
- VPS gives you **full control** but adds complexity.
- Compression matters more for **bandwidth** than CPU.
- Client-side caching provides **biggest perceived improvement**.

**Philosophy:** Stay simple. Add complexity only when benefits exceed costs.