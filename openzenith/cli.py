"""OpenZenith CLI — data download, elevation queries, and terrain analysis.

Usage:
    openzenith download --region europe --zoom-levels 0-10
    openzenith query --lat 40.7128 --lon -74.0060
    openzenith trace --lat 40.7 --lon -74.0
    openzenith watershed --lat 40.7 --lon -74.0
    openzenith slope --lat 40.7 --lon -74.0
    openzenith hillshade --lat 40.7 --lon -74.0 --azimuth 315
    openzenith viewshed --lat 40.7 --lon -74.0 --height 10
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


def cmd_slope(args):
    """Compute terrain slope."""
    from openzenith.elevation import load_elevation_grid
    from openzenith.terrain import slope_fast

    if args.lat is None or args.lon is None:
        print("❌ Provide --lat and --lon")
        sys.exit(1)

    print(f"📐 Computing slope at ({args.lat:.4f}, {args.lon:.4f})...")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    sl = slope_fast(grid["data"], grid["cell_size_deg"])
    elapsed = time.time() - t0

    valid = sl[~np.isnan(sl)]
    print(f"✅ {len(valid)} cells ({elapsed:.1f}s)")
    print(f"   Mean: {np.mean(valid):.1f}°  Median: {np.median(valid):.1f}°")
    print(f"   Min:  {np.min(valid):.1f}°  Max: {np.max(valid):.1f}°")
    print(f"   Std:  {np.std(valid):.1f}°")

    if args.output:
        np.save(args.output, sl)
        print(f"💾 Saved to {args.output}")


def cmd_hillshade(args):
    """Compute analytical hillshade."""
    from openzenith.elevation import load_elevation_grid
    from openzenith.terrain import hillshade

    if args.lat is None or args.lon is None:
        print("❌ Provide --lat and --lon")
        sys.exit(1)

    print(f"🌤️  Computing hillshade at ({args.lat:.4f}, {args.lon:.4f})...")
    print(f"   Azimuth: {args.azimuth}°  Altitude: {args.altitude}°")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    hs = hillshade(grid["data"], args.azimuth, args.altitude, grid["cell_size_deg"], z_factor=args.z_factor)
    elapsed = time.time() - t0

    print(f"✅ {hs.shape[0]}×{hs.shape[1]} hillshade ({elapsed:.1f}s)")
    print(f"   Brightness: mean={np.mean(hs):.0f}  min={np.min(hs)}  max={np.max(hs)}")

    if args.output:
        try:
            from PIL import Image
            Image.fromarray(hs, mode="L").save(args.output)
            print(f"💾 Saved image to {args.output}")
        except ImportError:
            np.save(args.output, hs)
            print(f"💾 Saved array to {args.output} (install Pillow for PNG)")


def cmd_viewshed(args):
    """Compute viewshed from observer point."""
    from openzenith.elevation import load_elevation_grid
    from openzenith.terrain import viewshed

    if args.lat is None or args.lon is None:
        print("❌ Provide --lat and --lon")
        sys.exit(1)

    print(f"👁️  Computing viewshed from ({args.lat:.4f}, {args.lon:.4f})...")
    print(f"   Observer height: {args.height}m  Max dist: {args.max_dist} cells")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    vs = viewshed(
        grid["data"],
        grid["data"].shape[0] // 2,
        grid["data"].shape[1] // 2,
        observer_height=args.height,
        cell_size_deg=grid["cell_size_deg"],
        max_distance_cells=args.max_dist,
    )
    elapsed = time.time() - t0

    visible = vs.sum()
    total = vs.size
    print(f"✅ {visible:,}/{total:,} cells visible ({100*visible/total:.1f}%) ({elapsed:.1f}s)")

    if args.output:
        try:
            from PIL import Image
            img = np.zeros((*vs.shape, 3), dtype=np.uint8)
            img[vs] = [0, 255, 0]    # visible = green
            img[~vs] = [40, 40, 40]   # not visible = dark gray
            Image.fromarray(img).save(args.output)
            print(f"💾 Saved image to {args.output}")
        except ImportError:
            np.save(args.output, vs)
            print(f"💾 Saved array to {args.output} (install Pillow for PNG)")


def cmd_twi(args):
    """Compute Topographic Wetness Index."""
    from openzenith.elevation import load_elevation_grid
    from openzenith.hydrology import twi

    print(f"💧 Computing TWI around ({args.lat:.4f}, {args.lon:.4f})...")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    result = twi(grid["data"], cell_size_deg=grid["cell_size_deg"])
    elapsed = time.time() - t0

    valid = result[~np.isnan(result)]
    print(f"✅ TWI: range [{np.min(valid):.1f}, {np.max(valid):.1f}], median={np.median(valid):.1f} ({elapsed:.1f}s)")

    if args.output:
        np.save(args.output, result)
        print(f"💾 Saved to {args.output}")


def cmd_contour(args):
    """Export DEM contours as GeoJSON."""
    import json as _json
    from openzenith.elevation import load_elevation_grid
    from openzenith.export import contour_to_geojson

    print(f"🗺️  Extracting contours at {args.interval}m interval around ({args.lat:.4f}, {args.lon:.4f})...")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    result = contour_to_geojson(grid["data"], interval=args.interval, transform=(0, 0, grid["cell_size_deg"], grid["cell_size_deg"]))
    elapsed = time.time() - t0

    out_path = args.output or f"contours_{args.interval}m.geojson"
    with open(out_path, "w") as f:
        _json.dump(result, f)
    print(f"✅ {len(result['features'])} contour lines → {out_path} ({elapsed:.1f}s)")


def cmd_geojson(args):
    """Export terrain grid as GeoJSON."""
    import json as _json
    from openzenith.elevation import load_elevation_grid
    from openzenith.export import grid_to_geojson

    kind = args.kind or "elevation"
    name = args.name or kind
    print(f"📄 Exporting {kind} grid as GeoJSON around ({args.lat:.4f}, {args.lon:.4f})...")
    t0 = time.time()
    grid = load_elevation_grid(args.lat, args.lon, args.radius)
    result = grid_to_geojson(grid["data"], name=name, transform=(0, 0, grid["cell_size_deg"], grid["cell_size_deg"]))
    elapsed = time.time() - t0

    out_path = args.output or f"{kind}.geojson"
    with open(out_path, "w") as f:
        _json.dump(result, f)
    print(f"✅ {len(result['features'])} points → {out_path} ({elapsed:.1f}s)")


# ─── Helper functions for encode/ingest ───────────────────────────────────────

def _load_geotiff(path: str) -> np.ndarray:
    """Load a GeoTIFF as int16 array (delegates to geo_utils)."""
    from openzenith.geo_utils import load_geotiff as _lg
    return _lg(path)


def _load_merged(path: str) -> np.ndarray:
    """Load a .merged file (OZCHNK01) as a 3601x3601 int16 array.

    Returns the full tile with horizontal-differencing undone.
    """
    from openzenith.merged import MergedFile
    mf = MergedFile(path)
    # Merge all 15x15 chunks into one 3601x3601 array
    tile = np.empty((3601, 3601), dtype=np.int16)
    for row in range(mf.rows):
        for col in range(mf.cols):
            chunk = mf.get_chunk(row, col)
            r0 = row * 256
            c0 = col * 256
            r1 = min(r0 + 256, 3601)
            c1 = min(c0 + 256, 3601)
            # Chunks may be edge-adjusted
            chunk_r = chunk.shape[0]
            chunk_c = chunk.shape[1]
            tile[r0:r0 + chunk_r, c0:c0 + chunk_c] = chunk
    return tile


def _load_rawint16(path: str) -> np.ndarray:
    """Load a raw int16 binary file as a 2D numpy array.

    Detects square dimensions automatically.
    """
    data = np.fromfile(path, dtype=np.int16)
    side = int(np.sqrt(data.size))
    if side * side != data.size:
        raise ValueError(f"Raw int16 file size {data.size} is not a perfect square")
    return data.reshape(side, side)


def _filename_to_bbox(filename: str) -> dict | None:
    """Parse a SRTM-style filename to get coverage bbox.

    Supports: N00E006, N00E006.tif, Copernicus_DSM_COG_10_N22_00_E016_DEM.tif
    """
    import re

    # SRTM style: N36W116.tif
    m = re.match(r"([NS])(\d{2})([EW])(\d{3})", filename, re.IGNORECASE)
    if m:
        lat_dir, lat_deg, lon_dir, lon_deg = m.groups()
        lat_d = int(lat_deg)
        lon_d = int(lon_deg)
        lat_min = lat_d if lat_dir == "N" else -lat_d - 1
        lon_min = lon_d if lon_dir == "E" else -lon_d - 1
        return {"bbox": [lon_min, lat_min, lon_min + 1, lat_min + 1]}

    # Copernicus DEM style: Copernicus_DSM_COG_10_N22_00_E016_DEM
    m = re.match(r".*_N(\d{2})_E(\d{3})_DEM", filename, re.IGNORECASE)
    if m:
        lat_deg, lon_deg = int(m.group(1)), int(m.group(2))
        return {"bbox": [lon_deg, lat_deg, lon_deg + 1, lat_deg + 1]}

    return None


def cmd_encode(args):
    """Encode a DEM file or directory of DEM files to OZT2 format."""
    from openzenith.tile_format_v2 import auto_encode, encode, validate_roundtrip, PRED_GRADIENT

    predictor_map = {"none": 0, "left": 1, "gradient": 2}
    predictor = predictor_map.get(args.predictor, PRED_GRADIENT)

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"❌ Input not found: {input_path}")
        sys.exit(1)

    def encode_file(src_path: Path, dst_path: Path):
        """Encode a single DEM file to OZT2."""
        try:
            # Detect format
            ext = src_path.suffix.lower()
            if ext == ".tif" or ext == ".tiff":
                elev = _load_geotiff(str(src_path))
            elif ext == ".merged":
                elev = _load_merged(str(src_path))
            elif ext == ".raw" or ext == ".int16":
                elev = _load_rawint16(str(src_path))
            else:
                print(f"  ⚠️  Unknown format for {src_path.name}, skipping")
                return None

            # Encode
            if args.bits:
                encoded = encode(
                    elev,
                    bits_per_pixel=args.bits,
                    predictor=predictor,
                )
                meta_r = {"bits_per_pixel": args.bits}
            else:
                encoded, meta_r = auto_encode(elev, max_rmse=args.max_rmse)
                bits = meta_r.get("auto_selected_bits", 16)
                encoded = encode(elev, bits_per_pixel=bits, predictor=predictor)

            # Validate
            if args.validate:
                is_lossless, rmse, vmeta = validate_roundtrip(
                    elev, bits_per_pixel=meta_r.get("auto_selected_bits", meta_r.get("bits_per_pixel", 16))
                )
            else:
                is_lossless, rmse = True, 0.0

            dst_path.parent.mkdir(parents=True, exist_ok=True)
            dst_path.write_bytes(encoded)

            if not args.quiet:
                bits = meta_r.get("auto_selected_bits", meta_r.get("bits_per_pixel", 16))
                loss = "lossless" if bits == 16 else f"{bits}-bit"
                print(
                    f"  ✅ {src_path.name} → {dst_path.name} "
                    f"({len(encoded):,}B, {loss}, RMSE={rmse:.2f}m)"
                )

            return {
                "file": str(src_path),
                "size": len(encoded),
                "bits": meta_r.get("auto_selected_bits", meta_r.get("bits_per_pixel", 16)),
                "rmse": rmse,
                "lossless": is_lossless,
            }

        except Exception as e:
            print(f"  💥 {src_path.name}: {e}")
            return None

    # Single file
    if input_path.is_file():
        if output_path.is_dir():
            dst = output_path / f"{input_path.stem}.ozt2"
        else:
            dst = output_path
        result = encode_file(input_path, dst)
        if result:
            print(f"✅ Encoded: {dst} ({result['size']:,} bytes)")
        return

    # Directory
    files = list(input_path.rglob("*.tif")) + list(input_path.rglob("*.tiff")) + \
            list(input_path.rglob("*.merged")) + list(input_path.rglob("*.raw"))

    if not files:
        print(f"❌ No DEM files found in {input_path}")
        sys.exit(1)

    print(f"Encoding {len(files)} files from {input_path} → {output_path}")
    results = []
    for f in sorted(files):
        dst = output_path / f"{f.stem}.ozt2"
        r = encode_file(f, dst)
        if r:
            results.append(r)

    if results:
        total_size = sum(r["size"] for r in results)
        avg_rmse = sum(r["rmse"] for r in results) / len(results)
        lossless_count = sum(1 for r in results if r["lossless"])
        print(f"\n✅ Encoded {len(results)}/{len(files)} files")
        print(f"   Total size: {total_size / 1e6:.1f} MB")
        print(f"   Avg RMSE: {avg_rmse:.2f}m")
        print(f"   Lossless: {lossless_count} ({100*lossless_count/len(results):.0f}%)")
    else:
        print(f"\n❌ No files encoded successfully")
        sys.exit(1)


def cmd_ingest(args):
    """Prepare a contributed dataset for submission to OpenZenith."""
    import json as _json
    from openzenith.tile_format_v2 import auto_encode, encode, validate_roundtrip

    dataset_path = Path(args.dataset)
    if not dataset_path.is_dir():
        print(f"❌ Dataset directory not found: {dataset_path}")
        sys.exit(1)

    output_dir = Path(args.output)
    bundle_dir = output_dir / args.name
    tiles_dir = bundle_dir / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)

    print(f"OpenZenith Dataset Ingest")
    print(f"{'=' * 50}")
    print(f"  Dataset:   {args.dataset}")
    print(f"  Name:      {args.name}")
    print(f"  License:   {args.license}")
    print(f"  Output:   {bundle_dir}")
    print(f"{'=' * 50}\n")

    # Find all DEM files
    dem_files = (
        list(dataset_path.rglob("*.tif")) +
        list(dataset_path.rglob("*.tiff")) +
        list(dataset_path.rglob("*.merged"))
    )

    if not dem_files:
        print(f"❌ No .tif or .merged files found in {dataset_path}")
        sys.exit(1)

    print(f"Found {len(dem_files)} DEM files")

    # Encode tiles and build manifest
    tiles = []
    errors = []

    for f in sorted(dem_files):
        try:
            # Load elevation
            ext = f.suffix.lower()
            if ext in (".tif", ".tiff"):
                elev = _load_geotiff(str(f))
            else:
                elev = _load_merged(str(f))

            # Encode to OZT2
            encoded, meta = auto_encode(elev, max_rmse=1.0)
            tile_name = f"{f.stem}.ozt2"
            tile_path = tiles_dir / tile_name
            tile_path.write_bytes(encoded)

            # Compute bbox from filename (SRTM naming convention)
            lat_dir = f.parent.name
            bbox = _filename_to_bbox(f.name)

            tiles.append({
                "file": tile_name,
                "source_file": str(f.relative_to(dataset_path)),
                "size_bytes": len(encoded),
                "bits": meta.get("auto_selected_bits", 16),
                "rmse": meta.get("rmse", 0),
                "coverage": bbox,
            })
            print(f"  ✅ {f.name} → {tile_name} ({len(encoded):,}B)")

        except Exception as e:
            errors.append({"file": str(f), "error": str(e)})
            print(f"  💥 {f.name}: {e}")

    # Build manifest
    manifest = {
        "name": args.name,
        "version": "1.0.0",
        "description": args.description,
        "license": args.license,
        "source_url": args.source_url,
        "contributor": args.contributor,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tile_format": "ozt2",
        "total_tiles": len(tiles),
        "errors": len(errors),
        "tiles": tiles,
    }

    manifest_path = bundle_dir / "manifest.json"
    manifest_path.write_text(_json.dumps(manifest, indent=2))

    print(f"\n{'=' * 50}")
    print(f"✅ Ingest complete: {len(tiles)} tiles encoded")
    print(f"   Bundle: {bundle_dir}")
    print(f"   Manifest: {manifest_path}")
    if errors:
        print(f"   Errors: {len(errors)}")
    print(f"\nTo submit:")
    print(f"  1. Review manifest: cat {manifest_path}")
    print(f"  2. Create PR: https://github.com/openzenith/openzenith-data")
    print(f"  3. Attach bundle as LFS file")


def cmd_tiles(args):
    """Download tiles for a specific region and zoom levels.

    Supports multiple data sources:
    - dem: Terrarium PNG elevation tiles from HuggingFace
    - Custom bbox or named region selection
    - Specific zoom level ranges

    Usage:
        openzenith tiles --bbox 34,-25,72,45 --zoom 5-10
        openzenith tiles --region europe --zoom 0-8
        openzenith tiles --lat 40.7 --lon -74.0 --radius 0.5 --zoom 10-12
    """
    from openzenith.elevation import load_tiles, get_tile_count as _get_tile_count, latlon_to_tile

    # Resolve bbox from args
    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        if len(parts) != 4:
            print("❌ BBOX must be lat_min,lon_min,lat_max,lon_max")
            sys.exit(1)
        lat_min, lon_min, lat_max, lon_max = parts
    elif args.region:
        bbox = REGION_BBOXES.get(args.region.lower())
        if not bbox:
            print(f"❌ Unknown region '{args.region}'. Available: {', '.join(sorted(REGION_BBOXES.keys()))}")
            sys.exit(1)
        lat_min, lon_min, lat_max, lon_max = bbox
    elif args.lat is not None and args.lon is not None:
        # Use lat/lon as center with --radius (default 0.5 degrees)
        r = args.radius
        lat_min, lon_min = args.lat - r, args.lon - r
        lat_max, lon_max = args.lat + r, args.lon + r
    else:
        print("❌ Provide --bbox, --region, or --lat/--lon (with optional --radius)")
        sys.exit(1)

    # Parse zoom levels
    zoom_levels = _parse_zoom_levels(args.zoom) if args.zoom else list(range(0, 9))

    # Count tiles needed
    total_tiles = 0
    zoom_breakdown = {}
    for z in zoom_levels:
        x1, y1 = latlon_to_tile(lat_max, lon_min, z)
        x2, y2 = latlon_to_tile(lat_min, lon_max, z)
        count = (x2 - x1 + 1) * (y2 - y1 + 1)
        total_tiles += count
        zoom_breakdown[z] = count

    # Size estimate (~15KB per tile average)
    size_mb = (total_tiles * 15) / (1024 * 1024)

    print(f"📊 Region: [{lat_min:.4f}, {lon_min:.4f}] to [{lat_max:.4f}, {lon_max:.4f}]")
    print(f"📈 Zoom: {min(zoom_levels)}-{max(zoom_levels)}")
    print(f"📊 Tiles: {total_tiles:,}")
    print(f"📦 Est. size: {size_mb:.1f} MB")
    print(f"📈 Per zoom: {', '.join(f'z{z}={zoom_breakdown[z]:,}' for z in sorted(zoom_breakdown.keys()))}")

    if total_tiles > 100000:
        print(f"\n⚠️  {total_tiles:,} tiles is a large download. Use --zoom to narrow the range.")
        if not args.force:
            print("   Add --force to proceed.")
            sys.exit(0)

    # Download
    cache_dir = args.cache_dir or str(Path.home() / ".cache" / "openzenith-dem")
    print(f"\n⬇️  Downloading to {cache_dir}...")

    t0 = time.time()
    tile_dir = load_tiles(zoom_levels=zoom_levels, cache_dir=cache_dir)
    elapsed = time.time() - t0

    # Verify
    counts = _get_tile_count(tile_dir)
    total = sum(counts.values())
    size_bytes = sum(p.stat().st_size for p in Path(tile_dir).rglob("*.png"))

    print(f"\n✅ Done in {elapsed:.1f}s")
    print(f"📊 Tiles: {total:,} ({size_bytes / 1e6:.1f} MB)")
    print(f"📈 Per zoom: {', '.join(f'z{z}={counts.get(z, 0):,}' for z in sorted(counts.keys()))}")

    # Generate usage example
    print(f"\n📖 Usage example:")
    print(f"  from openzenith import get_elevation, load_tiles")
    print(f"  load_tiles(zoom_levels={zoom_levels})")
    print(f"  elev = get_elevation({(lat_min+lat_max)/2:.4f}, {(lon_min+lon_max)/2:.4f})")
    print(f"  # => {elev}m")

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
    """Parse zoom level specification: '0-8' or '0,1,2,5' or '8' or '0-3,5,7-9'."""
    result: set[int] = set()
    for part in s.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            lo, hi = int(a), int(b)
            if lo > hi:
                raise ValueError(f"Invalid range {lo}-{hi}")
            result.update(range(lo, hi + 1))
        else:
            result.add(int(part))
    return sorted(result)

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

    # slope
    sl = sub.add_parser("slope", help="Compute terrain slope")
    sl.add_argument("--lat", type=float, required=True)
    sl.add_argument("--lon", type=float, required=True)
    sl.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    sl.add_argument("--output", type=str, default=None, help="Output .npy file")

    # hillshade
    hs = sub.add_parser("hillshade", help="Compute analytical hillshade")
    hs.add_argument("--lat", type=float, required=True)
    hs.add_argument("--lon", type=float, required=True)
    hs.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    hs.add_argument("--azimuth", type=float, default=315, help="Light azimuth (0=N, 90=E)")
    hs.add_argument("--altitude", type=float, default=45, help="Light altitude (0-90°)")
    hs.add_argument("--z-factor", type=float, default=1.0, help="Vertical exaggeration")
    hs.add_argument("--output", type=str, default=None, help="Output PNG or .npy file")

    # viewshed
    vw = sub.add_parser("viewshed", help="Compute viewshed from observer point")
    vw.add_argument("--lat", type=float, required=True)
    vw.add_argument("--lon", type=float, required=True)
    vw.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    vw.add_argument("--height", type=float, default=1.75, help="Observer height (meters)")
    vw.add_argument("--max-dist", type=int, default=None, help="Max distance in cells")
    vw.add_argument("--output", type=str, default=None, help="Output PNG or .npy file")

    # twi
    tw = sub.add_parser("twi", help="Compute Topographic Wetness Index")
    tw.add_argument("--lat", type=float, required=True)
    tw.add_argument("--lon", type=float, required=True)
    tw.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    tw.add_argument("--output", type=str, default=None, help="Output .npy file")

    # contour
    ct = sub.add_parser("contour", help="Export DEM contours as GeoJSON")
    ct.add_argument("--lat", type=float, required=True)
    ct.add_argument("--lon", type=float, required=True)
    ct.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    ct.add_argument("--interval", type=float, default=100, help="Contour interval in meters")
    ct.add_argument("--output", type=str, default=None, help="Output .geojson file")

    # geojson
    gj = sub.add_parser("geojson", help="Export terrain grid as GeoJSON points")
    gj.add_argument("--lat", type=float, required=True)
    gj.add_argument("--lon", type=float, required=True)
    gj.add_argument("--radius", type=int, default=10, help="Grid radius in tiles")
    gj.add_argument("--kind", type=str, default="elevation", help="Data kind label")
    gj.add_argument("--name", type=str, default=None, help="Property name")
    gj.add_argument("--output", type=str, default=None, help="Output .geojson file")

    # encode
    en = sub.add_parser("encode", help="Encode GeoTIFF or raw DEM to OZT2 format")
    en.add_argument("input", help="Input file or directory")
    en.add_argument("output", help="Output .ozt2 file or directory")
    en.add_argument("--format", default="auto", choices=["auto", "geotiff", "rawint16", "merged"],
                    help="Input format (auto=detect from extension)")
    en.add_argument("--max-rmse", type=float, default=1.0,
                    help="Max RMSE for adaptive bit-depth selection (meters)")
    en.add_argument("--bits", type=int, choices=[8, 10, 12, 16], default=None,
                    help="Force fixed bit depth (default=auto)")
    en.add_argument("--predictor", default="gradient",
                    choices=["none", "left", "gradient"],
                    help="Prediction method (default=gradient)")
    en.add_argument("--validate", action="store_true",
                    help="Validate roundtrip after encoding")
    en.add_argument("--quiet", "-q", action="store_true", help="Suppress per-file output")

    # ingest
    ig = sub.add_parser("ingest", help="Prepare a contributed dataset for submission")
    ig.add_argument("dataset", help="Dataset directory containing DEM files")
    ig.add_argument("--name", required=True, help="Dataset name (e.g. 'alos-aw3d-30m-japan')")
    ig.add_argument("--description", required=True, help="Human-readable description")
    ig.add_argument("--license", default="CC-BY-4.0", help="License (default=CC-BY-4.0)")
    ig.add_argument("--source-url", default="", help="Original data source URL")
    ig.add_argument("--contributor", default="", help="Contributor contact (email or handle)")
    ig.add_argument("--output", "-o", default="./dataset_bundle", help="Output bundle directory")

    # tiles
    tl = sub.add_parser("tiles", help="Download tiles for a specific region")
    tl.add_argument("--bbox", type=str, default=None, help="Bounding box: lat_min,lon_min,lat_max,lon_max")
    tl.add_argument("--region", type=str, default=None, help="Named region (europe, usa, world, etc.)")
    tl.add_argument("--lat", type=float, default=None, help="Center latitude")
    tl.add_argument("--lon", type=float, default=None, help="Center longitude")
    tl.add_argument("--radius", type=float, default=0.5, help="Radius in degrees (default: 0.5)")
    tl.add_argument("--zoom", type=str, default=None, help="Zoom levels (e.g. '5-10' or '5,8,10')")
    tl.add_argument("--cache-dir", type=str, default=None, help="Local cache directory")
    tl.add_argument("--force", action="store_true", help="Proceed with large downloads")

    args = parser.parse_args()

    commands = {
        "download": cmd_download,
        "query": cmd_query,
        "trace": cmd_trace,
        "watershed": cmd_watershed,
        "info": cmd_info,
        "validate": cmd_validate,
        "slope": cmd_slope,
        "hillshade": cmd_hillshade,
        "viewshed": cmd_viewshed,
        "twi": cmd_twi,
        "contour": cmd_contour,
        "geojson": cmd_geojson,
        "encode": cmd_encode,
        "ingest": cmd_ingest,
        "tiles": cmd_tiles,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
