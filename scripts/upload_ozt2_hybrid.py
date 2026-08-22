#!/usr/bin/env python3
"""
Hybrid OZT2 uploader — fast path for small x-dirs, reliable fallback for large.
Small x-dirs (<=50 tiles): upload_large_folder (1 commit, ~5s each)
Large x-dirs (>50 tiles): upload_file per tile (1 commit each, ~0.5s each)

Total: ~3 hours for all z11 missing tiles at 0.5s/file.
State persisted to /tmp/ozt2_hybrid_done.json
"""
import argparse
import os
import sys
import time
import json
import subprocess
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

STATE_FILE = Path("/tmp/ozt2_hybrid_done.json")
HF_TOKEN = os.environ.get("HF_TOKEN")
REPO_ID = "aliasfox/srtm30m-ozt2-v2"


def get_done():
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_done(key):
    done = get_done()
    done.add(key)
    STATE_FILE.write_text(json.dumps(sorted(list(done))))


def upload_large(key, xd_path, zoom, xn, count):
    """upload_large_folder with retry."""
    for attempt in range(4):
        t0 = time.time()
        try:
            subprocess.run(
                ["python3", "-c", f"""
import os
from huggingface_hub import HfApi
api = HfApi(token=os.environ['HF_TOKEN'])
api.upload_large_folder(repo_id='{REPO_ID}', folder_path='{xd_path}', repo_type='dataset')
"""],
                env={**os.environ, "HF_TOKEN": HF_TOKEN},
                capture_output=True, text=True, timeout=600
            )
            elapsed = time.time() - t0
            save_done(key)
            return (True, count, elapsed)
        except Exception as e:
            elapsed = time.time() - t0
            err = str(e)
            if "no files have been modified" in err.lower() or "already" in err.lower():
                save_done(key)
                return (True, count, elapsed)
            if attempt < 3:
                time.sleep(5)
    return (False, count, 0)


def upload_single(key, xd_path, zoom, xn, count):
    """upload_file per tile with retry."""
    tiles = list(Path(xd_path).glob("*.ozt2"))
    ok = 0
    err = 0
    t0 = time.time()
    for tile in tiles:
        path_in_repo = f"tiles/z{zoom}/{xn}/{tile.name}"
        content = tile.read_bytes()
        for attempt in range(3):
            try:
                subprocess.run(
                    ["python3", "-c", f"""
import os
from huggingface_hub import HfApi
api = HfApi(token=os.environ['HF_TOKEN'])
api.upload_file(path_or_fileobj={content!r}, path_in_repo='{path_in_repo}', repo_id='{REPO_ID}', repo_type='dataset')
"""],
                    env={**os.environ, "HF_TOKEN": HF_TOKEN},
                    capture_output=True, text=True, timeout=30
                )
                ok += 1
                break
            except Exception as e:
                if "no files have been modified" in str(e).lower():
                    ok += 1
                    break
                if attempt < 2:
                    time.sleep(2)
                else:
                    err += 1
    elapsed = time.time() - t0
    save_done(key)
    return (err == 0, ok, elapsed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--resume", action="store_true", default=True)
    args = parser.parse_args()

    tile_dir = Path("data/ozt2_tiles")

    # Collect all x-dirs
    all_xdirs = []
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        z = int(zdir.name[1:])
        for xd in sorted(zdir.iterdir()):
            if not xd.is_dir():
                continue
            count = sum(1 for _ in xd.glob("*.ozt2"))
            if count == 0:
                continue
            key = f"z{z}/{xd.name}"
            all_xdirs.append((key, z, xd.name, count, str(xd)))

    done = get_done()
    remaining = [x for x in all_xdirs if x[0] not in done]

    total_tiles = sum(c for _, _, _, c, _ in remaining)
    print(f"Total: {len(all_xdirs)} x-dirs")
    print(f"Done: {len(done)}")
    print(f"Remaining: {len(remaining)} x-dirs, {total_tiles} tiles")
    print()

    if not remaining:
        print("All done!")
        return

    # Sort: smallest first (fast to upload, builds confidence)
    remaining.sort(key=lambda x: x[3])

    small = [(k, z, xn, c, xp) for k, z, xn, c, xp in remaining if c <= 50]
    large = [(k, z, xn, c, xp) for k, z, xn, c, xp in remaining if c > 50]

    print(f"Small (<=50 tiles): {len(small)} x-dirs, {sum(c for _,_,_,c,_ in small)} tiles")
    print(f"Large (>50 tiles): {len(large)} x-dirs, {sum(c for _,_,_,c,_ in large)} tiles")
    print()

    total_ok = 0
    total_err = 0
    t0 = time.time()

    # Process small x-dirs with upload_large_folder
    print(f"=== Phase 1: Small x-dirs ({len(small)}) ===")
    for key, zoom, xn, count, xd_path in small:
        print(f"  {key}: {count} tiles...", end=" ", flush=True)
        success, uploaded, elapsed = upload_large(key, xd_path, zoom, xn, count)
        if success:
            total_ok += 1
            print(f"OK in {elapsed:.0f}s")
        else:
            total_err += 1
            print(f"FAIL — falling back to single-file")
            success2, uploaded2, elapsed2 = upload_single(key, xd_path, zoom, xn, count)
            if success2:
                total_ok += 1
                print(f"  Single-file: OK {uploaded2} tiles in {elapsed2:.0f}s")
            else:
                total_err += 1
                print(f"  Single-file: FAIL {uploaded2} ok, {uploaded2-uploaded2} err")

    # Process large x-dirs with upload_file
    print()
    print(f"=== Phase 2: Large x-dirs ({len(large)}) ===")
    for key, zoom, xn, count, xd_path in large:
        print(f"  {key}: {count} tiles...", end=" ", flush=True)
        success, uploaded, elapsed = upload_single(key, xd_path, zoom, xn, count)
        if success:
            total_ok += 1
            print(f"OK {uploaded} tiles in {elapsed:.0f}s ({elapsed/uploaded*60:.0f}s/tile)")
        else:
            total_err += 1
            print(f"FAIL {uploaded}/{count} tiles in {elapsed:.0f}s")

    elapsed_total = time.time() - t0
    print()
    print(f"{'='*60}")
    print(f"Done in {elapsed_total/3600:.1f} hr")
    print(f"OK: {total_ok} x-dirs, ERR: {total_err}")


if __name__ == "__main__":
    main()
