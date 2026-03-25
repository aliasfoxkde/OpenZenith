#!/usr/bin/env python3
"""Convert SRTM 30m GeoTIFF tiles to OZT1 format.

Usage:
    python scripts/convert_srtm.py [--src DIR] [--dst DIR] [--mode MODE] [--level N] [--quantize N] [--max N]

Modes:
    lossless     - No data loss (default, Predict+Zstd)
    high         - Q12 quantization (0.7m RMSE)
    balanced     - Q10 quantization (1.6m RMSE)
    visual       - Q8 quantization (5.8m RMSE)
    aggressive   - Q10 + Delta + Zstd level 19
"""

import argparse
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openzenith.converter import convert_directory
from openzenith.tile_format import COMP_ZSTD_PREDICT, COMP_ZSTD_DELTA, COMP_ZSTD


MODES = {
    "lossless": {"compression": COMP_ZSTD_PREDICT, "zstd_level": 9, "quantize_bits": None},
    "high": {"compression": COMP_ZSTD_PREDICT, "zstd_level": 9, "quantize_bits": 12},
    "balanced": {"compression": COMP_ZSTD_PREDICT, "zstd_level": 9, "quantize_bits": 10},
    "visual": {"compression": COMP_ZSTD_PREDICT, "zstd_level": 9, "quantize_bits": 8},
    "aggressive": {"compression": COMP_ZSTD_DELTA, "zstd_level": 19, "quantize_bits": 10},
}


def main():
    parser = argparse.ArgumentParser(description="Convert SRTM 30m GeoTIFF to OZT1")
    parser.add_argument("--src", default="/nas/Temp/DEMs/data/srtm30m",
                        help="Source directory with .tif files")
    parser.add_argument("--dst", default=None,
                        help="Output directory (default: ./data/srtm30m/{mode})")
    parser.add_argument("--mode", default="lossless", choices=MODES.keys(),
                        help="Compression mode")
    parser.add_argument("--level", type=int, default=None,
                        help="Override Zstd level (1-22)")
    parser.add_argument("--quantize", type=int, default=None,
                        help="Override quantize bits (None=lossless)")
    parser.add_argument("--max", type=int, default=None,
                        help="Max tiles to convert")
    parser.add_argument("--pattern", default=None,
                        help="File pattern filter (e.g., 'N2*.tif')")
    args = parser.parse_args()

    config = MODES[args.mode].copy()
    if args.level is not None:
        config["zstd_level"] = args.level
    if args.quantize is not None:
        config["quantize_bits"] = args.quantize

    if args.dst is None:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        dst = os.path.join(project_root, "data", "srtm30m", args.mode)
    else:
        dst = args.dst

    # Subdir for AVIF comparison
    convert_directory(
        src_dir=args.src,
        dst_dir=dst,
        compression=config["compression"],
        zstd_level=config["zstd_level"],
        quantize_bits=config["quantize_bits"],
        max_tiles=args.max,
        pattern=args.pattern,
    )


if __name__ == "__main__":
    main()
