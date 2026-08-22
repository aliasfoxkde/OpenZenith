#!/usr/bin/env python3
"""
Parallel OZT2 uploader — 3 workers uploading x-dirs concurrently.
Each worker processes x-dirs sequentially, workers run in parallel.
Uses upload_large_folder which succeeds in 1-2 attempts at this network latency.
"""
import argparse
import os
import sys
import time
import json
import concurrent.futures
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from huggingface_hub import HfApi


def get_tile_count(xd: Path) -> int:
    return sum(1 for _ in xd.glob("*.ozt2"))


def worker_loop(worker_id: int, xdirs: list, repo_id: str, state_file: Path, lock):
    """Worker: process x-dirs sequentially, report results."""
    api = HfApi(token=os.environ.get("HF_TOKEN"))
    ok = 0
    err = 0

    for zoom, xn, count, xd_path in xdirs:
        key = f"{zoom}/{xn}"

        for attempt in range(4):
            t0 = time.time()
            try:
                api.upload_large_folder(
                    repo_id=repo_id,
                    folder_path=xd_path,
                    repo_type="dataset",
                )
                elapsed = time.time() - t0
                with lock:
                    done = set(json.loads(state_file.read_text()))
                    done.add(key)
                    state_file.write_text(json.dumps(list(done)))
                ok += 1
                print(f"[W{worker_id}] OK   z{zoom}/{xn}: {count} tiles in {elapsed:.0f}s ({ok} ok, {err} err)")
                break
            except Exception as e:
                err_str = str(e)
                if "no files have been modified" in err_str.lower():
                    with lock:
                        done = set(json.loads(state_file.read_text()))
                        done.add(key)
                        state_file.write_text(json.dumps(list(done)))
                    ok += 1
                    print(f"[W{worker_id}] SKIP z{zoom}/{xn}: already uploaded")
                    break
                elapsed = time.time() - t0
                if attempt < 3:
                    time.sleep(5)

        if ok + err % 10 == 0:
            time.sleep(1)

    return ok, err


def main():
    parser = argparse.ArgumentParser(description="Parallel OZT2 upload to HF")
    parser.add_argument("--input", "-i", default="data/ozt2_tiles")
    parser.add_argument("--repo_id", "-r", default="aliasfox/srtm30m-ozt2-v2")
    parser.add_argument("--workers", "-w", type=int, default=3)
    parser.add_argument("--zoom", "-z", default=None)
    parser.add_argument("--resume", action="store_true", default=True)
    args = parser.parse_args()

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
    print(f"Workers: {args.workers}")

    # Load done set
    state_file = Path("/tmp/ozt2_parallel_state.json")
    done = set()
    if args.resume and state_file.exists():
        done = set(json.loads(state_file.read_text()))
        print(f"Resuming: {len(done)} x-dirs already done")

    remaining = [x for x in all_xdirs if f"{x[0]}/{x[1]}" not in done]
    remaining_tiles = sum(c for _, _, c, _ in remaining)
    print(f"Remaining: {len(remaining)} x-dirs, {remaining_tiles} tiles")
    print()

    if not remaining:
        print("Nothing to upload!")
        return

    # Split remaining x-dirs across workers
    chunks = [[] for _ in range(args.workers)]
    for i, xd in enumerate(remaining):
        chunks[i % args.workers].append(xd)

    import threading
    lock = threading.Lock()

    print(f"Starting {args.workers} workers...")
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(worker_loop, i, chunks[i], repo_id, state_file, lock) for i in range(args.workers)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    elapsed = time.time() - t0
    total_ok = sum(r[0] for r in results)
    total_err = sum(r[1] for r in results)

    print()
    print(f"{'='*60}")
    print(f"Done in {elapsed:.0f}s ({elapsed/3600:.1f} hr)")
    print(f"OK: {total_ok} x-dirs, ERR: {total_err} x-dirs")


if __name__ == "__main__":
    main()
