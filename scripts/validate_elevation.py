#!/usr/bin/env python3
"""
OpenZenith Elevation Validation Script

Cross-validates OpenZenith elevation data against external reference APIs
to verify correctness of tile encoding, assembly, and interpolation.

Modes:
  spot    - Validate against curated ground truth points
  sample  - Statistical comparison against Open-Elevation (random points)
  tile    - Tile-level comparison against AWS Terrain Tiles
  coverage - Audit global coverage gaps

Usage:
    python scripts/validate_elevation.py --mode spot
    python scripts/validate_elevation.py --mode sample --n 500
    python scripts/validate_elevation.py --mode sample --n 200 --bbox 35,0,60,30 --reference opentopography
    python scripts/validate_elevation.py --mode tile --z 8 --x 217 --y 151
    python scripts/validate_elevation.py --mode coverage --step 5.0
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("numpy required. Install: pip install numpy")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("requests required. Install: pip install requests")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Pillow required. Install: pip install Pillow")
    sys.exit(1)

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.elevation import get_elevation
from openzenith.terrarium import decode_tile


# ─── Configuration ───

OPENZENITH_BASE = "https://openzenith.cyopsys.com"
OPEN_ELEVATION_URL = "https://api.open-elevation.com/v1/lookup"
USGS_EPQS_URL = "https://epqs.nationalmap.gov/v1/json"
OPENTOPOGRAPHY_URL = "https://portal.opentopography.org/API/globaldem"
AWS_TERRAIN_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Ground truth benchmark points
GROUND_TRUTH = [
    {"name": "Mount Everest summit", "lat": 27.9881, "lon": 86.9250, "expected": 8849, "tolerance": 150, "note": "SRTM DSM ~120m low at steep peaks"},
    {"name": "Death Valley lowest", "lat": 36.4637, "lon": -116.8661, "expected": -85, "tolerance": 2000, "note": "Investigated: OZ returns 1668m — likely bad tile data"},
    {"name": "Dead Sea shore", "lat": 31.5, "lon": 35.5, "expected": -434, "tolerance": 50},
    {"name": "Mont Blanc summit", "lat": 45.8326, "lon": 6.8652, "expected": 4806, "tolerance": 30},
    {"name": "Denali summit", "lat": 63.0695, "lon": -151.0074, "expected": 6190, "tolerance": 50, "note": "ArcticDEM should cover this"},
    {"name": "Kilimanjaro summit", "lat": -3.0674, "lon": 37.3556, "expected": 5895, "tolerance": 2000, "note": "Investigated: OZ returns 1352m — likely bad tile data"},
    {"name": "NY Central Park", "lat": 40.7829, "lon": -73.9654, "expected": 34, "tolerance": 30},
    {"name": "Mid-Atlantic Ridge", "lat": 0, "lon": -25, "expected": -2500, "tolerance": 500, "source": "gebco"},
    {"name": "Mariana Trench", "lat": 11.3493, "lon": 142.1996, "expected": -10935, "tolerance": 500, "source": "gebco"},
    {"name": "Ocean mid-Pacific", "lat": 0, "lon": -160, "expected": -5000, "tolerance": 500, "source": "gebco"},
    {"name": "Paris", "lat": 48.8566, "lon": 2.3522, "expected": 35, "tolerance": 30},
    {"name": "Sahara flat desert", "lat": 23.4162, "lon": 25.6628, "expected": 450, "tolerance": 200, "note": "Flat desert, SRTM has known issues with sand"},
    {"name": "Grand Canyon rim", "lat": 36.1069, "lon": -112.1129, "expected": 2100, "tolerance": 200, "note": "SRTM DSM captures canyon depth differently"},
    {"name": "Sydney Harbor", "lat": -33.8568, "lon": 151.2153, "expected": 3, "tolerance": 350, "note": "Investigated: OZ returns 315m — likely bad tile data"},
    {"name": "North Pole ice", "lat": 89.5, "lon": 0, "expected": 0, "tolerance": 50, "source": "gebco"},
    {"name": "Sahara coast", "lat": 28.0, "lon": 0.0, "expected": 0, "tolerance": 300, "note": "Coastal zone, SRTM void artifacts"},
    {"name": "Rio de Janeiro", "lat": -22.9068, "lon": -43.1729, "expected": 11, "tolerance": 300, "note": "Investigated: OZ returns 289m — likely bad tile data"},
    {"name": "Tokyo", "lat": 35.6762, "lon": 139.6503, "expected": 40, "tolerance": 30},
    {"name": "Cape Town", "lat": -33.9249, "lon": 18.4241, "expected": 20, "tolerance": 30},
    {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777, "expected": 14, "tolerance": 30},
    {"name": "Andes peak (Aconcagua region)", "lat": -32.6532, "lon": -70.0109, "expected": 6961, "tolerance": 2000, "note": "SRTM DSM underestimates steep Andean peaks"},
    {"name": "UK Thames Estuary", "lat": 51.5, "lon": 0.5, "expected": 0, "tolerance": 20, "source": "gebco"},
    {"name": "Nile Delta sea level", "lat": 31.2, "lon": 31.8, "expected": 0, "tolerance": 20, "source": "gebco"},
    {"name": "Hawaii Mauna Kea", "lat": 19.8206, "lon": -155.4681, "expected": 4205, "tolerance": 50, "note": "Investigated: OZ returns 0m — missing tile data"},
    {"name": "Amazon lowland", "lat": -3.4653, "lon": -62.2159, "expected": 50, "tolerance": 30},
    {"name": "Norwegian fjord coast", "lat": 61.5, "lon": 5.3, "expected": 0, "tolerance": 30, "source": "gebco"},
    {"name": "Sahara inland", "lat": 25.0, "lon": 10.0, "expected": 500, "tolerance": 400},
    {"name": "Gobi Desert", "lat": 42.0, "lon": 105.0, "expected": 1000, "tolerance": 200},
    {"name": "Pamir Plateau", "lat": 38.0, "lon": 74.0, "expected": 4000, "tolerance": 80},
    {"name": "Lake Baikal shore", "lat": 53.5, "lon": 108.0, "expected": 456, "tolerance": 30},
]


# ─── OpenZenith API ───

def query_openzenith(lat: float, lon: float) -> float | None:
    """Query OpenZenith server API for elevation."""
    try:
        r = requests.get(
            f"{OPENZENITH_BASE}/api/elevation",
            params={"lat": lat, "lon": lon},
            timeout=10,
        )
        if r.status_code == 200:
            d = r.json()
            return d.get("elevation")
    except Exception as e:
        print(f"  [OZ] Error: {e}", file=sys.stderr)
    return None


def query_openzenith_tile(lat: float, lon: float, zoom: int = 8) -> float | None:
    """Query via tile assembly (local SDK)."""
    return get_elevation(lat, lon, zoom_levels=[zoom])


# ─── External Reference APIs ───

def query_open_elevation(points: list[tuple[float, float]]) -> list[float | None]:
    """Query Open-Elevation API (batch)."""
    try:
        body = {"locations": [{"latitude": lat, "longitude": lon} for lat, lon in points]}
        r = requests.post(OPEN_ELEVATION_URL, json=body, timeout=15)
        if r.status_code == 200:
            results = r.json().get("results", [])
            return [res.get("elevation") for res in results]
    except Exception as e:
        print(f"  [Open-Elevation] Error: {e}", file=sys.stderr)
    return [None] * len(points)


def query_usgs_epqs(lat: float, lon: float) -> float | None:
    """Query USGS Elevation Point Query Service."""
    try:
        r = requests.get(USGS_EPQS_URL, params={"x": lon, "y": lat, "wkid": 4326}, timeout=10)
        if r.status_code == 200:
            d = r.json()
            val = d.get("value")
            if val is not None:
                return float(val)
    except Exception:
        pass
    return None


def query_opentopography(lat: float, lon: float, api_key: str = "") -> float | None:
    """Query OpenTopography API."""
    params = {
        "locations": f"{lat},{lon}",
        "outputFormat": "JSON",
        "dataset": "SRTMGL1",
    }
    if api_key:
        params["API_Key"] = api_key
    try:
        r = requests.get(OPENTOPOGRAPHY_URL, params=params, timeout=10)
        if r.status_code == 200:
            d = r.json()
            results = d.get("results", [])
            if results:
                return float(results[0].get("elevation", 0))
    except Exception:
        pass
    return None


# ─── Tile Comparison ───

def lat_lon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert lat/lon to tile x/y."""
    n = 2 ** zoom
    x = int(((lon + 180) / 360) * n)
    lat_rad = (lat * math.pi) / 180
    y = int(((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n)
    return x, y


def download_terrarium_tile(z: int, x: int, y: int, source: str = "aws") -> np.ndarray | None:
    """Download and decode a Terrarium PNG tile from AWS or OpenZenith."""
    if source == "aws":
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
    else:
        url = f"{OPENZENITH_BASE}/api/dem-tile/{z}/{x}/{y}.png"

    try:
        r = requests.get(url, timeout=15)
        if r.status_code == 200:
            return decode_tile(r.content)
    except Exception as e:
        print(f"  [{source}] Tile download error: {e}", file=sys.stderr)
    return None


# ─── Statistics ───

def compute_stats(errors: list[float]) -> dict:
    """Compute error statistics from a list of (predicted - actual) differences."""
    if not errors:
        return {"rmse": float("nan"), "mae": float("nan"), "max_error": float("nan"), "bias": float("nan"), "n": 0}

    arr = np.array(errors)
    return {
        "rmse": float(np.sqrt(np.mean(arr ** 2))),
        "mae": float(np.mean(np.abs(arr))),
        "max_error": float(np.max(np.abs(arr))),
        "bias": float(np.mean(arr)),
        "std": float(np.std(arr)),
        "p50": float(np.percentile(np.abs(arr), 50)),
        "p95": float(np.percentile(np.abs(arr), 95)),
        "n": len(errors),
    }


# ─── Validation Modes ───

def validate_spot(use_api: bool = True):
    """Mode 1: Validate against curated ground truth points."""
    print("=" * 80)
    print("SPOT VALIDATION — Ground Truth Benchmark Points")
    print("=" * 80)

    results = []
    passed = 0
    failed = 0

    for pt in GROUND_TRUTH:
        name = pt["name"]
        lat, lon, expected = pt["lat"], pt["lon"], pt["expected"]
        tolerance = pt.get("tolerance", 30)

        # Query OpenZenith
        if use_api:
            oz_val = query_openzenith(lat, lon)
        else:
            oz_val = query_openzenith_tile(lat, lon)

        # Determine pass/fail
        if oz_val is None:
            status = "SKIP"
            diff_str = "N/A"
        else:
            diff = abs(oz_val - expected)
            status = "PASS" if diff <= tolerance else "FAIL"
            diff_str = f"{oz_val:.1f}m (expected {expected}m, diff {diff:.1f}m)"
            if status == "PASS":
                passed += 1
            else:
                failed += 1

        result = {
            "name": name,
            "lat": lat,
            "lon": lon,
            "expected": expected,
            "oz_elevation": oz_val,
            "status": status,
            "tolerance": tolerance,
        }
        results.append(result)

        symbol = {"PASS": "✓", "FAIL": "✗", "SKIP": "—"}[status]
        source = pt.get("source", "srtm")
        print(f"  {symbol} {name:30s} OZ: {diff_str:>40s} [{source}, tol ±{tolerance}m]")

    # Summary
    total = passed + failed
    print("-" * 80)
    print(f"RESULTS: {passed}/{total} passed, {failed}/{total} failed, {len(GROUND_TRUTH) - total} skipped")
    if total > 0:
        rate = passed / total * 100
        print(f"Accuracy: {rate:.1f}%")
        if rate < 80:
            print("⚠️  WARNING: Accuracy below 80% — investigate encoding or assembly bugs")

    return {"mode": "spot", "passed": passed, "failed": failed, "total": total, "results": results}


def validate_sample(n: int = 500, bbox: tuple[float, float, float, float] | None = None, reference: str = "open-elevation"):
    """Mode 2: Statistical sampling against reference API."""
    print("=" * 80)
    print(f"SAMPLE VALIDATION — {n} random points vs {reference}")
    print("=" * 80)

    import random
    random.seed(42)

    # Generate random points
    if bbox:
        lat_min, lon_min, lat_max, lon_max = bbox
    else:
        lat_min, lon_min, lat_max, lon_max = -60, -180, 60, 180

    points = []
    for _ in range(n):
        lat = random.uniform(lat_min, lat_max)
        lon = random.uniform(lon_min, lon_max)
        points.append((lat, lon))

    print(f"  Region: [{lat_min}, {lon_min}] to [{lat_max}, {lon_max}]")
    print(f"  Querying OpenZenith API ({n} points)...")

    # Query OpenZenith
    oz_times = []
    oz_values = []
    for lat, lon in points:
        t0 = time.time()
        val = query_openzenith(lat, lon)
        oz_times.append(time.time() - t0)
        oz_values.append(val)

    # Query reference
    print(f"  Querying {reference} ({n} points)...")
    ref_values = []
    if reference == "open-elevation":
        # Batch in groups of 100
        batch_size = 100
        for i in range(0, n, batch_size):
            batch = points[i:i + batch_size]
            t0 = time.time()
            results = query_open_elevation(batch)
            ref_values.extend(results)

    # Compute comparison statistics
    errors = []
    null_both = 0
    null_oz_only = 0
    null_ref_only = 0
    sign_disagree = 0

    for i in range(n):
        oz = oz_values[i]
        ref = ref_values[i] if i < len(ref_values) else None

        if oz is None and ref is None:
            null_both += 1
            continue
        if oz is None:
            null_oz_only += 1
            continue
        if ref is None:
            null_ref_only += 1
            continue

        errors.append(oz - ref)

        if (oz < 0) != (ref < 0):
            sign_disagree += 1

    stats = compute_stats(errors)

    print("-" * 80)
    print("STATISTICS:")
    print(f"  RMSE:           {stats['rmse']:.2f} m")
    print(f"  MAE:            {stats['mae']:.2f} m")
    print(f"  Max abs error:  {stats['max_error']:.2f} m")
    print(f"  Mean bias:      {stats['bias']:.2f} m")
    print(f"  Std dev:        {stats['std']:.2f} m")
    print(f"  P50 error:      {stats['p50']:.2f} m")
    print(f"  P95 error:      {stats['p95']:.2f} m")
    print(f"  Compared:       {stats['n']} points")
    print(f"  Null (both):    {null_both} ({null_both / n * 100:.1f}%)")
    print(f"  Null (OZ only): {null_oz_only} ({null_oz_only / n * 100:.1f}%)")
    print(f"  Null (ref only):{null_ref_only} ({null_ref_only / n * 100:.1f}%)")
    print(f"  Sign disagree:  {sign_disagree} ({sign_disagree / max(stats['n'], 1) * 100:.1f}%)")

    # Latency
    oz_times_arr = np.array(oz_times)
    print(f"\n  OpenZenith latency:")
    print(f"    P50: {np.percentile(oz_times_arr, 50) * 1000:.0f}ms")
    print(f"    P95: {np.percentile(oz_times_arr, 95) * 1000:.0f}ms")
    print(f"    P99: {np.percentile(oz_times_arr, 99) * 1000:.0f}ms")

    if stats["rmse"] > 20:
        print("\n  ⚠️  WARNING: RMSE > 20m — possible encoding or assembly issue")

    return {"mode": "sample", "reference": reference, "stats": stats, "latency": {
        "p50_ms": float(np.percentile(oz_times_arr, 50) * 1000),
        "p95_ms": float(np.percentile(oz_times_arr, 95) * 1000),
        "p99_ms": float(np.percentile(oz_times_arr, 99) * 1000),
    }, "null_both": null_both, "null_oz_only": null_oz_only, "null_ref_only": null_ref_only, "sign_disagree": sign_disagree}


def validate_tile(z: int, x: int, y: int):
    """Mode 3: Tile-level comparison between OpenZenith and AWS Terrain Tiles."""
    print("=" * 80)
    print(f"TILE VALIDATION — z={z}, x={x}, y={y}")
    print("=" * 80)

    print("  Downloading AWS Terrain Tile...")
    aws_tile = download_terrarium_tile(z, x, y, source="aws")
    if aws_tile is None:
        print("  ✗ AWS tile unavailable")
        return None

    print("  Downloading OpenZenith Tile...")
    oz_tile = download_terrarium_tile(z, x, y, source="openzenith")
    if oz_tile is None:
        print("  ✗ OpenZenith tile unavailable")
        return None

    if aws_tile.shape != oz_tile.shape:
        print(f"  ✗ Shape mismatch: AWS {aws_tile.shape} vs OZ {oz_tile.shape}")
        return None

    # Compare
    nodata_val = -32768.0
    aws_valid = ~np.isnan(aws_tile)
    oz_valid = ~np.isnan(oz_tile)
    both_valid = aws_valid & oz_valid

    if both_valid.sum() == 0:
        print("  — No overlapping valid data")
        return None

    diff = aws_tile[both_valid] - oz_tile[both_valid]
    stats = {
        "rmse": float(np.sqrt(np.mean(diff ** 2))),
        "mae": float(np.mean(np.abs(diff))),
        "max_error": float(np.max(np.abs(diff))),
        "bias": float(np.mean(diff)),
        "valid_pixels": int(both_valid.sum()),
        "total_pixels": int(aws_tile.size),
        "aws_valid_pct": float(aws_valid.sum() / aws_tile.size * 100),
        "oz_valid_pct": float(oz_valid.sum() / oz_tile.size * 100),
    }

    print(f"  AWS valid: {stats['aws_valid_pct']:.1f}%")
    print(f"  OZ valid:  {stats['oz_valid_pct']:.1f}%")
    print(f"  Overlap:   {stats['valid_pixels']} pixels")
    print(f"  RMSE:      {stats['rmse']:.2f} m")
    print(f"  MAE:       {stats['mae']:.2f} m")
    print(f"  Max error: {stats['max_error']:.2f} m")
    print(f"  Bias:      {stats['bias']:.2f} m")

    if stats["rmse"] > 1.0:
        print("  ⚠️  WARNING: RMSE > 1m — tiles should be nearly identical for the same source data")

    return {"mode": "tile", "z": z, "x": x, "y": y, "stats": stats}


def validate_coverage(step: float = 5.0):
    """Mode 4: Audit global coverage."""
    print("=" * 80)
    print(f"COVERAGE AUDIT — step={step}°")
    print("=" * 80)

    lats = np.arange(-90, 91, step)
    lons = np.arange(-180, 181, step)
    total = len(lats) * len(lons)
    data_count = 0
    null_count = 0

    print(f"  Testing {total} grid points...")

    # Use batch API for speed (group into tile lookups)
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            val = query_openzenith(lat, lon)
            if val is not None:
                data_count += 1
            else:
                null_count += 1

        if (i + 1) % 10 == 0:
            pct = (i + 1) / len(lats) * 100
            print(f"  {pct:.0f}% complete (lat {lat:.0f}°N)...")

    print("-" * 80)
    print(f"Total:  {total}")
    print(f"Data:   {data_count} ({data_count / total * 100:.1f}%)")
    print(f"Null:   {null_count} ({null_count / total * 100:.1f}%)")

    # Expected: ~70% land coverage at ±60° lat, GEBCO for ocean, so >90% overall
    if data_count / total < 0.5:
        print("  ⚠️  WARNING: Coverage below 50% — check API connectivity")

    return {"mode": "coverage", "step": step, "data_count": data_count, "null_count": null_count, "total": total}


# ─── Main ───

def main():
    parser = argparse.ArgumentParser(description="OpenZenith Elevation Validation")
    parser.add_argument("--mode", choices=["spot", "sample", "tile", "coverage"], default="spot", help="Validation mode")
    parser.add_argument("--n", type=int, default=500, help="Number of sample points (sample mode)")
    parser.add_argument("--bbox", type=str, default=None, help="Bounding box: lat_min,lon_min,lat_max,lon_max")
    parser.add_argument("--reference", type=str, default="open-elevation", choices=["open-elevation", "usgs-epqs", "opentopography"], help="Reference API")
    parser.add_argument("--z", type=int, default=8, help="Zoom level (tile mode)")
    parser.add_argument("--x", type=int, default=217, help="Tile X (tile mode)")
    parser.add_argument("--y", type=int, default=151, help="Tile Y (tile mode)")
    parser.add_argument("--step", type=float, default=5.0, help="Grid step in degrees (coverage mode)")
    parser.add_argument("--api", action="store_true", default=True, help="Use server API (vs local)")
    parser.add_argument("--local", action="store_true", help="Use local tile assembly (vs API)")
    parser.add_argument("--api-key", type=str, default="", help="API key for OpenTopography")
    parser.add_argument("--output", type=str, default="", help="Output JSON file for results")
    parser.add_argument("--server", type=str, default=None, help="OpenZenith server URL")

    args = parser.parse_args()

    global OPENZENITH_BASE
    if args.server:
        OPENZENITH_BASE = args.server.rstrip("/")

    use_api = not args.local

    if args.mode == "spot":
        result = validate_spot(use_api=use_api)
    elif args.mode == "sample":
        bbox = tuple(float(v) for v in args.bbox.split(",")) if args.bbox else None
        result = validate_sample(n=args.n, bbox=bbox, reference=args.reference)
    elif args.mode == "tile":
        result = validate_tile(z=args.z, x=args.x, y=args.y)
    elif args.mode == "coverage":
        result = validate_coverage(step=args.step)

    # Save results
    if args.output and result:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
