#!/usr/bin/env python3
"""
Upload pre-extracted SRTM chunks to HuggingFace.
Uses upload_large_folder with rate limit handling.
"""

import os
import sys
import time

os.environ["HF_TOKEN"] = os.environ.get("HF_TOKEN", "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")

from huggingface_hub import HfApi  # noqa: E402

REPO_ID = "aliasfox/srtm30m-chunks"
BASE_DIR = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"


def main():
    api = HfApi()

    # Count files first
    total = sum(
        1
        for root, _, files in os.walk(BASE_DIR)
        for f in files
        if f.endswith(".deflate")
    )
    print(f"Uploading {total} chunks from {BASE_DIR} to {REPO_ID}")
    print("=" * 80)

    start = time.time()

    api.upload_large_folder(
        repo_id=REPO_ID,
        repo_type="dataset",
        folder_path=BASE_DIR,
        allow_patterns=["*.deflate"],
        num_workers=4,
        print_report_every=30,
    )

    elapsed = time.time() - start
    print("=" * 80)
    print(f"Upload complete in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
