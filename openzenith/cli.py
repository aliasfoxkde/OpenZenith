"""OpenZenith CLI — data download, elevation queries, and analysis.

Usage:
    openzenith download --region europe --zoom-levels 0-10
    openzenith download --bbox 35,0,60,30 --zoom-levels 8
    openzenith query --lat 40.7128 --lon -74.0060
    openzenith query --batch "40.7,-74.0 35.7,139.7 -33.9,151.2"
    openzenith trace --lat 40.7 --lon -74.0
    openzenith watershed --lat 40.7 --lon -74.0
    openzenith info
    openzenith validate --mode spot
"""

import argparse
import sys
import json
import time
import os
import math
from pathlib import Path

import numpy as np


def cmd_download(args):
    """Download elevation tiles from HuggingFace to local cache."""
    try:
        from openzenith.elevation import load_tiles, get_tile_count as _get_tile_count
    except ImportError:
        print("❌ Download requires huggingface_hub. Install: pip install openzenith[download]")
        sys.exit(1)

    if args.region and not args.bbox:
        bbox = REGION_BBOXES.get(args.region.lower())
        if not bbox:
            print(f"❌ Unknown region '{args.region}'. Available: {', '.join(REGION_BBOXES.keys())}")
            sys.exit(1)
        args.bbox = ",".join(str(v) for v in bbox)

    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        if len(parts) != 4:
            print("❌ BBOX must be lat_min,lon_min,lat_max,lon_max")
            sys.exit(1)
        lat_min, lon_min, lat_max, lon_max = parts
        print(f"📊 Region: [{lat_min}, {lon_min}] to [{lat_max}, {lon_max}]")

        # Estimate required zoom levels for coverage
        if args.zoom_levels:
            zoom_levels = _parse_zoom_levels(args.zoom_levels)
        else:
            zoom_levels = list(range(0, 11))

        # Count tiles needed for bbox
        total_tiles = 0
        for z in zoom_levels:
            x1, y1 = _latlon_to_tile(lat_max, lon_min, z)
            x2, y2 = _latlon_to_tile(lat_min, lon_max, z)
            tiles = (x2 - x1 + 1) * (y2 - y1 + 1)
            total_tiles += tiles

        print(f"📈 Estimated tiles: {total_tiles:,} across zoom {min(zoom_levels)}-{max(zoom_levels)}")

    cache_dir = args.cache_dir or str(Path.home() / ".cache" / "openzenith-dem")
    print(f"📁 Cache directory: {cache_dir}")
    print(f"⬇️  Downloading...")

    t0 = time.time()
    tile_dir = load_tiles(
        zoom_levels=zoom_levels if args.zoom_levels else list(range(0, 9)),
        cache_dir=cache_dir,
    )
    elapsed = time.time() - t0

    # Count tiles
    counts = _get_tile_count(tile_dir)
    total = sum(counts.values())
    size_bytes = sum(p.stat().st_size for p in Path(tile_dir).rglob("*.png"))

    print(f"✅ Done in {elapsed:.1f}s")
    print(f"📊 Tiles: {total:,} ({size_bytes / 1e6:.1f} MB)")
    print(f"📈 Per zoom: {', '.join(f'z{z}={counts.get(z, 0)}' for z in sorted(counts.keys()))}")


def cmd_query(args):
    """Query elevation at one or more points."""
    from openzenith.elevation import get_elevation, get_elevation_batch

    if args.batch:
        points = []
        for pair in args.batch.split():
            lat, lon = pair.split(",")
            points.append((float(lat), float(lon)))

        print(f"📊 Querying {len(points)} points...")
        results = get_elevation_batch(points)
        for (lat, lon), elev in zip(points, results):
            status = f"{elev:.1f}m" if elev is not None else "N/A (ocean/no data)"
            print(f"  ({lat:.4f}, {lon:.4f}) → {status}")
    else:
        if args.lat is None or args.lon is None:
            print("❌ Provide --lat and --lon, or use --batch")
            sys.exit(1)
        elev = get_elevation(args.lat, args.lon)
        status = f"{elev:.1f}m" if elev is not None else "N/A (ocean/no data)"
        print(f"📍 ({args.lat:.6f}, {args.lon:.6f}) → {status}")


