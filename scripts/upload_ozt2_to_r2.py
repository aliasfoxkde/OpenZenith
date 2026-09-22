#!/usr/bin/env python3
"""Upload OZT2 tiles from local disk to the Cloudflare R2 DEM bucket.

The dem-tile edge route serves pre-generated OZT2 tiles from the R2 bucket
bound as DEM_TILES (default: openzenith-dem) under the key scheme
`{prefix}/{z}/{x}/{y}` (no extension) — e.g. `ozt2/11/163/395`. Tiles missing
from R2 fall back to on-the-fly PNG assembly from HuggingFace, so uploading
tiles here is what makes `?format=ozt2` (and the globe terrain provider's
fast path) actually hit.

Uses the R2 REST object API (`PUT .../r2/buckets/{bucket}/objects/{key}`) with
the account's API token read from CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.
No credentials are ever read from or written to repo files.

Delta mode (default) lists the objects already under the prefix and skips
files whose size matches the remote object, so an interrupted run resumes by
simply being re-run. Sharding across `--x-start/--x-end` lets several runs
proceed in parallel over disjoint x ranges.

Examples:
    python scripts/upload_ozt2_to_r2.py --zoom 11 --workers 64
    python scripts/upload_ozt2_to_r2.py --zoom 11 --x-start 0 --x-end 682
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

import aiohttp

# Served tiles are opaque binary; the route sets its own cache headers.
CONTENT_TYPE = "application/octet-stream"

API_BASE = "https://api.cloudflare.com/client/v4/accounts"


@dataclass(frozen=True)
class UploadPlan:
    """One local file and the R2 key it must land at."""

    path: str
    key: str
    size: int


def discover_tiles(local_dir: str, zoom: int, prefix: str, x_start: int, x_end: int) -> list[UploadPlan]:
    """Walk `{local_dir}/{x}/{y}.ozt2` and build the upload plan for the x range."""
    plan: list[UploadPlan] = []
    for entry in sorted(os.listdir(local_dir)):
        if not entry.isdigit():
            continue
        x = int(entry)
        if not (x_start <= x <= x_end):
            continue
        xdir = os.path.join(local_dir, entry)
        for name in sorted(os.listdir(xdir)):
            if not name.endswith(".ozt2"):
                continue
            path = os.path.join(xdir, name)
            key = f"{prefix}/{zoom}/{x}/{name[: -len('.ozt2')]}"
            plan.append(UploadPlan(path, key, os.path.getsize(path)))
    return plan


def list_remote_sizes(bucket: str, prefix: str, token: str, account: str) -> dict[str, int]:
    """List every object under `prefix` as {key: size} (paginated)."""
    url = f"{API_BASE}/{account}/r2/buckets/{bucket}/objects"
    sizes: dict[str, int] = {}
    cursor: str | None = None
    while True:
        params = {"per_page": "1000", "prefix": prefix}
        if cursor:
            params["cursor"] = cursor
        req = urllib.request.Request(
            url + "?" + urllib.parse.urlencode(params),
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read())
        if not payload.get("success"):
            raise RuntimeError(f"R2 list failed: {payload.get('errors')}")
        for obj in payload.get("result") or []:
            sizes[obj["key"]] = obj["size"]
        # Pagination: result_info.cursor + result_info.is_truncated (not "done").
        info = payload.get("result_info") or {}
        cursor = info.get("cursor") if info.get("is_truncated") else None
        if not cursor:
            break
    return sizes


async def upload(
    plan: list[UploadPlan],
    bucket: str,
    token: str,
    account: str,
    workers: int,
    log_every: float,
) -> list[str]:
    """Upload the plan concurrently. Returns the list of error strings."""
    url_base = f"{API_BASE}/{account}/r2/buckets/{bucket}/objects"
    sem = asyncio.Semaphore(workers)
    lock = asyncio.Lock()
    state = {"done": 0, "errors": 0, "next_log": time.monotonic() + log_every}
    errors: list[str] = []
    t0 = time.monotonic()
    timeout = aiohttp.ClientTimeout(total=120, connect=30)

    async with aiohttp.ClientSession(timeout=timeout) as session:

        async def maybe_log() -> None:
            now = time.monotonic()
            if now >= state["next_log"]:
                rate = state["done"] / max(now - t0, 1e-6)
                eta = (len(plan) - state["done"]) / rate if rate > 0 else 0
                print(
                    f"  {state['done']}/{len(plan)} uploaded ({rate:.0f} obj/s, "
                    f"ETA {eta / 60:.0f} min, {state['errors']} errors)",
                    flush=True,
                )
                state["next_log"] = now + log_every

        def read_tile(path: str) -> bytes:
            with open(path, "rb") as fh:
                return fh.read()

        async def one(item: UploadPlan) -> None:
            async with sem:
                data = await asyncio.to_thread(read_tile, item.path)
                url = url_base + "/" + urllib.parse.quote(item.key, safe="")
                for attempt in range(5):
                    try:
                        async with session.put(
                            url,
                            data=data,
                            headers={"Authorization": f"Bearer {token}", "Content-Type": CONTENT_TYPE},
                        ) as resp:
                            if resp.status == 429:
                                await asyncio.sleep(float(resp.headers.get("Retry-After") or 2 ** attempt))
                                continue
                            if resp.status >= 500:
                                await asyncio.sleep(min(30, 2 ** attempt))
                                continue
                            if resp.status >= 400:
                                body = (await resp.text())[:120]
                                async with lock:
                                    errors.append(f"{item.key}: HTTP {resp.status} {body}")
                                    state["errors"] += 1
                            break
                    except aiohttp.ClientError:
                        await asyncio.sleep(min(30, 2 ** attempt))
                else:
                    async with lock:
                        errors.append(f"{item.key}: gave up after retries")
                        state["errors"] += 1
                    return
                async with lock:
                    state["done"] += 1
                    await maybe_log()

        await asyncio.gather(*[one(item) for item in plan])

    return errors


async def run(args: argparse.Namespace) -> int:
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        print("ERROR: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in the environment", file=sys.stderr)
        return 2

    t0 = time.monotonic()
    plan = discover_tiles(args.local_dir, args.zoom, args.prefix, args.x_start, args.x_end)
    total_bytes = sum(item.size for item in plan)
    print(f"local tiles in scope: {len(plan)} ({total_bytes / 1e9:.2f} GB) under {args.prefix}/{args.zoom}/")

    if not args.no_delta:
        print("listing remote objects for delta...", flush=True)
        remote = list_remote_sizes(args.bucket, f"{args.prefix}/{args.zoom}/", token, account)
        before = len(plan)
        plan = [item for item in plan if remote.get(item.key) != item.size]
        print(f"delta: {before - len(plan)} already present (size match), {len(plan)} to upload")

    if not plan:
        print("nothing to upload")
        return 0

    errors = await upload(plan, args.bucket, token, account, args.workers, args.log_every)
    print(f"done: {len(plan) - len(errors)} uploaded, {len(errors)} errors in {time.monotonic() - t0:.0f}s")
    for err in errors[: args.max_errors]:
        print(f"  ERROR {err}")
    return 1 if errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload local OZT2 tiles to the Cloudflare R2 DEM bucket")
    parser.add_argument("--local-dir", default="data/ozt2_tiles/z11", help="Local zoom dir containing {x}/{y}.ozt2")
    parser.add_argument("--zoom", type=int, default=11)
    parser.add_argument("--bucket", default="openzenith-dem", help="R2 bucket bound as DEM_TILES")
    parser.add_argument("--prefix", default="ozt2", help="R2 key prefix (route serves {prefix}/{z}/{x}/{y})")
    parser.add_argument("--workers", type=int, default=64, help="Concurrent PUTs")
    parser.add_argument("--x-start", type=int, default=0, help="Inclusive x-tile lower bound (for sharding)")
    parser.add_argument("--x-end", type=int, default=2**31 - 1, help="Inclusive x-tile upper bound (for sharding)")
    parser.add_argument("--no-delta", action="store_true", help="Skip the remote listing and re-upload everything")
    parser.add_argument("--log-every", type=float, default=30, help="Seconds between progress lines")
    parser.add_argument("--max-errors", type=int, default=20, help="How many errors to print at the end")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
