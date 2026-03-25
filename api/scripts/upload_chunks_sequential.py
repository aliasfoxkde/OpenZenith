#!/usr/bin/env python3
"""
Upload SRTM chunks to HuggingFace, one lat directory at a time.
Uses upload_large_folder for each directory individually.

Usage: python scripts/upload_chunks_sequential.py [base_dir]
"""

import os
import sys
import time

os.environ["HF_TOKEN"] = os.environ.get("HF_TOKEN", "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")

from huggingface_hub import HfApi  # noqa: E402

REPO_ID = "aliasfox/srtm30m-chunks"
BASE_DIR = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"


def get_uploaded_dirs(api: HfApi) -> set:
    """Get set of lat directories that are fully uploaded."""
    try:
        info = api.repo_info(REPO_ID, repo_type="dataset")
        return {s.rfilename.split("/")[0] for s in info.siblings if s.rfilename.endswith(".deflate")}
    except Exception:
        return set()


def main():
    api = HfApi()

    lat_dirs = sorted([
        d for d in os.listdir(BASE_DIR)
        if os.path.isdir(os.path.join(BASE_DIR, d)) and d[0] in ("N", "S")
    ])

    # Count files per directory
    dir_counts = {}
    for d in lat_dirs:
        path = os.path.join(BASE_DIR, d)
        count = len([f for f in os.listdir(path) if f.endswith(".deflate")])
        dir_counts[d] = count

    uploaded_dirs = get_uploaded_dirs(api)
    total_files = sum(dir_counts.values())

    # Count uploaded files
    try:
        info = api.repo_info(REPO_ID, repo_type="dataset")
        uploaded_files = sum(1 for s in info.siblings if s.rfilename.endswith(".deflate"))
    except Exception:
        uploaded_files = 0

    print(f"Already uploaded: {uploaded_files} files in {len(uploaded_dirs)} dirs", flush=True)
    print(f"Total: {total_files} files in {len(lat_dirs)} dirs", flush=True)
    print("=" * 80, flush=True)

    start = time.time()
    total_uploaded = 0
    total_skipped = 0
    total_errors = 0

    for i, lat_name in enumerate(lat_dirs):
        lat_path = os.path.join(BASE_DIR, lat_name)
        file_count = dir_counts[lat_name]
        t0 = time.time()

        if file_count == 0:
            print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: empty, skip", flush=True)
            total_skipped += 0
            continue

        try:
            # upload_large_folder will upload the directory contents
            # The files end up as {lat_name}/{filename}.deflate in the repo
            api.upload_large_folder(
                repo_id=REPO_ID,
                repo_type="dataset",
                folder_path=lat_path,
                allow_patterns=["*.deflate"],
                num_workers=4,
                print_report_every=60,
            )
            total_uploaded += file_count
            elapsed = time.time() - t0
            print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: +{file_count} in {elapsed:.0f}s", flush=True)

        except Exception as e:
            err_str = str(e)
            elapsed = time.time() - t0
            if "429" in err_str or "rate" in err_str.lower():
                print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: RATE LIMITED at {elapsed:.0f}s, waiting 120s", flush=True)
                time.sleep(120)
                try:
                    api.upload_large_folder(
                        repo_id=REPO_ID,
                        repo_type="dataset",
                        folder_path=lat_path,
                        allow_patterns=["*.deflate"],
                        num_workers=4,
                        print_report_every=60,
                    )
                    total_uploaded += file_count
                    print(f"  Retry OK: +{file_count} in {time.time()-t0:.0f}s", flush=True)
                except Exception as e2:
                    total_errors += 1
                    print(f"  Retry failed: {str(e2)[:100]}", flush=True)
            else:
                total_errors += 1
                print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: ERROR at {elapsed:.0f}s: {err_str[:120]}", flush=True)

    elapsed = time.time() - start
    print("=" * 80)
    print(f"Done! Uploaded {total_uploaded}, errors {total_errors}")
    print(f"Total time: {elapsed:.0f}s")


if __name__ == "__main__":
    main()
