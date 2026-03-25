#!/usr/bin/env python3
"""
Extract 256x256 internal tiles from SRTM GeoTIFF files.

Reads each .tif file, parses the IFD to find tile offsets/byte counts,
and extracts the raw compressed tile data into individual .deflate files.

Output structure:
  {output_dir}/
    N00/
      E006_00_00.deflate
      E006_00_01.deflate
      ...
    N28/
      E096_00_00.deflate
      ...
"""

import os
import struct
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed

# TIFF type sizes in bytes
TIFF_TYPE_SIZES = {
    1: 1,    # BYTE
    2: 1,    # ASCII
    3: 2,    # SHORT
    4: 4,    # LONG
    5: 8,    # RATIONAL
    6: 1,    # SBYTE
    7: 1,    # UNDEFINED
    8: 2,    # SSHORT
    9: 4,    # SLONG
    10: 8,   # SRATIONAL
    11: 4,   # FLOAT
    12: 8,   # DOUBLE
    16: 8,   # LONG8
    17: 8,   # SLONG8
}

# TIFF tags we need
TAG_IMAGE_WIDTH = 256
TAG_IMAGE_LENGTH = 257
TAG_TILE_WIDTH = 322
TAG_TILE_LENGTH = 323
TAG_TILE_OFFSETS = 324
TAG_TILE_BYTE_COUNTS = 325


def parse_tif_ifd(filepath):
    """Parse GeoTIFF IFD to extract tile offsets and byte counts."""
    with open(filepath, "rb") as f:
        header = f.read(4096)

    # TIFF header
    byte_order = header[0:2]
    if byte_order == b"II":
        endian = "<"
    elif byte_order == b"MM":
        endian = ">"
    else:
        raise ValueError(f"Invalid byte order: {byte_order}")

    magic = struct.unpack_from(endian + "H", header, 2)[0]
    if magic != 42:
        raise ValueError(f"Invalid TIFF magic: {magic}")

    ifd_offset = struct.unpack_from(endian + "I", header, 4)[0]
    num_entries = struct.unpack_from(endian + "H", header, ifd_offset)[0]

    tile_offsets = []
    tile_byte_counts = []
    image_width = 0
    image_length = 0
    tile_width = 256
    tile_length = 256

    for i in range(num_entries):
        off = ifd_offset + 2 + i * 12
        tag = struct.unpack_from(endian + "H", header, off)[0]
        type_id = struct.unpack_from(endian + "H", header, off + 2)[0]
        count = struct.unpack_from(endian + "I", header, off + 4)[0]
        type_size = TIFF_TYPE_SIZES.get(type_id, 1)
        total_size = count * type_size

        if tag == TAG_IMAGE_WIDTH:
            image_width = struct.unpack_from(endian + "I", header, off + 8)[0]
        elif tag == TAG_IMAGE_LENGTH:
            image_length = struct.unpack_from(endian + "I", header, off + 8)[0]
        elif tag == TAG_TILE_WIDTH:
            tile_width = struct.unpack_from(endian + "I", header, off + 8)[0]
        elif tag == TAG_TILE_LENGTH:
            tile_length = struct.unpack_from(endian + "I", header, off + 8)[0]
        elif tag == TAG_TILE_OFFSETS:
            if total_size <= 4:
                ptr = off + 8
            else:
                ptr = struct.unpack_from(endian + "I", header, off + 8)[0]
            tile_offsets = [
                struct.unpack_from(endian + "I", header, ptr + j * 4)[0]
                for j in range(count)
            ]
        elif tag == TAG_TILE_BYTE_COUNTS:
            if total_size <= 4:
                ptr = off + 8
            else:
                ptr = struct.unpack_from(endian + "I", header, off + 8)[0]
            tile_byte_counts = [
                struct.unpack_from(endian + "I", header, ptr + j * 4)[0]
                for j in range(count)
            ]

    tiles_across = (image_width + tile_width - 1) // tile_width
    tiles_down = (image_length + tile_length - 1) // tile_length

    return {
        "image_width": image_width,
        "image_length": image_length,
        "tile_width": tile_width,
        "tile_length": tile_length,
        "tiles_across": tiles_across,
        "tiles_down": tiles_down,
        "tile_offsets": tile_offsets,
        "tile_byte_counts": tile_byte_counts,
    }


