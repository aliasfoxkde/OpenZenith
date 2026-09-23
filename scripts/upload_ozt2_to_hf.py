#!/usr/bin/env python3
"""
Upload OZT2 tiles to HuggingFace (hash-driven delta, large commits).

Strategy:
1. ONE dataset_info(files_metadata=True) call returns every remote path with
   its content id (git blob sha, or LFS oid for LFS-backed files) — replaces
   the old per-x-directory tree listing (hundreds of HTTP calls + sleeps).
2. Local files are hashed the same way (git blob sha1 over the bytes), so the
   delta is exact: missing files are added, byte-stale files are OVERWRITTEN.
   The previous name-based delta could never refresh stale uploads.
3. Delta uploads run in large create_commit batches (default 1,500 files).
   HF hard-caps dataset commits at 128/hour, so commits are paced through a
   rolling one-hour window (100/hour with margin) and 429s wait out the
   API-reported Retry-After instead of failing the batch. Big batches are
   what make the cap survivable: 147K tiles fit in ~99 commits. Batches can run on parallel workers;
   conflicts from concurrent commits resolve through retry-with-backoff.

Usage:
    # Delta upload all zoom levels (skips byte-identical files)
    python scripts/upload_ozt2_to_hf.py --input /path/to/ozt2_tiles

    # Specific zoom, bigger batches, 3 parallel workers
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --zoom 10 \
        --batch_size 400 --workers 3

    # Dry run (prints the delta, uploads nothing)
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --dry_run

    # Ignore remote state entirely and re-upload everything
    python scripts/upload_ozt2_to_hf.py --input ./ozt2_tiles --no_skip
"""

import argparse
import logging
import os
import re
import sys
import threading
import time as _time
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

DEFAULT_REPO = "aliasfox/srtm30m-ozt2-v2"

# HF hard-caps dataset commits at 128/hour; pace below it with margin.
COMMIT_RATE_PER_HOUR = 100

# HF logs this warning and returns normally when every operation in a
# create_commit is already present server-side (content dedup) — no commit
# is created. A logging filter is the only way to see it happen.
_DEDUP_MARKER = "no files have been modified"
_dedup_local = threading.local()


class _DedupFilter(logging.Filter):
    """Record, per thread, that HF reported an all-duplicate commit."""

    def filter(self, record: logging.LogRecord) -> bool:
        if _DEDUP_MARKER in record.getMessage().lower():
            _dedup_local.hit = True
        return True


def _install_dedup_filter() -> None:
    """Attach the dedup detector to the huggingface_hub loggers (idempotent)."""
    for name in ("huggingface_hub", "huggingface_hub.hf_api"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, _DedupFilter) for f in logger.filters):
            logger.addFilter(_DedupFilter())


def _reset_dedup_flag() -> None:
    _dedup_local.hit = False


def _dedup_detected() -> bool:
    return bool(getattr(_dedup_local, "hit", False))


def probe_landed(repo_id: str, path_in_repo: str, timeout: float = 20.0) -> bool | None:
    """Whether a file is retrievable on the remote right now.

    Used after a timeout-class create_commit failure: HF often lands the
    commit server-side and only the *response* times out, so retrying blind
    produces duplicate commits (verified on the z10 backfill: batches 110/111
    committed three times each).

    create_commit is atomic — one git commit for all operations — so probing
    any single file of a batch is conclusive for the whole batch.

    Returns True (present), False (absent), or None (probe itself failed).
    Note: within hours of a mass upload the tree-listing API serves a stale
    index, but resolve URLs hit live state — that is why this probes resolve
    instead of re-listing.
    """
    url = f"https://huggingface.co/datasets/{repo_id}/resolve/main/{path_in_repo}"
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status in (200, 302)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        return None
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def git_blob_sha(path: Path) -> str:
    """Git blob object id — what HF reports as blob_id for non-LFS files."""
    import hashlib

    data = path.read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def count_local_tiles(tile_dir: Path, zoom_range: tuple[int, int] | None = None) -> dict[int, int]:
    """Count local tiles per zoom level."""
    counts = {}
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        try:
            z = int(zdir.name[1:])
        except ValueError:
            continue
        if zoom_range and (z < zoom_range[0] or z > zoom_range[1]):
            continue
        count = sum(1 for _ in zdir.rglob("*.ozt2"))
        if count:
            counts[z] = count
    return counts


def get_zoom_subdirs(tile_dir: Path, zoom_range: tuple[int, int] | None = None) -> list[Path]:
    """Get list of zoom subdirectories to upload."""
    subdirs = []
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        try:
            z = int(zdir.name[1:])
        except ValueError:
            continue
        if zoom_range and (z < zoom_range[0] or z > zoom_range[1]):
            continue
        subdirs.append(zdir)
    return subdirs


