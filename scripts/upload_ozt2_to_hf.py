#!/usr/bin/env python3
"""
Upload OZT2 tiles to HuggingFace.

Uploads local .ozt2 tiles to a HuggingFace dataset repository using
HfApi.create_commit with CommitOperationAdd for delta (missing-file-only)
uploads. Supports incremental/resumable uploads.

Usage:
    # Upload all tiles from local directory
    python scripts/upload_ozt2_to_hf.py \
        --input /path/to/ozt2_tiles \
        --repo_id aliasfox/srtm30m-ozt2-v2

    # Dry run (show what would be uploaded)
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --dry_run

    # Specific zoom levels only
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --zoom 10
"""

import argparse
import json
import os
import sys
import tempfile
import time as _time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


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


def hf_list_x_dirs(repo_id: str, z: int) -> dict[str, int]:
    """List x-dirs on HF for a zoom level via non-recursive tree listing.

    HF's API returns a maximum of 1000 entries regardless of pagination
    parameters. Stop as soon as we get a full page (1000 entries) since
    that means we've hit the cap — continuing would only return duplicates.
    """
    xd_counts: dict[str, int] = {}
    offset = 0
    limit = 500
    HF_MAX = 1000

    while True:
        url = (
            f"https://huggingface.co/api/datasets/{repo_id}/tree/main/tiles/z{z}"
            f"?paginationOffset={offset}&paginationLimit={limit}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "openzenith/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
        except Exception as e:
            print(f"    Warning: HF API error listing z{z} at offset {offset}: {e}")
            break

        if not isinstance(data, list):
            break

        for entry in data:
            if isinstance(entry, dict) and entry.get("type") == "directory":
                path = entry.get("path", "")
                parts = path.split("/")
                if len(parts) >= 3:
                    xd_name = parts[2]
                    xd_counts[xd_name] = -1

        if len(data) < limit or offset + len(data) >= HF_MAX:
            break
        offset += limit

    return xd_counts


def hf_get_x_dir_files(repo_id: str, z: int, xd_name: str) -> set[str]:
    """Get set of y-index filenames present in an x-dir on HF."""
    url = f"https://huggingface.co/api/datasets/{repo_id}/tree/main/tiles/z{z}/{xd_name}?recursive=true"
    req = urllib.request.Request(url, headers={"User-Agent": "openzenith/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except Exception:
        return set()

    files = set()
    if isinstance(data, list):
        for entry in data:
            if isinstance(entry, dict) and entry.get("type") == "file":
                fname = entry.get("path", "").split("/")[-1]
                if fname.endswith(".ozt2"):
                    files.add(fname)
    return files


def _upload_delta(api, repo_id: str, xd_path_in_repo: str, z: int, xd_name: str,
                  missing_tiles: list[Path]) -> bool:
    """Upload only missing tiles using create_commit in small batches."""
    if not missing_tiles:
        return True

    from huggingface_hub import CommitOperationAdd

    BATCH = 20
    for i in range(0, len(missing_tiles), BATCH):
        batch = missing_tiles[i:i + BATCH]
        operations = [
            CommitOperationAdd(path_in_repo=f"{xd_path_in_repo}/{t.name}", path_or_fileobj=str(t))
            for t in batch
        ]
        for attempt in range(4):
            try:
                api.create_commit(
                    repo_id=repo_id,
                    repo_type="dataset",
                    operations=operations,
                    commit_message=f"Upload z{z}/{xd_name} delta {i+1}-{i+len(batch)}",
                )
                print(f"  z{z}/{xd_name}: uploaded {len(batch)} tiles ({i+1}-{i+len(batch)})")
                break
            except Exception as e:
                err = str(e).lower()
                if "no files have been modified" in err or "already up to date" in err:
                    print(f"  z{z}/{xd_name}: HF already has these files")
                    return True
                if attempt < 3:
                    _time.sleep(2 ** attempt)
                else:
                    print(f"  ERROR z{z}/{xd_name} batch {i//BATCH+1}: {e}")
                    return False
    return True


def _valid_tile_name(name: str) -> bool:
    """Check if a filename is a valid numeric y-index tile name."""
    return name.endswith(".ozt2") and name.split(".")[0].lstrip("-").isdigit()


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
    """Upload OZT2 tiles to HuggingFace with delta detection."""
    try:
        from huggingface_hub import HfApi
    except ImportError:
        raise ImportError("huggingface_hub required. Install: pip install huggingface_hub")

    api = HfApi(token=token)

    local_counts = count_local_tiles(tile_dir, zoom_range)
    total_local = sum(local_counts.values())
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")
    print(f"Local tiles: {total_local:,} ({', '.join(f'z{z}:{c}' for z, c in sorted(local_counts.items()))})")

    if total_local == 0:
        print("No tiles found to upload.")
        return

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

    # Use web API to check repo existence (HfApi.repo_info hangs with some token configs)
    try:
        ctx = __import__("ssl").create_default_context()
        req = urllib.request.Request(
            f"https://huggingface.co/api/datasets/{repo_id}",
            headers={"User-Agent": "openzenith/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            _ = r.read()
        print("Repository already exists")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"Creating repository: {repo_id}")
            api.create_repo(repo_id, repo_type="dataset", exist_ok=True)
        else:
            raise
    except Exception:
        print(f"Creating repository (web check failed): {repo_id}")
        try:
            api.create_repo(repo_id, repo_type="dataset", exist_ok=True)
        except Exception as e2:
            if "already exists" not in str(e2).lower():
                raise

    uploaded_z = []
    for zdir in get_zoom_subdirs(tile_dir, zoom_range):
        z = int(zdir.name[1:])
        tile_count = sum(1 for _ in zdir.rglob("*.ozt2"))
        if tile_count == 0:
            continue

        z_path_in_repo = f"{path_in_repo}/{zdir.name}"

        if skip_existing:
            # Step 1: get HF x-dir list (non-recursive, fast)
            print(f"\nChecking HF state for z{z}...")
            hf_xd_counts = hf_list_x_dirs(repo_id, z)
            print(f"  HF has {len(hf_xd_counts)} x-dirs in paginated listing")

            # Step 2: categorize local x-dirs
            x_dirs = sorted([xd for xd in zdir.iterdir() if xd.is_dir()])
            need_check = []      # in HF paginated list
            need_full_upload = []  # confirmed not in HF

            for xd in x_dirs:
                local_tiles = sorted(xd.glob("*.ozt2"))
                if not local_tiles:
                    continue
                if xd.name not in hf_xd_counts:
                    need_full_upload.append((xd, local_tiles))
                else:
                    need_check.append((xd, local_tiles))

            # Step 3: verify completeness for x-dirs in paginated list
            z_ok = 0
            z_errors = 0
            print(f"  z{z}: verifying {len(need_check)} x-dirs, {len(need_full_upload)} need direct check")
            for xd, local_tiles in need_check:
                xd_path_in_repo = f"{path_in_repo}/z{z}/{xd.name}"
                hf_files = hf_get_x_dir_files(repo_id, z, xd.name)
                local_names = set(t.name for t in local_tiles if _valid_tile_name(t.name))
                missing_names = local_names - hf_files

                if not missing_names:
                    print(f"  z{z}/{xd.name}: fully synced ({len(local_names)} tiles)")
                    z_ok += len(local_names)
                    _time.sleep(0.3)
                    continue

                local_map = {t.name: t for t in local_tiles}
                missing_tiles = [local_map[n] for n in sorted(missing_names)]
                print(f"  z{z}/{xd.name}: {len(missing_names)} missing of {len(local_names)}")
                ok = _upload_delta(api, repo_id, xd_path_in_repo, z, xd.name, missing_tiles)
                if ok:
                    z_ok += len(missing_tiles)
                else:
                    z_errors += 1
                _time.sleep(0.5)

            # Step 4: x-dirs not in paginated list — check existence directly
            # HF caps tree listings at 1000 entries; x-dirs beyond that cap may not appear
            for xd, local_tiles in need_full_upload:
                hf_files = hf_get_x_dir_files(repo_id, z, xd.name)
                if hf_files:
                    # Exists on HF but wasn't in paginated listing
                    local_names = set(t.name for t in local_tiles if _valid_tile_name(t.name))
                    missing_names = local_names - hf_files
                    if not missing_names:
                        print(f"  z{z}/{xd.name}: fully synced (direct check, {len(local_names)} tiles)")
                        _time.sleep(0.3)
                        continue
                    local_map = {t.name: t for t in local_tiles}
                    missing_tiles = [local_map[n] for n in sorted(missing_names)]
                    print(f"  z{z}/{xd.name}: {len(missing_names)} missing — delta upload")
                    ok = _upload_delta(api, repo_id, f"{path_in_repo}/z{z}/{xd.name}", z, xd.name, missing_tiles)
                    _time.sleep(0.5)
                else:
                    # Truly new x-dir — full upload
                    print(f"  z{z}/{xd.name}: full upload ({len(local_tiles)} tiles)")
                    ok = _upload_delta(api, repo_id, f"{path_in_repo}/z{z}/{xd.name}", z, xd.name, local_tiles)
                    _time.sleep(0.5)

            if z_errors == 0:
                uploaded_z.append(z)
                print(f"  z{z}: done, {z_ok} tiles uploaded/verified")
            else:
                print(f"  z{z}: {z_ok} tiles OK, {z_errors} x-dirs had errors")
        else:
            # Full upload: batch x-dirs, use upload_folder
            import shutil
            x_dirs = sorted([xd for xd in zdir.iterdir() if xd.is_dir()])
            BATCH_SIZE = 5
            batches = [x_dirs[i:i + BATCH_SIZE] for i in range(0, len(x_dirs), BATCH_SIZE)]
            print(f"\nUploading z{z}/ in {len(batches)} batch(es) of ~{BATCH_SIZE} x-dirs ({tile_count:,} tiles)...")
            z_ok = 0
            z_errors = 0
            for bid, batch in enumerate(batches):
                t0 = _time.time()
                batch_dir = Path(tempfile.mkdtemp(prefix="ozt2_batch_"))
                for xd in batch:
                    dst = batch_dir / xd.name
                    shutil.copytree(xd, dst, copy_function=shutil.copy2)
                try:
                    api.upload_folder(
                        repo_id=repo_id,
                        folder_path=str(batch_dir),
                        path_in_repo=z_path_in_repo,
                        repo_type="dataset",
                        commit_message=f"Upload z{z} OZT2 tiles batch {bid + 1}/{len(batches)} ({len(batch)} x-dirs)",
                    )
                    batch_tiles = sum(1 for xd in batch for _ in xd.glob("*.ozt2"))
                    z_ok += batch_tiles
                    elapsed = _time.time() - t0
                    print(f"  batch {bid + 1}/{len(batches)}: {batch_tiles} tiles in {elapsed:.0f}s ({batch[0].name}–{batch[-1].name})")
                except Exception as e:
                    z_errors += len(batch)
                    print(f"  ERROR batch {bid + 1}/{len(batches)}: {e}")
                finally:
                    shutil.rmtree(batch_dir)
            if z_errors == 0:
                uploaded_z.append(z)
                print(f"  z{z}: all {z_ok:,} tiles uploaded OK ({len(x_dirs)} x-dirs in {len(batches)} batches)")
            else:
                print(f"  z{z}: {z_ok} tiles OK, {z_errors} x-dirs failed")

    print(f"\n{'=' * 60}")
    print(f"Upload complete!")
    print(f"Zoom levels uploaded: {uploaded_z}")
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")


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
