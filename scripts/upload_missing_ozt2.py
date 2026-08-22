#!/usr/bin/env python3
"""
Targeted uploader for missing OZT2 x-dirs in aliasfox/srtm30m-ozt2-v2.

HF repo already has most x-dirs. This script finds and uploads ONLY the missing ones.
z11 has 807 missing x-dirs (of 2022) — this script targets those specifically.

Usage:
    python3 scripts/upload_missing_ozt2.py --zoom 11        # upload missing z11 x-dirs
    python3 scripts/upload_missing_ozt2.py --zoom 8,9       # upload missing z8, z9
    python3 scripts/upload_missing_ozt2.py --all            # all missing x-dirs
"""
import argparse
import os
import sys
import time
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from huggingface_hub import HfApi


def get_tile_count(xd: Path) -> int:
    return sum(1 for _ in xd.glob("*.ozt2"))


def upload_xdir(api, repo_id: str, xd: Path, z: int, xn: str, timeout: int = 120) -> bool:
    """Upload one x-dir. Returns True on success."""
    try:
        api.upload_large_folder(
            repo_id=repo_id,
            folder_path=str(xd),
            repo_type="dataset",
        )
        return True
    except Exception as e:
        err_str = str(e)
        if "no files have been modified" in err_str.lower() or "already" in err_str.lower():
            return True  # Already there
        # Retry once after backoff
        time.sleep(5)
        try:
            api.upload_large_folder(
                repo_id=repo_id,
                folder_path=str(xd),
                repo_type="dataset",
            )
            return True
        except Exception as e2:
            print(f"      RETRY FAIL: {e2}")
            return False


def check_hf_xdirs(api, repo_id: str, zoom: int) -> set:
    """Get set of x-dir names that exist in HF repo for given zoom."""
    hf_xdirs = set()
    try:
        files = list(api.list_repo_tree(
            repo_id=repo_id,
            path_in_repo=f"tiles/z{zoom}",
            recursive=False,
            repo_type="dataset",
        ))
        for f in files:
            name = f.path.split("/")[-1]
            hf_xdirs.add(name)
    except Exception as e:
        print(f"  Warning: could not list HF z{zoom}: {e}")
    return hf_xdirs


def main():
    parser = argparse.ArgumentParser(description="Upload missing OZT2 tiles to HF")
    parser.add_argument("--input", "-i", default="data/ozt2_tiles")
    parser.add_argument("--repo_id", "-r", default="aliasfox/srtm30m-ozt2-v2")
    parser.add_argument("--zoom", "-z", default=None,
                        help="Comma-separated zoom levels or 'all'")
    parser.add_argument("--all", action="store_true",
                        help="Upload all missing x-dirs across all zoom levels")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    api = HfApi(token=os.environ.get("HF_TOKEN"))
    tile_dir = Path(args.input)
    repo_id = args.repo_id

    # Determine zoom levels to process
    all_zooms = [7, 8, 9, 10, 11]
    if args.zoom:
        if args.zoom == "all":
            zooms = all_zooms
        else:
            zooms = [int(z) for z in args.zoom.split(",")]
    else:
        # Default: only z11 (the big remaining chunk)
        zooms = [11]

    total_ok = 0
    total_err = 0

    for zoom in zooms:
        local_xdirs = {}
        zdir = tile_dir / f"z{zoom}"
        if not zdir.exists():
            print(f"z{zoom}: directory not found")
            continue

        for xd in zdir.iterdir():
            if not xd.is_dir():
                continue
            count = get_tile_count(xd)
            if count == 0:
                continue
            local_xdirs[xd.name] = (xd, count)

        print(f"\n=== z{zoom}: {len(local_xdirs)} local x-dirs ===")

        # Get HF x-dirs
        hf_xdirs = check_hf_xdirs(api, repo_id, zoom)
        print(f"  HF already has: {len(hf_xdirs)} x-dirs")

        # Find missing
        missing = {xn: (xd, cnt) for xn, (xd, cnt) in local_xdirs.items() if xn not in hf_xdirs}
        print(f"  Missing: {len(missing)} x-dirs ({sum(c for _,c in missing.values())} tiles)")

        if not missing:
            print(f"  z{zoom}: complete!")
            continue

        # Sort by tile count (smallest first — faster uploads, less to re-upload on failure)
        sorted_missing = sorted(missing.items(), key=lambda x: x[1][1])

        # Load progress
        state_file = Path(f"/tmp/ozt2_missing_z{zoom}.json")
        done = set()
        if state_file.exists():
            done = set(json.loads(state_file.read_text()))
            print(f"  Resuming: {len(done)} already done")

        ok = 0
        err = 0
        for xn, (xd, count) in sorted_missing:
            key = xn
            if key in done:
                continue

            print(f"  Uploading z{zoom}/{xn} ({count} tiles)...", end=" ", flush=True)
            t0 = time.time()
            success = upload_xdir(api, repo_id, xd, zoom, xn, args.timeout)
            elapsed = time.time() - t0

            if success:
                ok += 1
                done.add(key)
                state_file.write_text(json.dumps(list(done)))
                print(f"OK in {elapsed:.1f}s")
            else:
                err += 1
                print(f"FAIL in {elapsed:.1f}s")

            total_ok += ok
            total_err += err

        print(f"  z{zoom}: {ok} ok, {err} err")

    print(f"\n{'='*60}")
    print(f"Total: {total_ok} ok, {total_err} err")


if __name__ == "__main__":
    main()