def remote_tile_hashes(repo_id: str) -> dict[str, str]:
    """One-shot listing: path_in_repo -> content hash for every repo tile."""
    from huggingface_hub import HfApi

    info = HfApi().dataset_info(repo_id, files_metadata=True)
    hashes: dict[str, str] = {}
    for s in info.siblings or []:
        fn = s.rfilename
        if fn.endswith(".ozt2"):
            if s.lfs and s.lfs.get("oid"):
                hashes[fn] = s.lfs["oid"]
            elif s.blob_id:
                hashes[fn] = s.blob_id
    return hashes


def local_tile_hashes(zdir: Path, zoom: int, workers: int = 8) -> dict[str, tuple[Path, str]]:
    """Map 'z{z}/{x}/{y}.ozt2' -> (local path, git blob sha) for a zoom dir."""
    files = sorted(zdir.glob("*/*.ozt2"))
    out: dict[str, tuple[Path, str]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(git_blob_sha, p): p for p in files}
        for fut in as_completed(futures):
            p = futures[fut]
            out[f"z{zoom}/{p.parent.name}/{p.name}"] = (p, fut.result())
    return out


def compute_delta(
    local: dict[str, tuple[Path, str]],
    remote: dict[str, str],
    path_in_repo: str,
    skip_existing: bool,
) -> list[Path]:
    """Files to upload: everything missing on the repo, plus files whose
    remote hash differs (stale encoder generations get refreshed)."""
    prefix = f"{path_in_repo}/"
    delta: list[Path] = []
    for rel, (path, sha) in sorted(local.items()):
        remote_path = prefix + rel
        if skip_existing and remote.get(remote_path) == sha:
            continue
        delta.append(path)
    return delta


def _relax_hf_timeouts() -> None:
    """Widen hf_hub's httpx timeouts (10s read / 60s write).

    A create_commit of ~1,500 tiles outlives the 60s write timeout through a
    slow link; HF still lands the commit after the client gives up, so the
    retry duplicates it. Every httpx.Timeout in this process gets 10 minutes.
    """
    import httpx
    import huggingface_hub.utils._http as hf_http

    original = httpx.Timeout
    if getattr(original, "_ozt2_patient", False):
        return

    def patient(*args: object, **kwargs: object) -> object:
        kwargs = {**kwargs, "write": 600.0}
        return original(600.0, **kwargs)

    patient._ozt2_patient = True  # type: ignore[attr-defined]
    httpx.Timeout = patient
    hf_http.httpx.Timeout = patient


