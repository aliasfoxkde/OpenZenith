#!/usr/bin/env python3
"""Build a PMTiles v3 archive of Terrarium PNG elevation tiles from local OZT2.

Pipeline per tile:
    data/ozt2_tiles/z{z}/{x}/{y}.ozt2
      -> openzenith.tile_format_v2.decode (brotli/zstd/zlib chosen per flags byte)
      -> 256x256 int16 elevation grid
      -> Terrarium PNG (openzenith.terrarium.encode_tile)
      -> PMTiles tile entry, written in ascending Hilbert tile-id order

Terrarium encoding (identical semantics to the API's encoder in
``api/src/lib/terrarium-png.ts``): R = floor((elev + 32768) / 256),
G = (elev + 32768) % 256, B = 0. Source grids are int16 so the fractional
channel is always 0, and NoData (-32768) shifts to 0,0,0 — which is exactly
how ``terrarium.py``'s decoder and every Terrarium client read NoData.
``terrarium.py`` itself has no explicit NoData branch for this case; passing
``nodata=-32768`` is what produces the (0,0,0) pixels, so the archive and the
``/api/dem-tile/{z}/{x}/{y}`` PNGs stay byte-comparable in meaning.

Archive settings:
    tile_compression    NONE  — the tiles are already-compressed PNGs; declaring
                                NONE stops GDAL/MapLibre from trying to inflate
                                them a second time.
    internal_compression GZIP — v3 default, applied to the root/leaf directories
                                and the JSON metadata (handled by pmtiles.Writer).
    clustering          tiles are written in ascending tile-id (Hilbert) order,
                        so the header reports ``clustered: true`` and a range
                        request for a neighbourhood of tiles reads one span.
                        Skipping a full Hilbert re-sort of the *bytes* only
                        costs a little locality for sparse archives like this
                        one; consumers do not require it.

Output is a single self-contained ``z{zoom}.pmtiles`` served with HTTP Range
from the HuggingFace dataset repo (see upload step in the E4 runbook), which
GDAL's ``/vsicurl`` + PMTiles driver and MapLibre's pmtiles protocol read
without downloading the whole file.

Usage:
    # Smoke build — first 16 tiles in tile-id order
    python scripts/build_pmtiles_z7.py --limit 16 --out /tmp/z7-smoke.pmtiles

    # Full z7 archive
    python scripts/build_pmtiles_z7.py
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import write
except ImportError as err:  # pragma: no cover - environment guard
    raise SystemExit(
        f"pmtiles is required to build an archive ({err}). Install: pip install pmtiles"
    ) from err

from openzenith.terrarium import encode_tile
from openzenith.tile_format_v2 import decode as decode_ozt2

NODATA = -32768
TILE_SIZE = 256
ATTRIBUTION = "OpenZenith — terrain from NASA SRTM 30m (GEBCO 2025 bathymetry)"


def tile_coords(zoom: int, path: Path) -> tuple[int, int] | None:
    """(x, y) for a ``{x}/{y}.ozt2`` path, or None when it is out of bounds.

    Stray paths do exist in the source tree (a 16-byte stub at
    ``z7/2/999.ozt2`` among them); they are reported and skipped rather than
    allowed to abort a multi-thousand-tile build.
    """
    x, y = int(path.parent.name), int(path.stem)
    n = 2**zoom
    if not (0 <= x < n and 0 <= y < n):
        return None
    return x, y


def tile_id_of(zoom: int, path: Path) -> int:
    """Hilbert tile id for a ``{x}/{y}.ozt2`` path under a zoom directory."""
    return zxy_to_tileid(zoom, *tile_coords(zoom, path))  # type: ignore[misc]


def render_tile(path: Path) -> bytes:
    """Decode one OZT2 tile and re-encode it as a Terrarium PNG."""
    elevation, _meta = decode_ozt2(path.read_bytes())
    if elevation.shape != (TILE_SIZE, TILE_SIZE):
        raise ValueError(f"{path}: expected {TILE_SIZE}x{TILE_SIZE}, got {elevation.shape}")
    return encode_tile(elevation.astype(np.float64), nodata=NODATA)


def render_tile_safe(path: Path) -> bytes | None:
    """Render one tile, reporting (not raising on) a corrupt source tile."""
    try:
        return render_tile(path)
    except Exception as err:  # noqa: BLE001 - one bad tile must not kill the build
        print(f"\n  skipping unreadable tile {path}: {type(err).__name__}: {err}")
        return None


def render_many(paths: list[Path], workers: int) -> list[bytes | None]:
    """Render a batch of tiles on a thread pool, preserving input order."""
    if workers <= 1:
        return [render_tile_safe(p) for p in paths]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(render_tile_safe, paths))


def mercator_bounds(zoom: int, tiles: list[tuple[int, int]]) -> tuple[float, float, float, float]:
    """(min_lon, min_lat, max_lon, max_lat) envelope of the given tiles."""
    n = 2**zoom
    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    min_lon = min(xs) / n * 360.0 - 180.0
    max_lon = (max(xs) + 1) / n * 360.0 - 180.0
    max_lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * min(ys) / n))))
    min_lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (max(ys) + 1) / n))))
    return float(min_lon), float(min_lat), float(max_lon), float(max_lat)


def build(zoom: int, indir: Path, out: Path, limit: int, workers: int) -> int:
    """Build the archive; returns 0 on success, 1 when nothing could be built."""
    zdir = indir / f"z{zoom}"
    candidates = [(p, tile_coords(zoom, p)) for p in zdir.glob("*/*.ozt2")]
    skipped = [(p, c) for p, c in candidates if c is None]
    paths = sorted((p for p, c in candidates if c is not None), key=lambda p: tile_id_of(zoom, p))
    for p, _ in skipped:
        print(f"  skipping out-of-bounds tile path: {p}")
    if not paths:
        print(f"No in-bounds OZT2 tiles under {zdir}")
        return 1
    if limit:
        paths = paths[:limit]

    coords = [tile_coords(zoom, p) for p in paths]
    bounds = mercator_bounds(zoom, [c for c in coords if c is not None])
    print(f"z{zoom}: {len(paths):,} tiles -> {out}")
    print(f"  bounds: ({bounds[0]:.4f}, {bounds[1]:.4f}, {bounds[2]:.4f}, {bounds[3]:.4f})")

    started = time.monotonic()
    out.parent.mkdir(parents=True, exist_ok=True)
    tile_bytes = 0
    written = 0
    with write(str(out)) as writer:
        # Chunked ordered rendering keeps peak memory bounded to one chunk
        # while preserving ascending tile-id order (the clustering guarantee).
        chunk = max(workers, 1) * 8
        for start in range(0, len(paths), chunk):
            batch = paths[start : start + chunk]
            for path, png in zip(batch, render_many(batch, workers), strict=True):
                if png is None:
                    continue
                writer.write_tile(tile_id_of(zoom, path), png)
                tile_bytes += len(png)
                written += 1
            done = min(start + chunk, len(paths))
            print(
                f"\r  {done:,}/{len(paths):,} tiles ({tile_bytes / 1e6:.1f} MB PNG)",
                end="",
                flush=True,
            )
        print()

        metadata = {
            "name": f"openzenith-elevation-z{zoom}",
            "description": (
                f"OpenZenith global elevation, Web Mercator zoom {zoom}, "
                "Terrarium-encoded PNG tiles built from the SRTM 30m OZT2 dataset."
            ),
            "version": "1",
            "type": "raster",
            "format": "png",
            "encoding": "terrarium",
            "attribution": ATTRIBUTION,
            "minzoom": zoom,
            "maxzoom": zoom,
            "bounds": list(bounds),
            "center": [
                round((bounds[0] + bounds[2]) / 2, 6),
                round((bounds[1] + bounds[3]) / 2, 6),
                zoom,
            ],
            "nodata": NODATA,
        }
        header = {
            "tile_type": TileType.PNG,
            # PNG carries its own deflate stream; no second compression layer.
            "tile_compression": Compression.NONE,
            "min_zoom": zoom,
            "max_zoom": zoom,
            "min_lon_e7": int(bounds[0] * 1e7),
            "min_lat_e7": int(bounds[1] * 1e7),
            "max_lon_e7": int(bounds[2] * 1e7),
            "max_lat_e7": int(bounds[3] * 1e7),
            "center_zoom": zoom,
            "center_lon_e7": round((bounds[0] + bounds[2]) / 2 * 1e7),
            "center_lat_e7": round((bounds[1] + bounds[3]) / 2 * 1e7),
        }
        writer.finalize(header, metadata)

    size = out.stat().st_size
    elapsed = time.monotonic() - started
    print(
        f"  wrote {out} in {elapsed:.1f}s: {size:,} bytes "
        f"({size / 1e6:.1f} MB, PNG payload {tile_bytes / 1e6:.1f} MB)"
    )
    print(
        f"  tiles written: {written:,} | skipped: {len(paths) - written:,}"
        f" | stray paths: {len(skipped)}"
    )
    print(f"  header: {header}")
    return 0 if written else 1


def main() -> int:
    """Parse arguments and build one archive."""
    parser = argparse.ArgumentParser(
        description="Build a PMTiles v3 archive of Terrarium PNG tiles from local OZT2"
    )
    parser.add_argument("--zoom", "-z", type=int, default=7, help="Zoom level (default: 7)")
    parser.add_argument(
        "--indir", type=Path, default=Path("data/ozt2_tiles"), help="OZT2 tile root directory"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output archive path (default: pmtiles/z{zoom}.pmtiles)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Build only the first N tiles in tile-id order (0 = all)",
    )
    parser.add_argument(
        "--workers", type=int, default=8, help="Parallel decode/encode threads (default: 8)"
    )
    args = parser.parse_args()

    out = args.out if args.out is not None else Path(f"pmtiles/z{args.zoom}.pmtiles")
    if not args.indir.exists():
        print(f"Error: {args.indir} does not exist")
        return 1
    return build(args.zoom, args.indir, out, args.limit, args.workers)


if __name__ == "__main__":
    sys.exit(main())
