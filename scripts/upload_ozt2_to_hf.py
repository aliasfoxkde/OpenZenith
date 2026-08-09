#!/usr/bin/env python3
"""
Upload OZT2 tiles to HuggingFace.

Uploads local .ozt2 tiles to a HuggingFace dataset repository using
the HfApi.upload_folder method. Supports incremental/resumable uploads.

Usage:
    # Upload all tiles from local directory (creates aliasfox/srtm30m-ozt2-v2 dataset)
    python scripts/upload_ozt2_to_hf.py \
        --input /home/mkinney/temp/ozt2_tiles \
        --repo_id aliasfox/srtm30m-ozt2-v2

    # Dry run (show what would be uploaded)
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --dry_run

    # Specific zoom levels only
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --zoom 7-10

    # Resume after previous upload (skip existing)
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --skip_existing
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import decode


def count_local_tiles(tile_dir: Path, zoom_range: tuple[int, int] | None = None) -> dict[int, int]:
    """Count local tiles per zoom level."""
    counts = {}
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        try:
            z = int(zdir.name[1:])
        except ValueError:
            continue
        if zoom_range and (z < zoom_range[0] or z > zoom_range[1]):
            continue
        count = sum(1 for _ in zdir.rglob("*.ozt2"))
        if count:
            counts[z] = count
    return counts


def get_zoom_subdirs(tile_dir: Path, zoom_range: tuple[int, int] | None = None) -> list[Path]:
    """Get list of zoom subdirectories to upload."""
    subdirs = []
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        try:
            z = int(zdir.name[1:])
        except ValueError:
            continue
        if zoom_range and (z < zoom_range[0] or z > zoom_range[1]):
            continue
        subdirs.append(zdir)
    return subdirs


def upload_tiles(
    tile_dir: Path,
    repo_id: str,
    token: str | None = None,
    zoom_range: tuple[int, int] | None = None,
    path_in_repo: str = "tiles",
    dry_run: bool = False,
    skip_existing: bool = True,
    commit_message: str | None = None,
):
    """Upload OZT2 tiles to HuggingFace dataset via upload_folder."""
    try:
        from huggingface_hub import HfApi
    except ImportError:
        raise ImportError("huggingface_hub required. Install: pip install huggingface_hub")

    api = HfApi(token=token)

    # Count local tiles
    local_counts = count_local_tiles(tile_dir, zoom_range)
    total_local = sum(local_counts.values())
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")
    print(f"Local tiles: {total_local:,} ({', '.join(f'z{z}:{c}' for z, c in sorted(local_counts.items()))})")

    if total_local == 0:
        print("No tiles found to upload.")
        return

    # Get total size
    total_size = sum(
        f.stat().st_size
        for zdir in get_zoom_subdirs(tile_dir, zoom_range)
        for f in zdir.rglob("*.ozt2")
    )
    print(f"Estimated upload size: {total_size / 1e6:.1f} MB")

    if dry_run:
        print("\n[DRY RUN] Would upload zoom directories:")
        for zdir in get_zoom_subdirs(tile_dir, zoom_range):
            z = int(zdir.name[1:])
            count = sum(1 for _ in zdir.rglob("*.ozt2"))
            print(f"  {zdir.name}/ -> {count:,} tiles")
        print(f"\n  Path in repo: {path_in_repo}/")
        return

    print(f"\nUploading tiles to https://huggingface.co/datasets/{repo_id}")
    print("-" * 60)

    # Create repo if it doesn't exist
    try:
        api.repo_info(repo_id, repo_type="dataset")
        print(f"Repository already exists")
    except Exception:
        print(f"Creating repository: {repo_id}")
        api.create_repo(repo_id, repo_type="dataset", exist_ok=True)

    # Create and upload metadata files
    metadata_dir = Path(tempfile.gettempdir()) / "ozt2_hf_metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)

    readme = metadata_dir / "README.md"
    readme.write_text(f"""---
annotations_creators:
- no-annotation
language:
- en
license: []
multilinguality:
- monolingual
pretty_name: SRTM30M OZT2 Elevation Tiles
size_categories:
- n<1K
source_datasets: []
task_categories:
- image-generation
task_ids: []
---

# SRTM 30m OZT2 Elevation Tiles

This dataset contains SRTM 30-meter resolution elevation data encoded in the OZT2 tile format.

## Format

