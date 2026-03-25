#!/usr/bin/env python3
"""
Upload pre-extracted SRTM chunks to HuggingFace dataset.

Reads .deflate files from the extraction output directory and uploads
them to aliasfox/srtm30m-chunks on HuggingFace.

Supports resume: skips files already uploaded based on local log.
Uses concurrent uploads for throughput.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_url

REPO_ID = "aliasfox/srtm30m-chunks"
LOG_FILE = "upload_progress.json"


def load_progress():
    """Load upload progress from log file."""
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            return json.load(f)
    return {"uploaded": [], "failed": [], "total_bytes": 0}


def save_progress(progress):
    """Save upload progress to log file."""
    with open(LOG_FILE, "w") as f:
        json.dump(progress, f, indent=2)


async def upload_file(api: HfApi, local_path: str, repo_path: str, progress: dict):
    """Upload a single file to HuggingFace."""
    try:
        api.upload_file(
            path_or_fileobj=local_path,
            path_in_repo=repo_path,
            repo_id=REPO_ID,
            repo_type="dataset",
        )
        file_size = os.path.getsize(local_path)
        progress["uploaded"].append(repo_path)
        progress["total_bytes"] += file_size
        return True, file_size
    except Exception as e:
        progress["failed"].append({"path": repo_path, "error": str(e)})
        return False, 0


async def upload_chunks(source_dir: str, max_concurrent: int = 10):
    """Upload all chunks from source directory to HuggingFace."""
    api = HfApi()
    progress = load_progress()
    uploaded_set = set(progress["uploaded"])

    # Collect all .deflate files
    all_files = []
    for root, _, files in os.walk(source_dir):
        for f in files:
            if f.endswith(".deflate"):
                full_path = os.path.join(root, f)
                repo_path = os.path.relpath(full_path, source_dir)
                all_files.append((full_path, repo_path))

    # Filter out already uploaded
    pending = [(p, r) for p, r in all_files if r not in uploaded_set]

    print(f"Total chunks: {len(all_files)}")
    print(f"Already uploaded: {len(uploaded_set)}")
    print(f"Pending: {len(pending)}")
    print(f"Failed (previous): {len(progress['failed'])}")
    print(f"Total bytes uploaded: {progress['total_bytes'] / 1e9:.2f} GB")
    print("=" * 80)

    if not pending:
        print("Nothing to upload!")
        return

    semaphore = asyncio.Semaphore(max_concurrent)
    completed = 0
    errors = 0
    total_bytes = progress["total_bytes"]
    start = time.time()

    async def upload_with_semaphore(local_path: str, repo_path: str):
        nonlocal completed, errors, total_bytes
        async with semaphore:
            ok, size = await upload_file(api, local_path, repo_path, progress)
            completed += 1
            if ok:
                total_bytes += size
            else:
                errors += 1

            if completed % 100 == 0:
                elapsed = time.time() - start
                rate = total_bytes / elapsed / 1e6 if elapsed > 0 else 0
                pct = completed / len(pending) * 100
                eta = (len(pending) - completed) * (elapsed / completed) if completed > 0 else 0
                print(
                    f"  [{pct:5.1f}%] {completed}/{len(pending)} "
                    f"({total_bytes/1e9:.2f} GB) "
                    f"{rate:.1f}MB/s ETA:{eta:.0f}s "
                    f"errors:{errors}"
                )
                # Save progress periodically
                save_progress(progress)

            return ok

    # Process in batches
    batch_size = 500
    for i in range(0, len(pending), batch_size):
        batch = pending[i : i + batch_size]
        tasks = [upload_with_semaphore(p, r) for p, r in batch]
        await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.time() - start
    save_progress(progress)

    print("=" * 80)
    print(f"Done! Uploaded {completed} chunks in {elapsed:.0f}s")
    print(f"Total: {total_bytes / 1e9:.2f} GB")
    print(f"Errors: {errors}")
    if progress["failed"]:
        print(f"Total failed: {len(progress['failed'])}")


if __name__ == "__main__":
    source_dir = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"
    max_concurrent = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    asyncio.run(upload_chunks(source_dir, max_concurrent))
