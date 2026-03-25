#!/usr/bin/env python3
"""
Merge individual 256x256 deflate chunks into single files per SRTM tile.

Binary format (.merged):
  [8 bytes] Magic: "OZCHNK01"
  [2 bytes] Version: 1
  [2 bytes] Rows: 15 (chunks per row)
  [2 bytes] Cols: 15 (chunks per col)
  [225 * 8 bytes] Index: [4-byte offset, 4-byte size] for each chunk (row-major)
  [variable] Concatenated deflate-compressed chunk data

Each chunk is the raw deflate output from the GeoTIFF internal tiles.
To extract chunk (row, col): read index at offset 16 + (row*15 + col)*8,
then seek to that offset and read that many bytes.

Usage: python3 scripts/merge_chunks.py [source_dir] [output_dir]
"""

import os
import struct
import sys
from concurrent.futures import ProcessPoolExecutor

MAGIC = b"OZCHNK01"
VERSION = 1
ROWS = 15
COLS = 15
INDEX_ENTRY_SIZE = 8
HEADER_SIZE = 12  # 8 magic + 2 version + 1 rows + 1 cols
INDEX_SIZE = ROWS * COLS * INDEX_ENTRY_SIZE


def merge_srtm_tile(args: tuple[str, str, str]) -> tuple[str, int, bool]:
    """Merge all chunks for one SRTM tile into a single file."""
    source_dir, output_dir, tile_base = args
    lat_dir = tile_base[:3]

    # Find all chunks for this tile
    chunks = {}
    prefix = f"{tile_base}_"
    for fname in os.listdir(os.path.join(source_dir, lat_dir)):
        if fname.startswith(prefix) and fname.endswith(".deflate"):
            # Parse row and col from filename: {base}_{row:02d}_{col:02d}.deflate
            parts = fname[len(prefix):-len(".deflate")].split("_")
            if len(parts) == 2:
                row = int(parts[0])
                col = int(parts[1])
                filepath = os.path.join(source_dir, lat_dir, fname)
                chunks[(row, col)] = os.path.getsize(filepath)

    if not chunks:
        return (tile_base, 0, False)

    # Sort by position
    sorted_keys = sorted(chunks.keys())

    # Calculate offsets
    data_offset = HEADER_SIZE + INDEX_SIZE
    index_entries = []
    current_offset = data_offset

    for (row, col) in sorted_keys:
        size = chunks[(row, col)]
        index_entries.append((current_offset, size))
        current_offset += size

    # Write merged file
    out_dir = os.path.join(output_dir, lat_dir)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{tile_base}.merged")

    with open(out_path, "wb") as f:
        # Header
        f.write(MAGIC)
        f.write(struct.pack("<HBB", VERSION, ROWS, COLS))

        # Index
        for offset, size in index_entries:
            f.write(struct.pack("<II", offset, size))

        # Data
        for (row, col) in sorted_keys:
            src_path = os.path.join(source_dir, lat_dir, f"{tile_base}_{row:02d}_{col:02d}.deflate")
            with open(src_path, "rb") as src:
                while True:
                    block = src.read(1 << 20)  # 1MB blocks
                    if not block:
                        break
                    f.write(block)

    return (tile_base, len(chunks), True)


def main():
    source_dir = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "/nas/Temp/DEMs/data/srtm30m-merged"

    os.makedirs(output_dir, exist_ok=True)

    # Find all SRTM tile bases
    tile_bases = set()
    for lat_dir in sorted(os.listdir(source_dir)):
        lat_path = os.path.join(source_dir, lat_dir)
        if not os.path.isdir(lat_path) or lat_dir[0] not in ("N", "S"):
            continue
        for fname in os.listdir(lat_path):
            if fname.endswith(".deflate"):
                # Extract tile base: N00E006_00_00.deflate -> N00E006
                parts = fname.split("_")
                if len(parts) >= 3:
                    tile_bases.add(parts[0])

    print(f"Found {len(tile_bases)} unique SRTM tiles")
    print(f"Output: {output_dir}")
    print("=" * 60)

    # Process in parallel
    args_list = [
        (source_dir, output_dir, tile_base)
        for tile_base in sorted(tile_bases)
    ]

    total_chunks = 0
    total_files = 0
    errors = 0

    with ProcessPoolExecutor(max_workers=8) as executor:
        for i, (tile_base, count, success) in enumerate(executor.map(merge_srtm_tile, args_list)):
            if success:
                total_chunks += count
                total_files += 1
                if (i + 1) % 500 == 0:
                    print(f"  [{i+1}/{len(tile_bases)}] {tile_base}: {count} chunks", flush=True)
            else:
                errors += 1

    print("=" * 60)
    print(f"Done! {total_files} merged files, {total_chunks} total chunks, {errors} errors")

    # Report size
    total_size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, dn, filenames in os.walk(output_dir)
        for f in filenames
    )
    print(f"Total size: {total_size / 1e9:.1f} GB")


if __name__ == "__main__":
    main()
