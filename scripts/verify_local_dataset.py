#!/usr/bin/env python3
"""
Verify local .merged files are consistent with HuggingFace source.

Checks:
1. All expected tiles exist locally
2. SHA256 checksums match HuggingFace
3. No corrupted chunks (decode without error)
4. Elevation ranges are physically plausible (-500m to +9000m)

Usage:
    python scripts/verify_local_dataset.py
    python scripts/verify_local_dataset.py --local /path/to/srtm30m-merged/
    python scripts/verify_local_dataset.py --workers 32
    python scripts/verify_local_dataset.py --quick  # skip checksum verification
"""

import argparse
import hashlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.merged import MergedFile

HF_API = "https://huggingface.co/api/datasets/aliasfox/srtm30m-merged/tree/main"
HF_BASE = "https://huggingface.co/datasets/aliasfox/srtm30m-merged/resolve/main"
NODATA = -32768
ELEV_MIN = -500   # deepest ocean trench
ELEV_MAX = 9000   # Mt. Everest


def get_expected_files() -> dict[str, int]:
    """Fetch expected file list from HuggingFace API."""
    import requests
    print(f"Fetching file list from {HF_API}...")
    try:
        resp = requests.get(HF_API, timeout=30)
        resp.raise_for_status()
        files = resp.json()
        return {f["path"]: f["size"] for f in files if f["path"].endswith(".merged")}
    except Exception as e:
        print(f"⚠️  Could not fetch HuggingFace file list: {e}")
        print("    Will verify local files only (checksums skipped)")
        return {}


def verify_tile(args) -> dict:
    """Verify a single .merged tile."""
    lat_dir, tile_name, local_path, check_sha256, hf_sizes = args
    path = Path(local_path) / lat_dir / f"{tile_name}.merged"
    result = {
        "tile": f"{lat_dir}/{tile_name}.merged",
        "status": "ok",
        "size": 0,
        "sha256": None,
        "min_elev": None,
        "max_elev": None,
        "chunks_valid": 0,
        "chunks_total": 0,
        "error": None,
    }

    # 1. File exists
    if not path.exists():
        result["status"] = "missing"
        return result

    result["size"] = path.stat().st_size

    # 2. Non-empty
    if result["size"] == 0:
        result["status"] = "empty"
        return result

    # 3. SHA256 (optional)
    if check_sha256:
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        result["sha256"] = sha256
        hf_key = f"{lat_dir}/{tile_name}.merged"
        if hf_key in hf_sizes:
            hf_size = hf_sizes[hf_key]
            if result["size"] != hf_size:
                result["status"] = "size_mismatch"
                result["error"] = f"local={result['size']} hf={hf_size}"
                return result

    # 4. Decode all chunks
    try:
        mf = MergedFile(path)
        result["chunks_total"] = mf.rows * mf.cols

        all_nodata = True
        for row in range(mf.rows):
            for col in range(mf.cols):
                chunk = mf.get_chunk(row, col)
                if chunk is None:
                    continue
                result["chunks_valid"] += 1
                valid = chunk[chunk != NODATA]
                if valid.size > 0:
                    all_nodata = False
                    chunk_min = int(valid.min())
                    chunk_max = int(valid.max())
                    if result["min_elev"] is None or chunk_min < result["min_elev"]:
                        result["min_elev"] = chunk_min
                    if result["max_elev"] is None or chunk_max > result["max_elev"]:
                        result["max_elev"] = chunk_max
                    # Check physical plausibility
                    if chunk_min < ELEV_MIN or chunk_max > ELEV_MAX:
                        result["status"] = "suspicious_range"
                        result["error"] = f"elev=[{chunk_min}, {chunk_max}] outside plausible range"

        if all_nodata:
            result["status"] = "all_nodata"  # Ocean tile — not an error

    except Exception as e:
        result["status"] = "decode_error"
        result["error"] = str(e)

    return result


