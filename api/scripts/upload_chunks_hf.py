#!/usr/bin/env python3
"""Upload pre-extracted SRTM chunks to HuggingFace using upload_large_folder."""

import os
import sys

os.environ["HF_TOKEN"] = os.environ.get("HF_TOKEN", "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")

from huggingface_hub import HfApi  # noqa: E402

REPO_ID = "aliasfox/srtm30m-chunks"
FOLDER = sys.argv[1] if len(sys.argv) > 1 else "/nas/Temp/DEMs/data/srtm30m-chunks"
WORKERS = int(sys.argv[2]) if len(sys.argv) > 2 else 8

print(f"Uploading {FOLDER} to {REPO_ID} with {WORKERS} workers")
print("=" * 80)

api = HfApi()
api.upload_large_folder(
    repo_id=REPO_ID,
    repo_type="dataset",
    folder_path=FOLDER,
    allow_patterns=["*.deflate"],
    num_workers=WORKERS,
)

print("Upload complete!")
