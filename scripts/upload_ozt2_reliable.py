#!/usr/bin/env python3
"""
Reliable OZT2 uploader using upload_large_folder with unlimited retries.
Each x-dir is retried until it succeeds (or process is killed).
Progress is persisted to disk so it can resume after interruption.
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


def main():
    parser = argparse.ArgumentParser(description="Reliable OZT2 upload to HF")
    parser.add_argument("--input", "-i", default="data/ozt2_tiles")
    parser.add_argument("--repo_id", "-r", default="aliasfox/srtm30m-ozt2-v2")
    parser.add_argument("--zoom", "-z", default=None)
    parser.add_argument("--resume", action="store_true", default=True)
    args = parser.parse_args()

    api = HfApi(token=os.environ.get("HF_TOKEN"))
    tile_dir = Path(args.input)
    repo_id = args.repo_id

    # Determine zoom levels
    all_zooms = [7, 8, 9, 10, 11]
    if args.zoom:
        zooms = [int(z) for z in args.zoom.split(",")]
    else:
        zooms = all_zooms

    # Load all x-dirs
    all_xdirs = []
    for zoom in zooms:
        zdir = tile_dir / f"z{zoom}"
        if not zdir.exists():
            continue
        for xd in sorted(zdir.iterdir()):
            if not xd.is_dir():
                continue
            count = get_tile_count(xd)
            if count == 0:
                continue
            all_xdirs.append((zoom, xd.name, count, str(xd)))

    total_tiles = sum(c for _, _, c, _ in all_xdirs)
    print(f"Total: {len(all_xdirs)} x-dirs, {total_tiles} tiles")
    print(f"Zoom levels: {sorted(set(z for z, _, _, _ in all_xdirs))}")

    # Load done set
    state_file = Path("/tmp/ozt2_reliable_state.json")
    done = set()
    if args.resume and state_file.exists():
        done = set(json.loads(state_file.read_text()))
        print(f"Resuming: {len(done)} x-dirs already done")

    # Count remaining
    remaining = [x for x in all_xdirs if f"{x[0]}/{x[1]}" not in done]
    remaining_tiles = sum(c for _, _, c, _ in remaining)
    print(f"Remaining: {len(remaining)} x-dirs, {remaining_tiles} tiles")
    print()

    total_ok = 0
    total_err = 0
    total_attempts = 0

    for zoom, xn, count, xd_path in remaining:
        key = f"{zoom}/{xn}"
        total_attempts += 1

        while True:  # retry loop until success
            t0 = time.time()
            try:
                api.upload_large_folder(
                    repo_id=repo_id,
                    folder_path=xd_path,
                    repo_type="dataset",
                )
                elapsed = time.time() - t0
                done.add(key)
                state_file.write_text(json.dumps(list(done)))
                total_ok += 1
                print(f"OK   z{zoom}/{xn}: {count} tiles in {elapsed:.1f}s ({total_ok} ok, {total_err} err)")
                break  # success, move to next x-dir
            except Exception as e:
                err_str = str(e)
                if "no files have been modified" in err_str.lower():
                    # Already there - count as success
                    done.add(key)
                    state_file.write_text(json.dumps(list(done)))
                    total_ok += 1
                    print(f"SKIP z{zoom}/{xn}: already uploaded")
                    break
                elapsed = time.time() - t0
                total_err += 1
                print(f"RETRY z{zoom}/{xn}: {count} tiles in {elapsed:.1f}s — {e}")
                time.sleep(5)  # backoff before retry

        # Brief pause between x-dirs to avoid overwhelming the network
        if total_attempts % 10 == 0:
            time.sleep(2)

    print()
    print(f"{'='*60}")
    print(f"Done: {total_ok} ok, {total_err} err (of {total_attempts} attempts)")


if __name__ == "__main__":
    main()
