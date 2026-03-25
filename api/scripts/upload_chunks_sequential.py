#!/usr/bin/env python3
"""
Upload SRTM chunks to HuggingFace, one lat directory at a time.
Uses upload_folder for each directory, avoiding the massive file scan.

Usage: python scripts/upload_chunks_sequential.py [base_dir] [workers]
"""

import os
import shutil
import sys
import time

os.environ["HF_TOKEN"] = os.environ.get("HF_TOKEN", "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")

from huggingface_hub import HfApi, hf_hub_url  # noqa: E402

REPO_ID = "aliasfox/srtm30m-chunks"
BASE_DIR = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"
WORKERS = int(sys.argv[2]) if len(sys.argv) > 2 else 4


def get_uploaded_files(api: HfApi) -> set:
    """Get set of already-uploaded file paths."""
    try:
        info = api.repo_info(REPO_ID, repo_type="dataset")
        return {s.rfilename for s in info.siblings if s.rfilename.endswith(".deflate")}
    except Exception:
        return set()


def count_new_files(lat_dir: str, uploaded: set) -> int:
    """Count files in lat_dir that aren't uploaded yet."""
    lat_name = os.path.basename(lat_dir)
    count = 0
    for f in os.listdir(lat_dir):
        if f.endswith(".deflate"):
            repo_path = f"{lat_name}/{f}"
            if repo_path not in uploaded:
                count += 1
    return count


def upload_lat_dir(api: HfApi, lat_dir: str, uploaded: set) -> tuple[int, int]:
    """Upload one lat directory. Returns (uploaded_count, skipped_count)."""
    lat_name = os.path.basename(lat_dir)

    # Check if all files are already uploaded
    all_files = [f for f in os.listdir(lat_dir) if f.endswith(".deflate")]
    new_files = [f for f in all_files if f"{lat_name}/{f}" not in uploaded]

    if not new_files:
        return 0, len(all_files)

    # Copy new files to a temp dir for upload_folder
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix=f"oz_upload_{lat_name}_")

    for f in new_files:
        src = os.path.join(lat_dir, f)
        dst = os.path.join(tmpdir, f)
        shutil.copy2(src, dst)

    try:
        # Use upload_folder on the temp dir
        api.upload_folder(
            repo_id=REPO_ID,
            repo_type="dataset",
            folder_path=tmpdir,
            path_in_repo=lat_name,
        )
        return len(new_files), len(all_files) - len(new_files)
    finally:
        # Cleanup temp dir
        shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    api = HfApi()

    # Get list of lat directories
    lat_dirs = sorted([
        os.path.join(BASE_DIR, d)
        for d in os.listdir(BASE_DIR)
        if os.path.isdir(os.path.join(BASE_DIR, d)) and d[0] in ("N", "S")
    ])

    # Get already-uploaded files
    uploaded = get_uploaded_files(api)
    print(f"Already uploaded: {len(uploaded)} files", flush=True)
    print(f"Lat directories: {len(lat_dirs)}", flush=True)
    print("=" * 80, flush=True)

    total_uploaded = 0
    total_skipped = 0
    total_errors = 0
    start = time.time()

    for i, lat_dir in enumerate(lat_dirs):
        lat_name = os.path.basename(lat_dir)
        t0 = time.time()

        try:
            uploaded_count, skipped_count = upload_lat_dir(api, lat_dir, uploaded)
            total_uploaded += uploaded_count
            total_skipped += skipped_count

            # Add to uploaded set
            for f in os.listdir(lat_dir):
                if f.endswith(".deflate"):
                    uploaded.add(f"{lat_name}/{f}")

            elapsed = time.time() - t0
            status = f"+{uploaded_count}" if uploaded_count > 0 else f"skip({skipped_count})"
            print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: {status} in {elapsed:.0f}s", flush=True)

        except Exception as e:
            total_errors += 1
            err_str = str(e)
            if "429" in err_str:
                wait = 120
                print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: RATE LIMITED, waiting {wait}s")
                time.sleep(wait)
                # Retry
                try:
                    uploaded_count, skipped_count = upload_lat_dir(api, lat_dir, uploaded)
                    total_uploaded += uploaded_count
                    total_skipped += skipped_count
                    for f in os.listdir(lat_dir):
                        if f.endswith(".deflate"):
                            uploaded.add(f"{lat_name}/{f}")
                    print(f"  Retry OK: +{uploaded_count} in {time.time()-t0:.0f}s")
                except Exception as e2:
                    print(f"  Retry failed: {e2}")
            else:
                print(f"[{i+1}/{len(lat_dirs)}] {lat_name}: ERROR {err_str[:100]}")

        # Small delay between directories
        time.sleep(1)

    elapsed = time.time() - start
    print("=" * 80)
    print(f"Done! Uploaded {total_uploaded}, skipped {total_skipped}, errors {total_errors}")
    print(f"Total time: {elapsed:.0f}s")


if __name__ == "__main__":
    main()
