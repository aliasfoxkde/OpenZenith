#!/usr/bin/env python3
"""
Incremental OZT2 tile uploader — single-file commits with retry + rate limiting.

Strategy: Use HfApi.upload_file (one file = one commit) since it reliably
succeeds in ~20s. Single-file commits respect the 128 commits/hr rate limit
but are the only reliable path given network timeouts on multi-file commits.

At 128 commits/hr, we upload 128 tiles/hr per worker.
z10 has 151,988 tiles → ~1,188 hours. Too slow for single-file.

Alternative: upload_large_folder with very small x-dirs (3-9 tiles) succeeds
in 2-5s with 1 commit. So we use upload_large_folder ONLY for x-dirs with
<= 20 tiles, and fall back to single-file for large x-dirs.

Rate limit: 128 commits/hr. We pace to 120/hr = 1 commit/30s to stay safe.
"""
import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import decode


def get_tile_count(xd: Path) -> int:
    """Count .ozt2 files in an x-dir."""
    return sum(1 for _ in xd.glob("*.ozt2"))


def upload_single_file(api, repo_id: str, tile_path: Path, path_in_repo: str) -> bool:
    """Upload one tile via single-file commit. Returns True on success."""
    try:
        content = tile_path.read_bytes()
        api.upload_file(
            path_or_fileobj=content,
            path_in_repo=path_in_repo,
            repo_id=repo_id,
            repo_type="dataset",
        )
        return True
    except Exception as e:
        if "no files have been modified" in str(e).lower():
            return True  # Already uploaded, count as success
        return False


