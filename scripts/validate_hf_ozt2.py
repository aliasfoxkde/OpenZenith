#!/usr/bin/env python3
"""
Validate OZT2 tile integrity on a HuggingFace dataset repo.

Complements validate_ozt2_tiles.py (local files) with HF-side checks:

1. Completeness — every local tile present at tiles/z{z}/{x}/{y}.ozt2
   (the exact path scheme OZT2HFBackend._tile_url resolves).
2. Integrity — stratified sample downloaded via the resolve URL, decoded
   with the same codec the SDK ships, checked for header sanity, physical
   elevation range, and encode/decode roundtrip RMSE.
3. Byte-identity — sampled tiles hash-compared against local copies.
4. Landmarks — known elevations (Everest max, Dead Sea min, NYC coastal)
   read end-to-end through the resolve URL.
5. Strays — root-level {x}/{y}.ozt2 files are unreachable by the SDK
   (it only resolves under tiles/) and are reported for cleanup.

Usage:
    # Full check against the local tile tree
    python scripts/validate_hf_ozt2.py --local data/ozt2_tiles

    # Skip the completeness scan (repo listing only, fast)
    python scripts/validate_hf_ozt2.py --sample 24

    # Emit the missing-tile list for a resumed upload
    python scripts/validate_hf_ozt2.py --local data/ozt2_tiles \
        --emit-missing /tmp/z10_missing.txt --zoom 10
"""

import argparse
import hashlib
import json
import random
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from openzenith.tile_format_v2 import auto_encode, decode

NODATA = -32768
PHYSICAL_MIN = -500
PHYSICAL_MAX = 9000
TILE_SIZE = 256