def cmd_trace(args):
    """Trace downstream from a point to the ocean."""
    try:
        from openzenith.tracing import trace_downstream
    except ImportError:
        print("❌ Tracing requires numpy (always available). Check your installation.")
        sys.exit(1)

    if args.lat is None or args.lon is None:
        print("❌ Provide --lat and --lon")
        sys.exit(1)

    print(f"🌊 Tracing downstream from ({args.lat:.4f}, {args.lon:.4f})...")

    t0 = time.time()
    result = trace_downstream(args.lat, args.lon, max_steps=args.max_steps)
    elapsed = time.time() - t0

    if result is None:
        print("❌ Could not trace — point may be in ocean or have no valid elevation data")
        return

    print(f"✅ Traced {result['total_distance']:.1f} km in {result['steps']} steps ({elapsed:.1f}s)")
    print(f"   Start: ({result['start'][0]:.4f}, {result['start'][1]:.4f}) at {result['start_elev']:.0f}m")
    print(f"   End:   ({result['end'][0]:.4f}, {result['end'][1]:.4f}) at {result['end_elev']:.0f}m")
    print(f"   Elev drop: {result['start_elev'] - result['end_elev']:.0f}m")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"💾 Path saved to {args.output}")


def cmd_watershed(args):
    """Delineate watershed from a pour point."""
    try:
        from openzenith.hydrology import delineate_watershed
    except ImportError:
        print("❌ Watershed delineation requires numpy.")
        sys.exit(1)

    if args.lat is None or args.lon is None:
        print("❌ Provide --lat and --lon")
        sys.exit(1)

    print(f"🏔️  Delineating watershed from ({args.lat:.4f}, {args.lon:.4f})...")

    t0 = time.time()
    result = delineate_watershed(args.lat, args.lon)
    elapsed = time.time() - t0

    if result is None:
        print("❌ Could not delineate — point may be in ocean or edge of data")
        return

    print(f"✅ Watershed: {result['area_km2']:.1f} km², {result['pixels']} pixels ({elapsed:.1f}s)")
    print(f"   Elev range: {result['min_elev']:.0f}m — {result['max_elev']:.0f}m")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"💾 Saved to {args.output}")


def cmd_info(args):
    """Show system info and data availability."""
    print("OpenZenith Elevation Tools")
    print("=" * 40)
    print(f"Version:     {__import__('openzenith').__version__}")

    # Check for local tiles
    cache_dir = Path.home() / ".cache" / "openzenith-dem"
    if cache_dir.exists():
        try:
            from openzenith.elevation import get_tile_count
            counts = get_tile_count(str(cache_dir))
            total = sum(counts.values())
            if total > 0:
                print(f"Local cache: {cache_dir}")
                print(f"Tiles:       {total:,}")
                print(f"Zoom levels: {', '.join(str(z) for z in sorted(counts.keys()))}")
            else:
                print("Local cache: empty (run 'openzenith download' to populate)")
        except Exception:
            print("Local cache: present but could not count tiles")
    else:
        print("Local cache: not found (run 'openzenith download' to populate)")

    # Check API connectivity
    try:
        import requests
        t0 = time.time()
        r = requests.get("https://openzenith.cyopsys.com/api/health", timeout=5)
        lat_ms = (time.time() - t0) * 1000
        if r.status_code == 200:
            print(f"API server:  ✅ online ({lat_ms:.0f}ms)")
        else:
            print(f"API server:  ⚠️  status {r.status_code}")
    except Exception:
        print("API server:  ❌ offline")

    print()
    print("Data sources:")
    print("  Land (±60°):  SRTM 30m / Copernicus GLO-30 via HuggingFace")
    print("  Ocean:        GEBCO 2025 at 450m (15 arcsec)")
    print("  Arctic (>60°N): ArcticDEM / GEBCO fallback")
    print("  Antarctica:   REMA / GEBCO fallback")
    print()
    print("Usage:")
    print("  openzenith download --region europe --zoom-levels 0-8")
    print("  openzenith query --lat 40.7128 --lon -74.0060")
    print("  openzenith trace --lat 40.7 --lon -74.0")
    print("  openzenith watershed --lat 40.7 --lon -74.0")