def main():
    parser = argparse.ArgumentParser(description="Upload OZT2 tiles to HuggingFace (incremental)")
    parser.add_argument("--input", "-i", required=True, help="Local OZT2 tile directory")
    parser.add_argument("--repo_id", "-r", default="aliasfox/srtm30m-ozt2-v2")
    parser.add_argument("--zoom", "-z", default=None, help="Zoom range, e.g. '7-11'")
    parser.add_argument("--rate", type=int, default=120, help="Max commits/hour (default: 120)")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--dry_run", action="store_true")
    args = parser.parse_args()

    from huggingface_hub import HfApi
    api = HfApi(token=os.environ.get("HF_TOKEN"))

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

    # Collect all x-dirs with their tile counts
    all_xdirs = []
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        z = int(zdir.name[1:])
        if zoom_range and (z < zoom_range[0] or z > zoom_range[1]):
            continue
        for xd in sorted(zdir.iterdir()):
            if not xd.is_dir():
                continue
            count = get_tile_count(xd)
            if count == 0:
                continue
            all_xdirs.append((z, xd.name, count, xd))

    total_tiles = sum(c for _, _, c, _ in all_xdirs)
    print(f"Repository: aliasfox/srtm30m-ozt2-v2")
    print(f"Total x-dirs: {len(all_xdirs)}, total tiles: {total_tiles:,}")
    print(f"Zoom levels: {sorted(set(z for z, _, _, _ in all_xdirs))}")
    print(f"Rate limit: {args.rate} commits/hr (~{args.rate/60:.1f} per min)")
    print()

    if args.dry_run:
        for z, xn, c, _ in all_xdirs[:10]:
            print(f"  z{z}/{xn}: {c} tiles")
        print(f"  ... and {len(all_xdirs)-10} more x-dirs")
        return

    # Group x-dirs by size category
    small = [(z, xn, c, p) for z, xn, c, p in all_xdirs if c <= 20]
    large = [(z, xn, c, p) for z, xn, c, p in all_xdirs if c > 20]
    print(f"Small x-dirs (<=20 tiles): {len(small)} ({sum(c for _,_,c,_ in small):,} tiles)")
    print(f"Large x-dirs (>20 tiles): {len(large)} ({sum(c for _,_,c,_ in large):,} tiles)")
    print()

    commit_interval = 3600.0 / args.rate  # seconds between commits
    print(f"Pacing: 1 commit every {commit_interval:.1f}s")
    print()

    # Track progress
    state_file = Path("/tmp/ozt2_upload_state.json")
    done = set()
    if args.resume and state_file.exists():
        import json
        done = set(json.loads(state_file.read_text()))
        print(f"Resuming: {len(done)} x-dirs already done")

    ok_tiles = 0
    err_tiles = 0
    ok_dirs = 0
    err_dirs = 0
    last_commit = time.time() - commit_interval  # allow first commit immediately

    def save_state():
        if args.resume:
            import json
            state_file.write_text(json.dumps(list(done)))

    # Upload small x-dirs via upload_large_folder (1 commit each)
    print("=== Phase 1: Small x-dirs (<=20 tiles) via upload_large_folder ===")
    for z, xn, count, xd in small:
        key = f"z{z}/{xn}"
        if key in done:
            continue

        while time.time() - last_commit < commit_interval:
            time.sleep(0.5)

        t0 = time.time()
        try:
            api.upload_large_folder(
                repo_id=args.repo_id,
                folder_path=str(xd),
                repo_type="dataset",
            )
            elapsed = time.time() - t0
            ok_tiles += count
            ok_dirs += 1
            done.add(key)
            last_commit = time.time()
            print(f"  OK   z{z}/{xn}: {count} tiles in {elapsed:.1f}s")
            save_state()
        except Exception as e:
            err_str = str(e)
            if "no files have been modified" in err_str.lower() or "already" in err_str.lower():
                ok_tiles += count
                ok_dirs += 1
                done.add(key)
                print(f"  SKIP z{z}/{xn}: already uploaded")
                save_state()
                continue
            err_tiles += count
            err_dirs += 1
            elapsed = time.time() - t0
            print(f"  ERR  z{z}/{xn}: {count} tiles in {elapsed:.1f}s — {e}")
            # Retry once after backoff
            time.sleep(5)
            try:
                t0 = time.time()
                api.upload_large_folder(
                    repo_id=args.repo_id,
                    folder_path=str(xd),
                    repo_type="dataset",
                )
                err_tiles -= count
                err_dirs -= 1
                ok_tiles += count
                ok_dirs += 1
                done.add(key)
                elapsed = time.time() - t0
                print(f"  RETRY OK z{z}/{xn}: {count} tiles in {elapsed:.1f}s")
                save_state()
            except Exception as e2:
                print(f"  RETRY FAIL z{z}/{xn}: {e2}")

    # Upload large x-dirs via single-file commits
    print()
    print("=== Phase 2: Large x-dirs (>20 tiles) via single-file commits ===")
    for z, xn, count, xd in large:
        key = f"z{z}/{xn}"
        if key in done:
            continue

        tiles = sorted(xd.glob("*.ozt2"))
        local_ok = 0
        local_err = 0
        for tile in tiles:
            path_in_repo = f"tiles/z{z}/{xn}/{tile.name}"

            # Wait for rate limit
            while time.time() - last_commit < commit_interval:
                time.sleep(0.5)

            t0 = time.time()
            if upload_single_file(api, args.repo_id, tile, path_in_repo):
                local_ok += 1
                last_commit = time.time()
            else:
                local_err += 1
                # Retry once
                time.sleep(3)
                if upload_single_file(api, args.repo_id, tile, path_in_repo):
                    local_ok += 1
                    local_err -= 1
                    last_commit = time.time()

            if (local_ok + local_err) % 50 == 0:
                elapsed = time.time() - t0
                print(f"  PROG z{z}/{xn}: {local_ok+local_err}/{count} tiles...")

        if local_err == 0:
            ok_tiles += local_ok
            ok_dirs += 1
            done.add(key)
            print(f"  OK   z{z}/{xn}: {local_ok} tiles")
            save_state()
        else:
            err_tiles += local_err
            err_dirs += 1
            print(f"  ERR  z{z}/{xn}: {local_ok} ok, {local_err} err")

    print()
    print(f"{'='*60}")
    print(f"Upload complete!")
    print(f"OK: {ok_tiles:,} tiles in {ok_dirs} x-dirs")
    if err_tiles:
        print(f"ERR: {err_tiles:,} tiles in {err_dirs} x-dirs")
    print(f"Repository: https://huggingface.co/datasets/{args.repo_id}")


if __name__ == "__main__":
    main()