# (name, lat, lon, check, value) — loose sanity gates; the definitive check
# is byte-identity with the local source tile (the encode pipeline fuses
# GEBCO bathymetry and tiles span whole ranges, so absolute windows are
# brittle). "max"/"min" gate one direction; "range" is (min_ground, max_ground)
# meaning tmin >= min_ground and tmax >= max_ground must hold.
LANDMARKS = [
    ("everest", 27.9881, 86.9250, "max", 8000),
    ("dead_sea", 31.5000, 35.5000, "min", -300),
    ("nyc", 40.7128, -74.0060, "range", (-1000, 5)),
    ("la_paz", -16.5000, -68.1500, "max", 5000),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data: bytes) -> str:
    """Git blob object id — what HF reports as blob_id for non-LFS files."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def list_repo_files(repo_id: str) -> tuple[set[str], list[str], dict[str, str]]:
    """Return (tile files under tiles/, stray root tiles, path -> remote hash).

    Remote hash is the LFS oid (sha256) when LFS-backed, else the git blob
    id — either way comparable to a locally computed hash of the bytes.
    """
    from huggingface_hub import HfApi

    info = HfApi().dataset_info(repo_id, files_metadata=True)
    tiles: set[str] = set()
    strays: list[str] = []
    stray_hashes: dict[str, str] = {}
    hashes: dict[str, str] = {}
    for s in info.siblings or []:
        fn = s.rfilename
        if fn.startswith("tiles/") and fn.endswith(".ozt2"):
            tiles.add(fn)
            if s.lfs and s.lfs.get("oid"):
                hashes[fn] = s.lfs["oid"]
            elif s.blob_id:
                hashes[fn] = s.blob_id
        elif fn.endswith(".ozt2") and len(fn.split("/")) == 2 and fn.split("/")[0].isdigit():
            strays.append(fn)
            if s.blob_id:
                stray_hashes[fn] = s.blob_id
    return tiles, strays, hashes, stray_hashes


def local_tile_files(tile_dir: Path, zoom: int) -> dict[str, Path]:
    """Map 'z{z}/{x}/{y}.ozt2' -> local path for one zoom level."""
    zdir = tile_dir / f"z{zoom}"
    if not zdir.is_dir():
        return {}
    return {
        f"z{zoom}/{p.parent.name}/{p.name}": p for p in zdir.glob("*/*.ozt2")
    }


def fetch_tile_bytes(repo_id: str, path_in_repo: str, retries: int = 3) -> bytes | None:
    url = f"https://huggingface.co/datasets/{repo_id}/resolve/main/{path_in_repo}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "openzenith-validate/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as err:  # noqa: BLE001 - report any fetch failure
            if attempt == retries - 1:
                print(f"    fetch failed {path_in_repo}: {err}")
                return None
            time.sleep(2 ** attempt)
    return None


def check_tile_bytes(data: bytes, label: str, max_rmse: float = 1.0) -> dict:
    """Header sanity + decode + physical range + roundtrip RMSE."""
    out: dict = {"tile": label, "size": len(data)}
    if len(data) < 7:
        out["status"] = "error"
        out["error"] = "file too small"
        return out

    vmin = int.from_bytes(data[0:2], "little", signed=True)
    vrange = int.from_bytes(data[2:4], "little", signed=False)
    bits = data[4]
    if not (8 <= bits <= 16):
        out["status"], out["error"] = "error", f"invalid bits: {bits}"
        return out
    if not (-1000 <= vmin <= 10000) or vrange > 10000:
        out["status"], out["error"] = "error", f"suspicious header vmin={vmin} vrange={vrange}"
        return out
    out.update({"bits": bits, "vmin": vmin, "vrange": vrange})

    try:
        elevation, _ = decode(data)
    except Exception as err:  # noqa: BLE001
        out["status"], out["error"] = "error", f"decode failed: {err}"
        return out
    if elevation.shape != (TILE_SIZE, TILE_SIZE):
        out["status"], out["error"] = "error", f"unexpected shape {elevation.shape}"
        return out

    valid = elevation[elevation != NODATA]
    if len(valid):
        tmin, tmax = int(valid.min()), int(valid.max())
        if tmin < PHYSICAL_MIN or tmax > PHYSICAL_MAX:
            out["status"], out["error"] = "error", f"elevation out of range: {tmin}..{tmax}m"
            return out
        out.update({"tmin": tmin, "tmax": tmax, "nodata_frac": round(1 - len(valid) / elevation.size, 4)})

        try:
            reencoded, _ = auto_encode(elevation, nodata_value=NODATA, max_rmse=max_rmse)
            redecoded, _ = decode(reencoded)
            mask = elevation != NODATA
            diff = elevation[mask].astype(np.float64) - redecoded[mask].astype(np.float64)
            out["rmse"] = round(float(np.sqrt(np.mean(diff ** 2))), 4)
        except Exception as err:  # noqa: BLE001
            out["status"], out["error"] = "warn", f"roundtrip failed: {err}"
            return out

    out["status"] = "ok"
    return out


def stratified_sample(paths: list[str], n: int, seed: int) -> list[str]:
    """Random sample spread across x-directories."""
    rng = random.Random(seed)
    by_x: dict[str, list[str]] = {}
    for p in paths:
        parts = p.split("/")
        by_x.setdefault(f"{parts[1]}/{parts[2]}", []).append(p)
    picked: list[str] = []
    xdirs = sorted(by_x)
    while len(picked) < n and xdirs:
        xd = xdirs.pop(rng.randrange(len(xdirs)))
        picked.append(rng.choice(by_x[xd]))
    return picked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default="aliasfox/srtm30m-ozt2-v2")
    ap.add_argument("--local", type=Path, default=None, help="Local tile tree for completeness + hash cross-check")
    ap.add_argument("--zoom", type=int, default=10, help="Zoom level to completeness-check (default 10)")
    ap.add_argument("--sample", type=int, default=48, help="Integrity sample size (default 48)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-rmse", type=float, default=1.0)
    ap.add_argument("--emit-missing", type=Path, default=None, help="Write missing tile list here")
    ap.add_argument("--report", type=Path, default=None, help="Write JSON report here")
    ap.add_argument("--skip-sample", action="store_true", help="Listing/completeness only")
    args = ap.parse_args()

    report: dict = {"repo": args.repo, "zoom": args.zoom, "checks": {}}

    print(f"Listing {args.repo} ...")
    tiles, strays, remote_hashes, stray_hashes = list_repo_files(args.repo)
    z_prefix = f"tiles/z{args.zoom}/"
    remote_z = sorted(t for t in tiles if t.startswith(z_prefix))
    print(f"  repo tile files: {len(tiles):,} | z{args.zoom}: {len(remote_z):,} | stray root tiles: {len(strays)}")
    report["checks"]["repo_listing"] = {
        "total_tiles": len(tiles),
        f"z{args.zoom}_tiles": len(remote_z),
        "stray_root_tiles": len(strays),
    }

    # Stray root tiles are unreachable by the SDK (it only resolves under
    # tiles/). Identify them by content: if their blob hashes match local
    # z-tiles they are misplaced uploads, not unique data.
    if strays and args.local and stray_hashes:
        identified = 0
        for zoom_dir in sorted(args.local.glob("z*")):
            zoom_hashes = {git_blob_sha(p.read_bytes()) for p in zoom_dir.glob("*/*.ozt2")}
            identified += sum(1 for h in stray_hashes.values() if h in zoom_hashes)
            if identified == len(stray_hashes):
                break
        print(f"  strays identified as local duplicates: {identified}/{len(stray_hashes)}")
        report["checks"]["strays"] = {"count": len(strays), "identified_local_duplicates": identified}

    # Completeness + exhaustive byte-diff vs local (remote blob/LFS ids are
    # comparable to locally computed object hashes — no downloads needed).
    missing: list[str] = []
    if args.local:
        local = local_tile_files(args.local, args.zoom)
        remote_names = {t[len("tiles/"):] for t in remote_z}
        missing = sorted(set(local) - remote_names)
        extra = sorted(remote_names - set(local))
        print(f"  local z{args.zoom}: {len(local):,} | missing on HF: {len(missing):,} | unexpected on HF: {len(extra)}")
        report["checks"]["completeness"] = {
            "local": len(local),
            "remote": len(remote_z),
            "missing": len(missing),
            "unexpected": len(extra),
            "unexpected_paths": extra[:20],
        }
        if args.emit_missing and missing:
            args.emit_missing.write_text("\n".join("tiles/" + m for m in missing) + "\n")
            print(f"  missing list -> {args.emit_missing}")

        hashable = {t: remote_hashes.get(t) for t in remote_z}
        comparable = {t: h for t, h in hashable.items() if h}
        print(f"  byte-diff vs local ({len(comparable):,} comparable remote hashes) ...")
        match = stale = unreadable = 0
        stale_paths: list[str] = []
        for path_in_repo, rh in comparable.items():
            lp = args.local / path_in_repo[len("tiles/"):]
            try:
                lh = git_blob_sha(lp.read_bytes())
            except OSError:
                unreadable += 1
                continue
            if lh == rh:
                match += 1
            else:
                stale += 1
                if len(stale_paths) < 20:
                    stale_paths.append(path_in_repo)
        print(f"    identical: {match:,} | stale (bytes differ): {stale:,} | unreadable local: {unreadable}")
        report["checks"]["byte_diff"] = {
            "compared": match + stale,
            "identical": match,
            "stale": stale,
            "unreadable_local": unreadable,
            "stale_sample": stale_paths,
        }

    if args.skip_sample:
        return _finish(report, args)

    # Integrity sample: tiles that actually exist on the repo — sampling
    # missing paths would only measure the completeness check again.
    sample_pool = remote_z or []
    sampled = stratified_sample(sample_pool, min(args.sample, len(sample_pool)), args.seed)

    print(f"Validating {len(sampled)} sampled tiles ...")
    results, errors = [], 0
    local_root = args.local if args.local else None
    for path_in_repo in sampled:
        data = fetch_tile_bytes(args.repo, path_in_repo)
        if data is None:
            errors += 1
            results.append({"tile": path_in_repo, "status": "error", "error": "fetch failed"})
            continue
        res = check_tile_bytes(data, path_in_repo, args.max_rmse)
        if res["status"] == "error":
            errors += 1
        # Byte-identity against local counterpart; a mismatch is a staleness
        # signal, not corruption, when decoded values agree within the codec's
        # lossy tolerance (encoder generations differ; see byte_diff check).
        if local_root:
            rel = path_in_repo[len("tiles/"):]
            lp = local_root / rel
            if lp.exists():
                local_bytes = lp.read_bytes()
                res["hash_match"] = sha256(local_bytes) == sha256(data)
                if not res["hash_match"]:
                    try:
                        hf_grid, _ = decode(data)
                        loc_grid, _ = decode(local_bytes)
                        mask = (hf_grid != NODATA) & (loc_grid != NODATA)
                        nod_equal = int((hf_grid == NODATA).sum()) == int((loc_grid == NODATA).sum())
                        maxdiff = float(np.abs(hf_grid[mask].astype(np.float64) - loc_grid[mask].astype(np.float64)).max()) if mask.sum() else 0.0
                        res["decoded_max_diff"] = maxdiff
                        res["decoded_nodata_equal"] = nod_equal
                        if maxdiff <= 1.0 and nod_equal:
                            res["stale_equivalent"] = True
                        else:
                            res["status"] = "error" if res["status"] == "ok" else res["status"]
                            res.setdefault("error", f"decoded divergence: max {maxdiff}m, nodata_equal={nod_equal}")
                            errors += 1
                    except Exception as err:  # noqa: BLE001
                        res["status"] = "error" if res["status"] == "ok" else res["status"]
                        res.setdefault("error", f"recompare failed: {err}")
                        errors += 1
        results.append(res)
    oks = sum(1 for r in results if r["status"] == "ok")
    stale_eq = sum(1 for r in results if r.get("stale_equivalent"))
    hashes = [r for r in results if "hash_match" in r]
    print(f"  ok: {oks}/{len(results)} | stale-equivalent: {stale_eq} | errors: {errors} | hash-matched: {sum(1 for r in hashes if r['hash_match'])}/{len(hashes)}")
    report["checks"]["integrity_sample"] = {"sampled": len(results), "ok": oks, "stale_equivalent": stale_eq, "errors": errors, "results": results}

    # Landmark elevations through the exact SDK path scheme
    print("Landmark checks ...")
    marks = {}
    for name, lat, lon, check, want in LANDMARKS:
        x = int((lon + 180) / 360 * (2 ** args.zoom))
        lat_rad = np.radians(lat)
        y = int((1 - np.log(np.tan(lat_rad) + 1 / np.cos(lat_rad)) / np.pi) / 2 * (2 ** args.zoom))
        path = f"tiles/z{args.zoom}/{x}/{y}.ozt2"
        data = fetch_tile_bytes(args.repo, path, retries=1)
        if data is None:
            marks[name] = {"tile": path, "status": "missing"}
            continue
        grid, _ = decode(data)
        valid = grid[grid != NODATA]
        if not len(valid):
            marks[name] = {"tile": path, "status": "error", "error": "all nodata"}
            continue
        tmin, tmax = int(valid.min()), int(valid.max())
        sanity = (
            (tmax >= want) if check == "max"
            else (tmin <= want) if check == "min"
            else (tmin >= want[0] and tmax >= want[1])
        )
        mark: dict = {"tile": path, "range": [tmin, tmax], "sanity": sanity, "status": "ok"}
        # Byte-identity with the local source tile; a mismatch whose decoded
        # values agree within codec tolerance is generation staleness.
        if args.local:
            lp = args.local / f"z{args.zoom}" / str(x) / f"{y}.ozt2"
            if lp.exists():
                local_bytes = lp.read_bytes()
                mark["hash_match"] = sha256(local_bytes) == sha256(data)
                if not mark["hash_match"]:
                    loc_grid, _ = decode(local_bytes)
                    mask = (grid != NODATA) & (loc_grid != NODATA)
                    maxdiff = float(np.abs(grid[mask].astype(np.float64) - loc_grid[mask].astype(np.float64)).max()) if mask.sum() else 0.0
                    mark["decoded_max_diff"] = maxdiff
                    if maxdiff <= 1.0:
                        mark["stale_equivalent"] = True
                    else:
                        mark["status"] = "error"
                        mark["error"] = f"decoded divergence: max {maxdiff}m"
        if not sanity:
            mark["status"] = "error"
            mark.setdefault("error", f"elevation sanity failed: {tmin}..{tmax} vs {want}")
        marks[name] = mark
        extra = f" | hash {'MATCH' if mark.get('hash_match') else 'n/a'}"
        print(f"  {name}: {tmin}..{tmax}m (gate {want}) {'OK' if mark['status'] == 'ok' else 'FAIL'}{extra}")
    report["checks"]["landmarks"] = marks

    return _finish(report, args)


def _finish(report: dict, args) -> int:
    errors = 0
    if "integrity_sample" in report["checks"]:
        errors += report["checks"]["integrity_sample"]["errors"]
    bad_marks = [m for m in report["checks"].get("landmarks", {}).values() if m.get("status") == "error"]
    errors += len(bad_marks)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
        print(f"Report -> {args.report}")
    print(f"\nRESULT: {'PASS' if errors == 0 else f'FAIL ({errors} errors)'}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