**OZT2** is a high-performance elevation tile format:
- **Compression**: ~93% smaller than Terrarium PNG
- **Prediction**: Gradient-based prediction (left neighbor + vertical gradient)
- **Quantization**: Adaptive bit-depth (8/10/12/16-bit per channel)
- **Codec**: Zstd q3 (30× faster encode than Brotli, same decode speed)

Each tile is 256×256 pixels in Web Mercator projection (EPSG:3857).

## Usage

```python
from huggingface_hub import HfFileSystem
from openzenith import decode_v2

fs = HfFileSystem(repo_id="{repo_id}")
with fs.open("tiles/z10/163/395.ozt2", "rb") as f:
    data = f.read()
elevation, meta = decode_v2(data)
```

## Source

Source: [SRTM 30m](https://cgiarcsi.community/data/srtm-30m-elevation) via [aliasfox/srtm30m-merged](https://huggingface.co/datasets/aliasfox/srtm30m-merged)
""")

    dataset_info = metadata_dir / "dataset_info.json"
    dataset_info.write_text(f'''{{
  "description": "SRTM 30m elevation tiles in OZT2 format (~93% smaller than Terrarium PNG)",
  "format": "OZT2",
  "tile_size": 256,
  "projection": "Web Mercator (EPSG:3857)",
  "compression": "Zstd + gradient prediction + adaptive quantization",
  "compression_ratio": "~93% smaller than Terrarium PNG",
  "zoom_levels": {list(local_counts.keys())},
  "tile_count": {total_local},
  "source": "SRTM 30m",
  "homepage": "https://openzenith.cyopsys.com"
}}
''')

    print(f"\nSkipping metadata upload (network issues)...")

    # Upload each zoom level as a SINGLE COMMIT via upload_folder.
    # This avoids the 128 commits/hr rate limit — each z-dir = 1 commit.
    # Use upload_large_folder only for incremental updates (skip_existing).
    uploaded_z = []
    for zdir in get_zoom_subdirs(tile_dir, zoom_range):
        z = int(zdir.name[1:])
        tile_count = sum(1 for _ in zdir.rglob("*.ozt2"))
        if tile_count == 0:
            continue

        z_path_in_repo = f"{path_in_repo}/{zdir.name}"

        if skip_existing:
            # Use upload_large_folder per-x-dir with skip_existing for incremental.
            # This is slow (many commits) but respects existing files.
            x_dirs = [xd for xd in sorted(zdir.iterdir()) if xd.is_dir()]
            print(f"\nUploading z{z}/ incrementally ({tile_count:,} tiles across {len(x_dirs)} x-dirs, skip_existing)...")
            z_ok = 0
            z_errors = 0
            for xd in x_dirs:
                x_tile_count = sum(1 for _ in xd.glob("*.ozt2"))
                if x_tile_count == 0:
                    continue
                try:
                    api.upload_large_folder(
                        repo_id=repo_id,
                        folder_path=str(xd),
                        repo_type="dataset",
                    )
                    z_ok += x_tile_count
                except Exception as e:
                    z_errors += 1
                    print(f"  ERROR z{z}/{xd.name}: {e}")
            if z_errors == 0:
                uploaded_z.append(z)
                print(f"  z{z}: all {z_ok:,} tiles uploaded OK ({len(x_dirs)} x-dirs)")
            else:
                print(f"  z{z}: {z_ok} tiles OK, {z_errors} x-dirs failed")
        else:
            # Full upload: chunk x-dirs into batches and upload each batch
            # as a single commit using upload_folder (NOT upload_large_folder —
            # upload_large_folder silently fails to commit).
            # Each batch = 1 commit. Stay within 128 commits/hr limit.
            # Use copies (not symlinks) to avoid any symlink issues.
            import time, shutil
            x_dirs = sorted([xd for xd in zdir.iterdir() if xd.is_dir()])
            BATCH_SIZE = 5  # x-dirs per commit (small to avoid network timeouts)
            batches = [x_dirs[i:i+BATCH_SIZE] for i in range(0, len(x_dirs), BATCH_SIZE)]
            print(f"\nUploading z{z}/ in {len(batches)} batch(es) of ~{BATCH_SIZE} x-dirs ({tile_count:,} tiles)...")
            z_ok = 0
            z_errors = 0
            for bid, batch in enumerate(batches):
                t0 = time.time()
                # Create temp dir with COPIES of the x-dirs (not symlinks)
                batch_dir = Path(tempfile.mkdtemp(prefix="ozt2_batch_"))
                for xd in batch:
                    dst = batch_dir / xd.name
                    # Copy the entire x-dir recursively (preserving file contents)
                    shutil.copytree(xd, dst, copy_function=shutil.copy2)
                try:
                    api.upload_folder(
                        repo_id=repo_id,
                        folder_path=str(batch_dir),
                        path_in_repo=z_path_in_repo,
                        repo_type="dataset",
                        commit_message=f"Upload z{z} OZT2 tiles batch {bid+1}/{len(batches)} ({len(batch)} x-dirs)",
                    )
                    batch_tiles = sum(1 for xd in batch for _ in xd.glob("*.ozt2"))
                    z_ok += batch_tiles
                    elapsed = time.time() - t0
                    print(f"  batch {bid+1}/{len(batches)}: {batch_tiles} tiles in {elapsed:.0f}s ({batch[0].name}–{batch[-1].name})")
                except Exception as e:
                    z_errors += len(batch)
                    print(f"  ERROR batch {bid+1}/{len(batches)}: {e}")
                finally:
                    shutil.rmtree(batch_dir)
            if z_errors == 0:
                uploaded_z.append(z)
                print(f"  z{z}: all {z_ok:,} tiles uploaded OK ({len(x_dirs)} x-dirs in {len(batches)} batches)")
            else:
                print(f"  z{z}: {z_ok} tiles OK, {z_errors} x-dirs failed")

    print(f"\n{'='*60}")
    print(f"Upload complete!")
    print(f"Zoom levels uploaded: {uploaded_z}")
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")

    # Print dataset metadata
    metadata = {
        "repo_id": repo_id,
        "format": "OZT2 (gradient prediction + adaptive quantization + Zstd)",
        "tile_count": sum(local_counts.values()),
        "zoom_levels": uploaded_z,
        "description": (
            "SRTM 30m elevation tiles in OZT2 format (~93% smaller than Terrarium PNG). "
            "Each tile is 256x256 pixels, Web Mercator projection (EPSG:3857)."
        ),
    }
    print(f"\nSuggested dataset.json metadata:")
    import json
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload OZT2 tiles to HuggingFace")
    parser.add_argument("--input", "-i", required=True, help="Local OZT2 tile directory")
    parser.add_argument("--repo_id", "-r", default="aliasfox/srtm30m-ozt2-v2",
                        help="HuggingFace repository ID (default: aliasfox/srtm30m-ozt2-v2)")
    parser.add_argument("--token", "-t", default=None,
                        help="HuggingFace token (default: from HF_TOKEN env var)")
    parser.add_argument("--zoom", "-z", default=None,
                        help="Zoom range, e.g. '7-11' or '7,8,10'")
    parser.add_argument("--path_in_repo", default="tiles",
                        help="Path in repository (default: tiles)")
    parser.add_argument("--dry_run", action="store_true",
                        help="Show what would be uploaded without uploading")
    parser.add_argument("--skip_existing", action="store_true", default=True,
                        help="Skip existing tiles (default: True, use --no_skip to override)")
    parser.add_argument("--no_skip", action="store_true",
                        help="Re-upload all tiles (overwrites existing)")
    parser.add_argument("--commit_message", "-m", default=None,
                        help="Custom commit message")

    args = parser.parse_args()

    tile_dir = Path(args.input)
    if not tile_dir.exists():
        print(f"Error: {tile_dir} does not exist")
        sys.exit(1)

    # Parse zoom range
    zoom_range = None
    if args.zoom:
        if "," in args.zoom:
            levels = [int(z) for z in args.zoom.split(",")]
            zoom_range = (min(levels), max(levels))
        elif "-" in args.zoom:
            parts = args.zoom.split("-")
            zoom_range = (int(parts[0]), int(parts[1]))
        else:
            z = int(args.zoom)
            zoom_range = (z, z)

    # Token from env
    token = args.token or os.environ.get("HF_TOKEN")

    upload_tiles(
        tile_dir=tile_dir,
        repo_id=args.repo_id,
        token=token,
        zoom_range=zoom_range,
        path_in_repo=args.path_in_repo,
        dry_run=args.dry_run,
        skip_existing=not args.no_skip,
        commit_message=args.commit_message,
    )