def upload_batches(
    api,
    repo_id: str,
    delta: list[Path],
    rel_of: dict[int, str],
    zoom: int,
    xd_name_of: dict[int, str],
    batch_size: int,
    workers: int,
    commit_message: str | None,
) -> dict[str, int]:
    """Upload the delta in large commits, optionally on parallel workers.

    HF caps dataset commits at 128 per hour, so commits are paced through a
    rolling one-hour window sized below the cap and 429 responses are waited
    out (the API reports an exact Retry-After) instead of failing the batch.

    Timeout-class failures are verified through a resolve-URL probe before
    any retry: HF frequently lands the commit and only the response times
    out, and a blind retry creates a duplicate commit.

    Returns per-outcome file counts, e.g.
    {"uploaded": n, "already_present": n, "failed": n}.
    """
    from huggingface_hub import CommitOperationAdd

    _relax_hf_timeouts()
    _install_dedup_filter()

    batches = [delta[i:i + batch_size] for i in range(0, len(delta), batch_size)]
    print(f"  z{zoom}: {len(delta):,} files to upload in {len(batches)} commit(s) of <= {batch_size}")

    commit_lock = threading.Lock()
    commit_times: deque[float] = deque()

    def commit_slot() -> None:
        """Block until the rolling hourly window has a free commit slot."""
        while True:
            with commit_lock:
                now = _time.monotonic()
                while commit_times and now - commit_times[0] > 3600:
                    commit_times.popleft()
                if len(commit_times) < COMMIT_RATE_PER_HOUR:
                    commit_times.append(now)
                    return
                wait = 3600 - (now - commit_times[0]) + 1
            print(f"    commit pacing: hourly window full, sleeping {wait:.0f}s")
            _time.sleep(max(wait, 1))

    def run_batch(bid: int) -> str:
        """One batch: 'uploaded', 'already_present', or 'failed'."""
        batch = batches[bid]
        operations = [
            CommitOperationAdd(path_in_repo=rel_of[id(t)], path_or_fileobj=str(t))
            for t in batch
        ]
        msg = commit_message or (
            f"Upload z{zoom} OZT2 tiles batch {bid + 1}/{len(batches)}"
            f" ({xd_name_of[id(batch[0])]}…{xd_name_of[id(batch[-1])]})"
        )
        for attempt in range(8):
            commit_slot()
            _reset_dedup_flag()
            try:
                api.create_commit(
                    repo_id=repo_id,
                    repo_type="dataset",
                    operations=operations,
                    commit_message=msg,
                )
                # HF dedups content and skips the commit entirely, logging a
                # warning instead of raising — detect that and report it
                # as already_present rather than uploaded.
                return "already_present" if _dedup_detected() else "uploaded"
            except Exception as e:  # noqa: BLE001 - classify, then wait out or fail
                err = str(e).lower()
                if _DEDUP_MARKER in err or "already up to date" in err:
                    return "already_present"
                if "per hour" in err:
                    wait = 1800.0
                else:
                    m = re.search(r"retry after (\d+) seconds", err)
                    if m:
                        wait = float(m.group(1)) + 5
                    elif "timed out" in err or "timeout" in err or "connection" in err:
                        # The commit may have landed before the response
                        # timed out; probe one file (commits are atomic)
                        # instead of duplicating it.
                        landed = probe_landed(repo_id, rel_of[id(batch[0])])
                        if landed is True:
                            print(
                                f"    batch {bid + 1}: landed despite"
                                f" timeout (verified via resolve), not retrying"
                            )
                            return "uploaded"
                        wait = min(300.0, 20 * 2**attempt)
                    else:
                        print(f"    ERROR batch {bid + 1}: {e}")
                        return "failed"
                if attempt < 7:
                    print(f"    batch {bid + 1}: waiting {wait:.0f}s before retry ({str(e)[:80]}…)")
                    _time.sleep(wait)
                else:
                    print(f"    ERROR batch {bid + 1}: {e}")
                    return "failed"
        return "failed"

    counts = {"uploaded": 0, "already_present": 0, "failed": 0}
    if workers <= 1:
        for bid in range(len(batches)):
            counts[run_batch(bid)] += len(batches[bid])
            print(
                f"    batch {bid + 1}/{len(batches)} done"
                f" ({counts['uploaded'] + counts['already_present']:,} files resolved)"
            )
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(run_batch, bid): bid for bid in range(len(batches))}
            for fut in as_completed(futures):
                bid = futures[fut]
                counts[fut.result()] += len(batches[bid])
                print(
                    f"    batch {bid + 1}/{len(batches)} done"
                    f" ({counts['uploaded'] + counts['already_present']:,} files resolved)"
                )
    return counts