def cmd_validate(args):
    """Run elevation validation."""
    # Re-export from validate script
    from validate_elevation import main as validate_main
    validate_main()


# ─── Helpers ───

REGION_BBOXES = {
    "world": (-90, -180, 90, 180),
    "europe": (34, -25, 72, 45),
    "usa": (24, -125, 50, -66),
    "conus": (24, -125, 50, -66),
    "asia": (0, 60, 55, 150),
    "africa": (-35, -20, 37, 55),
    "south-america": (-56, -82, 13, -34),
    "australia": (-44, 112, -10, 155),
    "arctic": (60, -180, 90, 180),
    "antarctica": (-90, -180, -60, 180),
}

def _parse_zoom_levels(s: str) -> list[int]:
    """Parse zoom level specification: '0-8' or '0,1,2,5' or '8'."""
    if "-" in s:
        parts = s.split("-")
        return list(range(int(parts[0]), int(parts[1]) + 1))
    return [int(v.strip()) for v in s.split(",")]

def _latlon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int(((lon + 180) / 360) * n)
    lat_rad = (lat * math.pi) / 180
    y = int(((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n)
    return x, y


# ─── Main ───

def main():
    parser = argparse.ArgumentParser(
        prog="openzenith",
        description="OpenZenith — Global elevation data tools",
    )
    sub = parser.add_subparsers(dest="command", help="Command to run")

    # download
    dl = sub.add_parser("download", help="Download elevation tiles from HuggingFace")
    dl.add_argument("--region", type=str, default=None, help="Named region (europe, usa, asia, world, etc.)")
    dl.add_argument("--bbox", type=str, default=None, help="Bounding box: lat_min,lon_min,lat_max,lon_max")
    dl.add_argument("--zoom-levels", type=str, default=None, help="Zoom levels (e.g. '0-8' or '0,4,8')")
    dl.add_argument("--cache-dir", type=str, default=None, help="Local cache directory")

    # query
    q = sub.add_parser("query", help="Query elevation at coordinates")
    q.add_argument("--lat", type=float, default=None)
    q.add_argument("--lon", type=float, default=None)
    q.add_argument("--batch", type=str, default=None, help='Batch points: "lat1,lon1 lat2,lon2 ..."')

    # trace
    tr = sub.add_parser("trace", help="Trace downstream path from a point")
    tr.add_argument("--lat", type=float, required=True)
    tr.add_argument("--lon", type=float, required=True)
    tr.add_argument("--max-steps", type=int, default=10000, help="Maximum steps")
    tr.add_argument("--output", type=str, default=None, help="Output JSON file")

    # watershed
    ws = sub.add_parser("watershed", help="Delineate watershed from pour point")
    ws.add_argument("--lat", type=float, required=True)
    ws.add_argument("--lon", type=float, required=True)
    ws.add_argument("--output", type=str, default=None, help="Output JSON file")

    # info
    sub.add_parser("info", help="Show system info and data availability")

    # validate
    sub.add_parser("validate", help="Run elevation validation against reference APIs")

    args = parser.parse_args()

    commands = {
        "download": cmd_download,
        "query": cmd_query,
        "trace": cmd_trace,
        "watershed": cmd_watershed,
        "info": cmd_info,
        "validate": cmd_validate,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