def extract_tif_chunks(tif_path, output_base):
    """Extract all internal tiles from one TIF file."""
    basename = os.path.basename(tif_path).replace(".tif", "").replace(".tiff", "")
    lat_dir = basename[:3]  # e.g., "N28", "S05"

    ifd = parse_tif_ifd(tif_path)
    out_dir = os.path.join(output_base, lat_dir)
    os.makedirs(out_dir, exist_ok=True)

    tiles_across = ifd["tiles_across"]

    with open(tif_path, "rb") as f:
        for i, (offset, length) in enumerate(
            zip(ifd["tile_offsets"], ifd["tile_byte_counts"])
        ):
            row = i // tiles_across
            col = i % tiles_across
            f.seek(offset)
            data = f.read(length)

            out_name = f"{basename}_{row:02d}_{col:02d}.deflate"
            out_path = os.path.join(out_dir, out_name)
            with open(out_path, "wb") as out:
                out.write(data)

    return basename, len(ifd["tile_offsets"])


def verify_chunk(tif_path, output_base):
    """Verify one chunk by decompressing and checking dimensions."""
    basename = os.path.basename(tif_path).replace(".tif", "").replace(".tiff", "")
    lat_dir = basename[:3]

    ifd = parse_tif_ifd(tif_path)
    tiles_across = ifd["tiles_across"]

    # Check first tile (always full 256x256)
    chunk_path = os.path.join(output_base, lat_dir, f"{basename}_00_00.deflate")
    if not os.path.exists(chunk_path):
        return False, "chunk file not found"

    with open(chunk_path, "rb") as f:
        compressed = f.read()

    try:
        decompressed = zlib.decompress(compressed)
    except zlib.error as e:
        return False, f"decompress failed: {e}"

    expected_size = 256 * 256 * 2  # Int16 = 2 bytes per pixel
    if len(decompressed) != expected_size:
        return False, f"size mismatch: {len(decompressed)} != {expected_size}"

    return True, "OK"


def extract_all(src_dir, output_base, workers=4, verify=True):
    """Extract chunks from all TIF files in parallel."""
    tif_files = sorted(
        f for f in os.listdir(src_dir) if f.endswith(".tif") or f.endswith(".tiff")
    )
    tif_paths = [os.path.join(src_dir, f) for f in tif_files]

    print(f"Extracting {len(tif_files)} TIF files from {src_dir}")
    print(f"Output: {output_base}")
    print(f"Workers: {workers}")
    print("=" * 80)

    total_chunks = 0
    total_bytes = 0
    errors = []

    start = time.time()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(extract_tif_chunks, p, output_base): p
            for p in tif_paths
        }
        for i, future in enumerate(as_completed(futures)):
            try:
                name, count = future.result()
                total_chunks += count
                # Sum file sizes for this SRTM tile
                lat_dir = name[:3]
                tile_dir = os.path.join(output_base, lat_dir)
                chunk_bytes = sum(
                    os.path.getsize(os.path.join(tile_dir, f))
                    for f in os.listdir(tile_dir)
                    if f.startswith(name) and f.endswith(".deflate")
                )
                total_bytes += chunk_bytes

                elapsed = time.time() - start
                rate = total_bytes / elapsed / 1e6 if elapsed > 0 else 0
                pct = (i + 1) / len(tif_files) * 100
                eta = (len(tif_files) - i - 1) * (elapsed / (i + 1))

                print(
                    f"  [{pct:5.1f}%] {name}: {count} chunks "
                    f"({chunk_bytes/1024:.0f}KB total) "
                    f"{rate:.1f}MB/s ETA:{eta:.0f}s"
                )

                # Verify first tile of every 100th file
                if verify and (i + 1) % 100 == 0:
                    ok, msg = verify_chunk(
                        os.path.join(src_dir, name + ".tif"), output_base
                    )
                    if not ok:
                        errors.append(f"{name}: {msg}")
                        print(f"    VERIFY FAILED: {msg}")

            except Exception as e:
                errors.append(f"unknown: {e}")

    elapsed = time.time() - start
    print("=" * 80)
    print(f"Done! {total_chunks:,} chunks extracted in {elapsed:.0f}s")
    print(f"Total size: {total_bytes/1e9:.1f} GB")
    if errors:
        print(f"Errors: {len(errors)}")
        for err in errors:
            print(f"  - {err}")


if __name__ == "__main__":
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m"
    output_base = sys.argv[2] if len(sys.argv) > 2 else "/nas/Temp/DEMs/data/srtm30m-chunks"
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    extract_all(src_dir, output_base, workers)
