#!/usr/bin/env python3
"""
Fast SRTM tile index builder — reads only file headers, not compressed data.

Scans all .merged files in a directory and builds a dict of:
  (lat_deg, lon_deg) → {exists: True, has_data: bool, rows: int, cols: int}

This is used by convert_to_ozt2.py to pre-filter which Mercator tiles
need to be generated (skip ocean-only tiles).

Reads only 12 + rows*cols*8 bytes per file — ~1.8KB vs full file (~1.5MB).
"""

import argparse
import struct
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

MAGIC = b"OZCHNK01"
HEADER_SIZE = 12
INDEX_ENTRY_SIZE = 8


def scan_merged_header(path: Path) -> dict | None:
    """Read only the header and index from a .merged file.

    Returns dict with {exists, has_data, rows, cols} or None on error.
    """
    try:
        with open(path, "rb") as f:
            # Read header + full index (never more than ~1.8KB for 15×15 chunks)
            # For 225 chunks: 12 + 225*8 = 1812 bytes
            # Read extra to handle any extra-large tiles
            data = f.read(4096)

        if len(data) < HEADER_SIZE:
            return None
        if data[:8] != MAGIC:
            return None

        version = struct.unpack_from("<H", data, 8)[0]
        rows = data[10]
        cols = data[11]

        if rows == 0 or cols == 0:
            return None

        # Check if any chunk has non-zero size
        has_data = False
        index_start = HEADER_SIZE
        for i in range(rows * cols):
            off = index_start + i * INDEX_ENTRY_SIZE
            if off + 4 > len(data):
                break
            size = struct.unpack_from("<I", data, off + 4)[0]
            if size > 0:
                has_data = True
                break

        return {"exists": True, "has_data": has_data, "rows": rows, "cols": cols}
    except Exception:
        return None


def scan_directory(merged_dir: Path) -> dict:
    """Scan all .merged files in a directory tree.

    Returns {(lat_deg, lon_deg): {exists, has_data, rows, cols}, ...}
    """
    result = {}

    for lat_dir in sorted(merged_dir.iterdir()):
        if not lat_dir.is_dir():
            continue
        for merged_file in sorted(lat_dir.glob("*.merged")):
            name = merged_file.stem
            lat_str = name[:3]
            lon_str = name[3:]
            try:
                lat_deg = int(lat_str[1:])
                if lat_str[0] == "S":
                    lat_deg = -lat_deg
                lon_deg = int(lon_str[1:])
                if lon_str[0] == "W":
                    lon_deg = -lon_deg
            except ValueError:
                continue

            info = scan_merged_header(merged_file)
            if info:
                result[(lat_deg, lon_deg)] = info

    return result


def scan_directory_parallel(merged_dir: Path, workers: int = 32) -> dict:
    """Parallel version — scan all .merged files using multiple processes."""
    files = []
    for lat_dir in sorted(merged_dir.iterdir()):
        if not lat_dir.is_dir():
            continue
        for merged_file in sorted(lat_dir.glob("*.merged")):
            files.append(merged_file)

    result = {}

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_scan_one, f): f for f in files}
        for future in as_completed(futures):
            r = future.result()
            if r:
                lat_deg, lon_deg, info = r
                result[(lat_deg, lon_deg)] = info

    return result


def _scan_one(path: Path):
    """Scan a single file — module-level function for pickling."""
    name = path.stem
    lat_str = name[:3]
    lon_str = name[3:]
    try:
        lat_deg = int(lat_str[1:])
        if lat_str[0] == "S":
            lat_deg = -lat_deg
        lon_deg = int(lon_str[1:])
        if lon_str[0] == "W":
            lon_deg = -lon_deg
    except ValueError:
        return None
    info = scan_merged_header(path)
    if info:
        return (lat_deg, lon_deg, info)
    return None


def save_index(index: dict, path: Path) -> None:
    """Save index to a JSON file."""
    import json
    # Convert tuple keys to string for JSON
    serializable = {f"{k[0]},{k[1]}": v for k, v in index.items()}
    path.write_text(json.dumps(serializable, indent=2))
    print(f"  Saved index: {path} ({len(index)} tiles)")


def load_index(path: Path) -> dict:
    """Load index from JSON file."""
    import json
    raw = json.loads(path.read_text())
    return {tuple(map(int, k.split(","))): v for k, v in raw.items()}


if __name__ == "__main__":
    import time

    parser = argparse.ArgumentParser(description="Build SRTM tile index from .merged headers")
    parser.add_argument("--input", "-i", required=True, help="Path to SRTM .merged files")
    parser.add_argument("--output", "-o", help="Save index to JSON file")
    parser.add_argument("--workers", "-w", type=int, default=32)
    args = parser.parse_args()

    merged_dir = Path(args.input)
    index_path = Path(args.output) if args.output else None

    print(f"Scanning {merged_dir}...")
    t0 = time.time()

    if index_path and index_path.exists():
        print(f"  Loading cached index from {index_path}")
        index = load_index(index_path)
    else:
        index = scan_directory_parallel(merged_dir, workers=args.workers)

    t1 = time.time()
    has_data = sum(1 for v in index.values() if v["has_data"])
    print(f"  Scanned {len(index)} tiles in {t1 - t0:.1f}s")
    print(f"  Tiles with data: {has_data}")
    print(f"  Empty tiles: {len(index) - has_data}")

    if index_path:
        save_index(index, index_path)

    print(f"\nSample entries:")
    for i, ((lat, lon), info) in enumerate(list(index.items())[:5]):
        print(f"  N{abs(lat)}{'S' if lat < 0 else ''} {abs(lon)}{'W' if lon < 0 else 'E'}: {info}")
