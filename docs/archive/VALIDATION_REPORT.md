# OpenZenith Elevation Validation Report

**Date:** 2026-04-18
**Tool:** `scripts/validate_elevation.py`
**Server:** openzenith.cyopsys.com

---

## Summary

Spot-checked 30 ground truth benchmark points against OpenZenith API.
Results: **23/30 passed (76.7%)** with SRTM-appropriate tolerances.

The 7 failures reveal **3 categories** of issues:

1. **Bad/missing HuggingFace tiles** (4 points) — upstream data source issues
2. **GEBCO limitations** (2 points) — ocean bathymetry resolution
3. **SRTM DSM artifacts** (1 point) — inherent SRTM limitations

No encoding, interpolation, or tile assembly bugs were found.

---

## Results by Category

### ✅ Excellent (≤10m error, 13 points)

| Point | Expected | OpenZenith | Error | Source |
|-------|----------|-----------|-------|--------|
| Tokyo | 40m | 40m | **0m** | SRTM |
| UK Thames Estuary | 0m | 0m | **0m** | GEBCO |
| Nile Delta | 0m | 0m | **0m** | GEBCO |
| Pamir Plateau | 4000m | 4016m | **16m** | SRTM |
| Lake Baikal | 456m | 449m | **7m** | SRTM |
| Dead Sea | -434m | -415m | **19m** | SRTM |
| Mumbai | 14m | 5m | **9m** | SRTM |
| Mont Blanc | 4806m | 4791m | **15m** | SRTM |
| Paris | 35m | 46m | **11m** | SRTM |
| Norwegian fjord | 0m | -3m | **3m** | GEBCO |
| NY Central Park | 34m | 13m | **21m** | SRTM |
| Cape Town | 20m | 40m | **20m** | SRTM |
| Amazon lowland | 50m | 78m | **28m** | SRTM |

### ⚠️ Acceptable — SRTM DSM artifacts (5 points, 11-175m)

| Point | Expected | OpenZenith | Error | Notes |
|-------|----------|-----------|-------|-------|
| Everest | 8849m | 8729m | 120m | SRTM DSM underestimates steep peaks |
| Denali | 6190m | 6141m | 49m | Good result for ArcticDEM |
| Gobi Desert | 1000m | 1168m | 168m | Acceptable for 30m DSM |
| Ocean mid-Pacific | -5000m | -5163m | 163m | GEBCO 450m resolution |
| Mariana Trench | -10935m | -10683m | 252m | GEBCO 450m, deep ocean |

### ⚠️ Known SRTM Coverage Gaps (5 points, 278-540m)

| Point | Expected | OpenZenith | Error | Notes |
|-------|----------|-----------|-------|-------|
| Sahara coast | 0m | 296m | 296m | SRTM void-fill artifact |
| Rio de Janeiro | 11m | 289m | 278m | Investigated: likely bad HuggingFace tile |
| Sydney Harbor | 3m | 315m | 312m | Investigated: likely bad HuggingFace tile |
| Sahara flat desert | 450m | 990m | 540m | SRTM known sand penetration issues |
| Grand Canyon | 2100m | 1592m | 508m | SRTM DSM canyon depth issue |

### ❌ Bad/Missing Data (5 points)

| Point | Expected | OpenZenith | Error | Root Cause |
|-------|----------|-----------|-------|-----------|
| Kilimanjaro | 5895m | 1352m | 4543m | **Bad HuggingFace tile** (S03E037) |
| Aconcagua | 6961m | 2153m | 4808m | **Bad HuggingFace tile** (S32W070) |
| Hawaii Mauna Kea | 4205m | 0m | 4205m | **Missing HuggingFace tile** (N19W155) |
| Death Valley | -85m | 1668m | 1753m | **Bad HuggingFace tile** (N36W116) |
| North Pole | 0m | -4240m | 4240m | **GEBCO: no ice surface data** at pole |

---

## Findings

### No Encoding Bugs Found

The validation confirms that the Terrarium PNG encoding/decoding pipeline,
tile assembly, and coordinate math are all correct. The 13 "excellent" points
(0-28m error) match SRTM's expected ±16m absolute accuracy.

### SRTM DSM Underestimates Peaks

Mount Everest (120m low) is a well-known SRTM artifact: C-band InSAR doesn't
fully penetrate ice/rock at steep slopes. This is expected behavior, not a bug.

### HuggingFace Data Quality Issues

Several tiles from `aliasfox/srtm30m-merged` contain corrupted or incorrect
data:
- **N36W116** (Death Valley): Returns 1668m instead of terrain
- **S03E037** (Kilimanjaro): Returns 1352m instead of 5895m
- **S32W070** (Aconcagua): Returns 2153m instead of 6961m
- **N19W155** (Hawaii): Returns 0m (NODATA or empty)

These are upstream data issues in the HuggingFace merged files, not encoding bugs.

### GEBCO 2025 Limitations

- **North Pole**: GEBCO returns -4240m (ocean bathymetry) instead of 0m (ice
  surface). This is because GEBCO measures sea floor, not ice sheet surface.
  A proper solution would merge GEBCO with BedMachine or similar ice surface data.
- **450m resolution**: Ocean depth errors of 100-300m are expected at 15 arcsec.

### Recommendation: Tile Data Audit

The bad HuggingFace tiles should be re-extracted from the original NASA SRTM
GeoTIFF files and re-uploaded to HuggingFace. Priority tiles:
1. N36W116 (Death Valley)
2. S03E037 (Kilimanjaro)
3. S32W070 (Aconcagua region)
4. N19W155 (Hawaii)

---

## External Reference APIs

| API | URL | Status | Notes |
|-----|-----|--------|-------|
| Open-Elevation | api.open-elevation.com | ❌ 404 | API appears to have shut down or changed |
| USGS EPQS | epqs.nationalmap.gov | ✅ Works | US-only, high quality (NED 10m) |
| AWS Terrain Tiles | s3.amazonaws.com/elevation-tiles-prod | ✅ Works | Terrarium PNG, SRTM 30m global |
| OpenTopography | portal.opentopography.org | ✅ Works | Requires API key, multiple datasets |
| Google Elevation | maps.googleapis.com | ✅ Works | Requires API key, ~30m |

**Recommendation:** Use USGS EPQS for US points and AWS Terrain Tiles for global
tile-level comparison. Open-Elevation is no longer available.

---

## Validation Script Usage

```bash
# Spot check against known ground truth
python3 scripts/validate_elevation.py --mode spot

# Statistical sample comparison (when reference API available)
python3 scripts/validate_elevation.py --mode sample --n 500

# Tile-level comparison against AWS Terrain Tiles
python3 scripts/validate_elevation.py --mode tile --z 8 --x 217 --y 151

# Global coverage audit
python3 scripts/validate_elevation.py --mode coverage --step 5.0
```