def upload_tiles(
    tile_dir: Path,
    repo_id: str,
    token: str | None = None,
    zoom_range: tuple[int, int] | None = None,
    path_in_repo: str = "tiles",
    dry_run: bool = False,
    skip_existing: bool = True,
    commit_message: str | None = None,
    batch_size: int = 1500,
    workers: int = 2,
    hash_workers: int = 8,
):
    """Upload OZT2 tiles to HuggingFace with exact hash-driven delta."""
    try:
        from huggingface_hub import HfApi
    except ImportError:
        raise ImportError("huggingface_hub required. Install: pip install huggingface_hub")

    api = HfApi(token=token)

    try:
        ctx = __import__("ssl").create_default_context()
        req = urllib.request.Request(
            f"https://huggingface.co/api/datasets/{repo_id}",
            headers={"User-Agent": "openzenith-upload/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            _ = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"Creating repository: {repo_id}")
            api.create_repo(repo_id, repo_type="dataset", exist_ok=True)
        else:
            raise
    except (urllib.error.URLError, OSError, TimeoutError):
        api.create_repo(repo_id, repo_type="dataset", exist_ok=True)

    local_counts = count_local_tiles(tile_dir, zoom_range)
    total_local = sum(local_counts.values())
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")
    print(f"Local tiles: {total_local:,} ({', '.join(f'z{z}:{c}' for z, c in sorted(local_counts.items()))})")
    if total_local == 0:
        print("No tiles found to upload.")
        return

    remote: dict[str, str] = {}
    if skip_existing:
        print("Listing remote repo state (single metadata call) ...")
        remote = remote_tile_hashes(repo_id)
        print(f"  remote tiles: {len(remote):,}")

    uploaded_zooms = []
    grand_uploaded = 0
    grand_present = 0
    grand_failed = 0
    for zdir in get_zoom_subdirs(tile_dir, zoom_range):
        zoom = int(zdir.name[1:])
        print(f"\n== z{zoom} ==")

        print(f"  hashing local tiles ({local_counts[zoom]:,}) ...")
        local = local_tile_hashes(zdir, zoom, hash_workers)
        delta = compute_delta(local, remote, path_in_repo, skip_existing)
        if skip_existing:
            fresh = local_counts[zoom] - len(delta)
            print(f"  delta: {len(delta):,} to upload | {fresh:,} already current")
        if not delta:
            print(f"  z{zoom}: already up to date")
            uploaded_zooms.append(zoom)
            continue
        if dry_run:
            size = sum(p.stat().st_size for p in delta)
            print(f"  [DRY RUN] would upload {len(delta):,} files ({size / 1e6:.1f} MB)")
            continue

        rel_of = {id(p): f"{path_in_repo}/z{zoom}/{p.parent.name}/{p.name}" for p in delta}
        xd_name_of = {id(p): p.parent.name for p in delta}
        counts = upload_batches(
            api, repo_id, delta, rel_of, zoom, xd_name_of,
            batch_size, workers, commit_message,
        )
        grand_uploaded += counts["uploaded"]
        grand_present += counts["already_present"]
        grand_failed += counts["failed"]
        if counts["failed"] == 0:
            uploaded_zooms.append(zoom)

    print(f"\n{'=' * 60}")
    print(
        f"Upload complete: {grand_uploaded:,} files uploaded,"
        f" {grand_present:,} already present (dedup), {grand_failed:,} failed"
    )
    if grand_present:
        # The tree listing HF serves can lag hours behind a mass upload, so
        # a large dedup share usually means the listing was stale, not that
        # this run duplicated anything.
        print(
            f"  note: {grand_present:,} files were confirmed present on the"
            f" remote despite the listing — a stale remote index or an"
            f" earlier landed commit"
        )
    print(f"Zoom levels synced: {uploaded_zooms}")
    print(f"Repository: https://huggingface.co/datasets/{repo_id}")
    return 0 if grand_failed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload OZT2 tiles to HuggingFace")
    parser.add_argument("--input", "-i", required=True, help="Local OZT2 tile directory")
    parser.add_argument("--repo_id", "-r", default=DEFAULT_REPO,
                        help=f"HuggingFace repository ID (default: {DEFAULT_REPO})")
    parser.add_argument("--token", "-t", default=None,
                        help="HuggingFace token (default: from HF_TOKEN env var)")
    parser.add_argument("--zoom", "-z", default=None,
                        help="Zoom range, e.g. '7-11' or '7,8,10'")
    parser.add_argument("--path_in_repo", default="tiles",
                        help="Path in repository (default: tiles)")
    parser.add_argument("--dry_run", action="store_true",
                        help="Show what would be uploaded without uploading")
    parser.add_argument("--no_skip", action="store_true",
                        help="Re-upload all tiles (overwrites existing, skips nothing)")
    parser.add_argument("--commit_message", "-m", default=None,
                        help="Custom commit message")
    parser.add_argument("--batch_size", type=int, default=1500,
                        help="Files per create_commit batch (default 1500; HF caps\n                        commits at 128/hour, so fewer bigger commits win)")
    parser.add_argument("--workers", type=int, default=2,
                        help="Parallel commit workers (default 2; HF serializes commits, retries absorb conflicts)")
    parser.add_argument("--hash_workers", type=int, default=8,
                        help="Parallel local hashing threads (default 8)")

    args = parser.parse_args()

    tile_dir = Path(args.input)
    if not tile_dir.exists():
        print(f"Error: {tile_dir} does not exist")
        return 1

    zoom_range = None
    if args.zoom:
        if "," in args.zoom:
            levels = [int(z) for z in args.zoom.split(",")]
            zoom_range = (min(levels), max(levels))
        elif "-" in args.zoom:
            parts = args.zoom.split("-")
            zoom_range = (int(parts[0]), int(parts[1]))
        else:
            zoom_range = (int(args.zoom),) * 2

    token = args.token or os.environ.get("HF_TOKEN")

    return upload_tiles(
        tile_dir=tile_dir,
        repo_id=args.repo_id,
        token=token,
        zoom_range=zoom_range,
        path_in_repo=args.path_in_repo,
        dry_run=args.dry_run,
        skip_existing=not args.no_skip,
        commit_message=args.commit_message,
        batch_size=args.batch_size,
        workers=args.workers,
        hash_workers=args.hash_workers,
    )


if __name__ == "__main__":
    sys.exit(main())
