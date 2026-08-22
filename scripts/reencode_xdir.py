#!/usr/bin/env python3
"""Re-encode all ZSTD tiles in a single x-dir to Brotli. Run via xargs -P."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from openzenith.tile_format_v2 import decode, encode, COMP_BROTLI, COMP_ZSTD

NODATA = -32768


def reencode_tile(path: Path) -> dict:
    """Re-encode a single ZSTD tile as Brotli."""
    try:
        with open(path, "rb") as f:
            header = f.read(6)
        if len(header) < 6:
            return {"path": str(path), "status": "error", "error": "truncated header"}
        vmin = int.from_bytes(header[0:2], "little", signed=True)
        vrange = int.from_bytes(header[2:4], "little", signed=False)
        bits = header[4]
        flags = header[5]
        pred = flags & 0x03
        comp = (flags >> 2) & 0x03

        if comp == COMP_BROTLI:
            return {"path": str(path), "status": "skip"}
        if comp != COMP_ZSTD:
            return {"path": str(path), "status": "skip", "reason": f"not_zstd(comp={comp})"}

        data = path.read_bytes()
        elevation, meta = decode(data)
        compressed = encode(
            elevation,
            predictor=pred,
            bits_per_pixel=bits,
            compressor=COMP_BROTLI,
            compress_level=4,
            nodata_value=NODATA,
        )
        path.write_bytes(compressed)
        return {"path": str(path), "status": "ok", "size": len(compressed)}
    except Exception as e:
        return {"path": str(path), "status": "error", "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: reencode_xdir.py <x-dir>", file=sys.stderr)
        sys.exit(1)
    xdir = Path(sys.argv[1])
    if not xdir.is_dir():
        print(f"Not a directory: {xdir}", file=sys.stderr)
        sys.exit(1)

    ok = errors = skipped = 0
    for t in sorted(xdir.glob("*.ozt2")):
        r = reencode_tile(t)
        if r["status"] == "ok":
            ok += 1
        elif r["status"] == "skip":
            skipped += 1
        else:
            errors += 1
            print(f"ERROR {r['path']}: {r['error']}", file=sys.stderr)

    print(f"{xdir}: ok={ok} skip={skipped} error={errors}")
