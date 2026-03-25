#!/usr/bin/env python3
"""
OpenZenith Data Setup Script

Downloads SRTM 30m GeoTIFF data from HuggingFace and optionally
extracts pre-chunked 256x256 tiles for the API.

Usage:
    python scripts/setup_data.py                    # Download TIF files only
    python scripts/setup_data.py --chunks           # Extract chunks after download
    python scripts/setup_data.py --download-only    # Download, skip extraction
    python scripts/setup_data.py --chunks-only      # Skip download, extract from existing TIFs
    python scripts/setup_data.py --workers 12       # Use 12 parallel workers

Data sources:
    - Full TIF files: huggingface.co/datasets/aliasfox/srtm30m
    - Pre-chunked:   huggingface.co/datasets/aliasfox/srtm30m-chunks
"""

import argparse
import os
import sys
import time

# Try to import huggingface_hub
try:
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    HAS_HF = True
except ImportError:
    HAS_HF = False

# Try to import huggingface_hub with token
HF_TOKEN = os.environ.get("HF_TOKEN", "")

DEFAULT_TIF_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "srtm30m")
DEFAULT_CHUNK_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "srtm30m-chunks")
HF_TIF_REPO = "aliasfox/srtm30m"
HF_CHUNK_REPO = "aliasfox/srtm30m-chunks"


def check_token():
    """Check if HuggingFace token is available."""
    if HF_TOKEN:
        return True
    # Check for cached token
    try:
        from huggingface_hub import HfFolder
        if HfFolder.get_token():
            return True
    except ImportError:
        pass
    print("ERROR: HuggingFace token required.")
    print("  Set HF_TOKEN environment variable or run: huggingface-cli login")
    return False


def download_tifs(output_dir: str, workers: int = 4):
    """Download SRTM TIF files from HuggingFace."""
    if not HAS_HF:
        print("ERROR: huggingface_hub not installed. Run: pip install huggingface_hub")
        sys.exit(1)

    if not check_token():
        sys.exit(1)

    api = HfApi(token=HF_TOKEN)

    # Check if repo exists
    try:
        info = api.repo_info(HF_TIF_REPO, repo_type="dataset", token=HF_TOKEN)
        total_files = len(info.siblings)
        print(f"Source: {HF_TIF_REPO} ({total_files} files)")
    except Exception as e:
        print(f"ERROR: Cannot access {HF_TIF_REPO}: {e}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # Check what we already have
    existing = set(f for f in os.listdir(output_dir) if f.endswith(".tif"))
    print(f"Existing TIF files: {len(existing)}")

    # Count remote files
    remote_tifs = [s.rfilename for s in info.siblings if s.rfilename.endswith(".tif")]
    missing = [f for f in remote_tifs if os.path.basename(f) not in existing]

    if not missing:
        print("All TIF files already downloaded.")
        return

    print(f"Downloading {len(missing)} TIF files to {output_dir}")
    print("=" * 60)

    downloaded = 0
    start = time.time()

    for i, remote_path in enumerate(missing):
        filename = os.path.basename(remote_path)
        local_path = os.path.join(output_dir, filename)
        try:
            hf_hub_download(
                repo_id=HF_TIF_REPO,
                filename=remote_path,
                repo_type="dataset",
                local_dir=output_dir,
                local_dir_use_symlinks=False,
                token=HF_TOKEN,
            )
            downloaded += 1
        except Exception as e:
            print(f"  FAILED: {filename}: {e}")

        if (i + 1) % 100 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed
            eta = (len(missing) - i - 1) / rate if rate > 0 else 0
            print(f"  [{(i+1)*100//len(missing)}%] {i+1}/{len(missing)} "
                  f"({downloaded} ok) ETA:{eta:.0f}s")

    elapsed = time.time() - start
    print("=" * 60)
    print(f"Downloaded {downloaded}/{len(missing)} files in {elapsed:.0f}s")


def extract_chunks(tif_dir: str, chunk_dir: str, workers: int = 8):
    """Extract 256x256 chunks from TIF files."""
    extract_script = os.path.join(os.path.dirname(__file__), "..", "api", "scripts", "extract_chunks.py")

    if not os.path.exists(extract_script):
        print(f"ERROR: Extraction script not found: {extract_script}")
        sys.exit(1)

    # Import and run
    import subprocess
    cmd = [sys.executable, extract_script, tif_dir, chunk_dir, str(workers)]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def download_chunks(chunk_dir: str, workers: int = 8):
    """Download pre-extracted chunks from HuggingFace (alternative to local extraction)."""
    if not HAS_HF:
        print("ERROR: huggingface_hub not installed. Run: pip install huggingface_hub")
        sys.exit(1)

    if not check_token():
        sys.exit(1)

    os.makedirs(chunk_dir, exist_ok=True)

    print(f"Downloading chunks from {HF_CHUNK_REPO} to {chunk_dir}")
    print("Note: This downloads ~43GB of pre-chunked data.")
    print("For faster setup, use --chunks to extract locally from TIF files.")
    print("=" * 60)

    snapshot_download(
        repo_id=HF_CHUNK_REPO,
        repo_type="dataset",
        local_dir=chunk_dir,
        local_dir_use_symlinks=False,
        token=HF_TOKEN,
        max_workers=workers,
    )

    print("Chunk download complete.")


def main():
    parser = argparse.ArgumentParser(description="OpenZenith Data Setup")
    parser.add_argument("--tif-dir", default=DEFAULT_TIF_DIR, help="Directory for TIF files")
    parser.add_argument("--chunk-dir", default=DEFAULT_CHUNK_DIR, help="Directory for chunk files")
    parser.add_argument("--workers", type=int, default=8, help="Parallel workers")
    parser.add_argument("--download-only", action="store_true", help="Download TIFs only, skip extraction")
    parser.add_argument("--chunks-only", action="store_true", help="Extract chunks from existing TIFs")
    parser.add_argument("--chunks", action="store_true", help="Download TIFs + extract chunks")
    parser.add_argument("--download-chunks", action="store_true", help="Download pre-chunked data from HF")
    args = parser.parse_args()

    tif_dir = os.path.abspath(args.tif_dir)
    chunk_dir = os.path.abspath(args.chunk_dir)

    if args.chunks_only:
        if not os.path.isdir(tif_dir):
            print(f"ERROR: TIF directory not found: {tif_dir}")
            print("Run without --chunks-only first to download TIFs.")
            sys.exit(1)
        extract_chunks(tif_dir, chunk_dir, args.workers)
    elif args.download_only:
        download_tifs(tif_dir, args.workers)
    elif args.download_chunks:
        download_chunks(chunk_dir, args.workers)
    elif args.chunks:
        download_tifs(tif_dir, args.workers)
        extract_chunks(tif_dir, chunk_dir, args.workers)
    else:
        download_tifs(tif_dir, args.workers)
        print("\nDone! To extract chunks, run:")
        print(f"  python {__file__} --chunks")


if __name__ == "__main__":
    main()
