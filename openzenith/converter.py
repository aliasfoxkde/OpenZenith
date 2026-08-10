"""SRTM 30m GeoTIFF to OZT1 converter."""

import json
import os
import time

import numpy as np

from .geo_utils import classify_terrain, load_geotiff, srtm_filename_to_bounds
from .tile_format import COMP_ZSTD_PREDICT, decode, encode


def convert_tile(
    src_path: str,
    dst_dir: str,
    compression: int = COMP_ZSTD_PREDICT,
    zstd_level: int = 9,
    quantize_bits: int | None = None,
    verify: bool = True,
) -> dict:
    """Convert a single GeoTIFF tile to OZT1 format.

    Returns metadata dict with compression stats.
    """
    name = os.path.basename(src_path)
    t0 = time.time()

    # Load source
    arr = load_geotiff(src_path)
    src_size = os.path.getsize(src_path)

    # Encode
    encoded = encode(
        arr,
        bits_per_sample=16,
        nodata_value=-32768,
        compression=compression,
        zstd_level=zstd_level,
        quantize_bits=quantize_bits,
    )

    encode_time = time.time() - t0

    # Verify round-trip
    verified = False
    rmse = 0.0
    if verify:
        decoded, meta = decode(encoded)
        valid = arr != -32768
        if quantize_bits and quantize_bits < 16:
            rmse = float(np.sqrt(np.mean((arr[valid] - decoded[valid]) ** 2)))
            verified = True
        else:
            verified = np.array_equal(arr, decoded)
            if not verified:
                rmse = float(np.max(np.abs(arr[valid] - decoded[valid])))

    # Write output
    os.makedirs(dst_dir, exist_ok=True)
    dst_name = name.replace(".tif", ".ozt1").replace(".tiff", ".ozt1")
    dst_path = os.path.join(dst_dir, dst_name)
    with open(dst_path, "wb") as f:
        f.write(encoded)

    # Compute bounds
    lat_min, lon_min, lat_max, lon_max = srtm_filename_to_bounds(name)
    terrain = classify_terrain(arr)

    total_time = time.time() - t0
    reduction = (1 - len(encoded) / src_size) * 100

    result = {
        "source": name,
        "output": dst_name,
        "source_bytes": src_size,
        "output_bytes": len(encoded),
        "reduction_pct": round(reduction, 2),
        "compression_ratio": round(src_size / len(encoded), 2),
        "compression": meta.get("compression_name", "unknown") if verify else str(compression),
        "zstd_level": zstd_level,
        "quantize_bits": quantize_bits,
        "rmse": round(rmse, 4),
        "verified": verified,
        "encode_time_s": round(encode_time, 3),
        "total_time_s": round(total_time, 3),
        "shape": list(arr.shape),
        "bounds": {
            "lat_min": lat_min,
            "lon_min": lon_min,
            "lat_max": lat_max,
            "lon_max": lon_max,
        },
        "terrain_type": terrain,
        "elevation_range": [int(arr[arr != -32768].min()), int(arr[arr != -32768].max())],
    }

    return result


def convert_directory(
    src_dir: str,
    dst_dir: str,
    compression: int = COMP_ZSTD_PREDICT,
    zstd_level: int = 9,
    quantize_bits: int | None = None,
    max_tiles: int | None = None,
    pattern: str | None = None,
) -> list[dict]:
    """Convert all GeoTIFF files in a directory.

    Args:
        src_dir: Source directory with .tif files
        dst_dir: Output directory for .ozt1 files
        compression: Compression mode
        zstd_level: Zstd compression level
        quantize_bits: Quantization bit depth (None=lossless)
        max_tiles: Maximum number of tiles to convert
        pattern: Optional glob pattern to filter files
    """
    files = sorted([f for f in os.listdir(src_dir) if f.endswith((".tif", ".tiff"))])

    if pattern:
        import fnmatch

        files = [f for f in files if fnmatch.fnmatch(f, pattern)]

    if max_tiles:
        files = files[:max_tiles]

    results = []
    total_src = 0
    total_dst = 0

    print(f"Converting {len(files)} tiles from {src_dir}")
    print(f"Output: {dst_dir}")
    print(f"Compression: zstd level {zstd_level}, quantize={quantize_bits if quantize_bits else 'lossless'}")
    print("=" * 80)

    for i, fname in enumerate(files):
        src_path = os.path.join(src_dir, fname)
        try:
            result = convert_tile(
                src_path,
                dst_dir,
                compression=compression,
                zstd_level=zstd_level,
                quantize_bits=quantize_bits,
                verify=True,
            )
            total_src += result["source_bytes"]
            total_dst += result["output_bytes"]

            status = "OK" if result["verified"] else "WARN"
            err_str = f" RMSE={result['rmse']}m" if result["rmse"] > 0 else ""
            print(
                f"  [{i + 1:4d}/{len(files)}] {status} {fname} → {result['output']} "
                f"({result['source_bytes'] / 1024:.0f}K → {result['output_bytes'] / 1024:.0f}K, "
                f"{result['reduction_pct']:.1f}%){err_str}"
            )

            results.append(result)
        except OSError as e:
            print(f"  [{i + 1:4d}/{len(files)}] FAIL {fname}: {e}")
            results.append({"source": fname, "error": str(e)})

    # Summary
    successful = [r for r in results if "error" not in r]
    total_reduction = (1 - total_dst / total_src) * 100 if total_src > 0 else 0

    print("=" * 80)
    print(f"Converted: {len(successful)}/{len(files)} tiles")
    print(f"Total: {total_src / 1e9:.2f} GB → {total_dst / 1e9:.2f} GB ({total_reduction:.1f}% reduction)")

    # Save conversion manifest
    manifest = {
        "source_dir": src_dir,
        "output_dir": dst_dir,
        "compression": compression,
        "zstd_level": zstd_level,
        "quantize_bits": quantize_bits,
        "tiles_converted": len(successful),
        "total_source_bytes": total_src,
        "total_output_bytes": total_dst,
        "total_reduction_pct": round(total_reduction, 2),
        "results": successful,
    }

    manifest_path = os.path.join(dst_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Manifest saved to {manifest_path}")
    return results