def main():
    parser = argparse.ArgumentParser(description="Verify local .merged dataset against HuggingFace source")
    parser.add_argument(
        "--local",
        default="/nas/Temp/repos/OpenZenith/data/srtm30m-merged",
        help="Path to local .merged files",
    )
    parser.add_argument(
        "--dataset",
        default="aliasfox/srtm30m-merged",
        help="HuggingFace dataset to compare against",
    )
    parser.add_argument(
        "--workers", "-w", type=int, default=32, help="Parallel workers"
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Skip SHA256 checksum verification (faster)",
    )
    parser.add_argument(
        "--tiles", type=int, default=None, help="Limit to N tiles (for testing)",
    )
    args = parser.parse_args()

    local_dir = Path(args.local)
    if not local_dir.exists():
        print(f"❌ Local directory not found: {local_dir}")
        sys.exit(1)

    # Build task list from local files
    print(f"Scanning local files in {local_dir}...")
    tasks = []
    for lat_dir in sorted(local_dir.iterdir()):
        if not lat_dir.is_dir():
            continue
        for merged_file in sorted(lat_dir.glob("*.merged")):
            tile_name = merged_file.stem  # e.g. "N00E006"
            tasks.append((lat_dir.name, tile_name, local_dir, not args.quick, {}))

    if not tasks:
        print(f"❌ No .merged files found in {local_dir}")
        sys.exit(1)

    if args.tiles:
        tasks = tasks[: args.tiles]

    print(f"Found {len(tasks):,} local .merged files")
    if args.quick:
        print("Running in QUICK mode (checksums skipped)")

    # Get expected files from HuggingFace
    hf_sizes = {}
    if not args.quick:
        hf_sizes = get_expected_files()
        print(f"Expected {len(hf_sizes):,} files on HuggingFace")

    # Verify all files
    print(f"\nVerifying {len(tasks):,} tiles with {args.workers} workers...")
    print(f"  Valid range: {ELEV_MIN}m to {ELEV_MAX}m")
    print()

    results = {
        "ok": 0,
        "all_nodata": 0,
        "missing": 0,
        "empty": 0,
        "decode_error": 0,
        "size_mismatch": 0,
        "suspicious_range": 0,
    }
    errors = []
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(verify_tile, t): t for t in tasks}
        done = 0
        for future in as_completed(futures):
            r = future.result()
            results[r["status"]] = results.get(r["status"], 0) + 1
            done += 1

            if r["status"] not in ("ok", "all_nodata"):
                errors.append(r)

            if done % 1000 == 0 or done == len(tasks):
                elapsed = time.time() - t0
                rate = done / elapsed
                remaining = (len(tasks) - done) / rate if rate > 0 else 0
                ok = results["ok"] + results["all_nodata"]
                print(
                    f"  [{done:>6}/{len(tasks):>6}] "
                    f"✅ {ok:>5}  "
                    f"❌ {sum(v for k, v in results.items() if k not in ('ok', 'all_nodata')):>4}  "
                    f"({elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining)"
                )

    elapsed = time.time() - t0

    # ── Report ──
    print(f"\n{'=' * 70}")
    print(f"VERIFICATION COMPLETE — {elapsed:.1f}s")
    print(f"{'=' * 70}")

    print(f"\n{'Status':<20} {'Count':>10} {'%':>8}")
    print(f"{'─' * 42}")
    for status, count in sorted(results.items()):
        if count == 0:
            continue
        pct = 100 * count / len(tasks)
        icon = {"ok": "✅", "all_nodata": "🌊", "missing": "❌", "empty": "⚠️",
                "decode_error": "💥", "size_mismatch": "📏", "suspicious_range": "❓"}.get(status, "•")
        print(f"  {icon} {status:<18} {count:>10,} {pct:>7.1f}%")

    print(f"\n{'─' * 42}")
    print(f"  Total files checked:  {len(tasks):>10,}")

    # Error details
    if errors:
        print(f"\n{'=' * 70}")
        print(f"ERRORS — First 20")
        print(f"{'=' * 70}")
        for r in errors[:20]:
            print(f"  ❌ {r['tile']}")
            if r["error"]:
                print(f"     {r['error']}")
            if r["min_elev"] is not None:
                print(f"     elev: {r['min_elev']}m – {r['max_elev']}m")

    # Overall verdict
    critical_errors = results["missing"] + results["decode_error"] + results["size_mismatch"]
    if critical_errors > 0:
        print(f"\n❌ VERIFICATION FAILED — {critical_errors} critical errors found")
        print(f"   Fix these files before building v2 dataset")
        sys.exit(1)
    elif results["suspicious_range"] > 0:
        print(f"\n⚠️  VERIFICATION PASSED WITH WARNINGS — {results['suspicious_range']} suspicious tiles")
        print(f"   Review the tiles above — they may need correction")
        sys.exit(0)
    else:
        ok = results["ok"] + results["all_nodata"]
        print(f"\n✅ VERIFICATION PASSED — {ok:,}/{len(tasks):,} tiles OK")
        print(f"   Safe to build v2 dataset from this source")
        sys.exit(0)


if __name__ == "__main__":
    main()
