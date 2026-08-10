"""
OZT2 Tile Backend — read elevation from local .ozt2 tile files.

Provides a ChunkBackend-compatible interface for local OZT2 tiles,
with optional R2-compatible fetch for remote tiles.

Usage:
    from openzenith.backends.ozt2 import OZT2Backend

    backend = OZT2Backend("/path/to/ozt2/tiles")
    grid = backend.fetch_tile(z=10, x=163, y=395)
    print(grid.shape)  # (256, 256)
"""

import logging
import math
from pathlib import Path

import numpy as np

from ..tile_format_v2 import TileError, decode

_logger = logging.getLogger(__name__)


class OZT2Backend:
    """Read elevation tiles from local .ozt2 files.

    Directory structure:
        {tile_dir}/z{z}/{x}/{y}.ozt2

    Example:
        OZT2Backend("/data/ozt2_tiles")
        → reads /data/ozt2_tiles/z10/163/395.ozt2
    """

    def __init__(self, tile_dir: str | Path, suffix: str = ".ozt2"):
        self.tile_dir = Path(tile_dir)
        self.suffix = suffix

    def fetch_tile(self, z: int, x: int, y: int) -> np.ndarray | None:
        """Fetch and decode a single OZT2 tile.

        Args:
            z: Zoom level
            x: Tile X coordinate
            y: Tile Y coordinate

        Returns:
            256×256 Int16Array of elevation values (meters).
            NoData = -32768. Returns None if tile not found.
        """
        tile_path = self.tile_dir / f"z{z}" / str(x) / f"{y}{self.suffix}"
        if not tile_path.exists():
            return None
        try:
            data = tile_path.read_bytes()
            elevation, _meta = decode(data)
            return elevation
        except (OSError, TileError) as err:
            _logger.debug("local tile decode failed: %s: %s", tile_path, err)
            return None

    def fetch_tile_bytes(self, z: int, x: int, y: int) -> bytes | None:
        """Fetch raw OZT2 tile bytes (no decode)."""
        tile_path = self.tile_dir / f"z{z}" / str(x) / f"{y}{self.suffix}"
        if not tile_path.exists():
            return None
        return tile_path.read_bytes()

    def tile_exists(self, z: int, x: int, y: int) -> bool:
        """Check if a tile exists."""
        tile_path = self.tile_dir / f"z{z}" / str(x) / f"{y}{self.suffix}"
        return tile_path.exists()

    def get_elevation_at(
        self, z: int, x: int, y: int,
        lat: float, lon: float,
    ) -> float | None:
        """Get elevation at a specific lat/lon within a tile.

        Performs bilinear interpolation within the decoded tile.

        Args:
            z, x, y: Tile coordinates
            lat: Latitude of point
            lon: Longitude of point

        Returns:
            Elevation in meters, or None if tile not found or point is NODATA.
        """
        tile = self.fetch_tile(z, x, y)
        if tile is None:
            return None

        h, w = tile.shape

        # Web Mercator tile bounds
        n = 2 ** z
        lon_min = x / n * 360.0 - 180.0
        lon_max = (x + 1) / n * 360.0 - 180.0
        # y=0 in tile coords = north (lat_max), y increases southward
        lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
        lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))

        # Fractional position within tile
        fx = (lon - lon_min) / (lon_max - lon_min) if lon_max != lon_min else 0.5
        fy = (lat_max - lat) / (lat_max - lat_min) if lat_max != lat_min else 0.5

        px = fx * (w - 1)
        py = fy * (h - 1)

        x0 = min(max(0, int(px)), w - 1)
        y0 = min(max(0, int(py)), h - 1)
        x1 = min(x0 + 1, w - 1)
        y1 = min(y0 + 1, h - 1)

        fx_frac = px - int(px)
        fy_frac = py - int(py)

        v00 = tile[y0, x0]
        v10 = tile[y0, x1]
        v01 = tile[y1, x0]
        v11 = tile[y1, x1]

        if v00 == -32768 and v10 == -32768 and v01 == -32768 and v11 == -32768:
            return None

        # Bilinear interpolation
        elev = (
            v00 * (1 - fx_frac) * (1 - fy_frac) +
            v10 * fx_frac * (1 - fy_frac) +
            v01 * (1 - fx_frac) * fy_frac +
            v11 * fx_frac * fy_frac
        )

        return round(float(elev), 1)


class OZT2R2Backend:
    """Fetch OZT2 tiles from Cloudflare R2 or any S3-compatible storage.

    This backend is used by the API to serve pre-generated OZT2 tiles from R2.

    Usage:
        from openzenith.backends.ozt2 import OZT2R2Backend

        backend = OZT2R2Backend(bucket_name="my-bucket", prefix="ozt2/")
        grid = await backend.fetch_tile(z=10, x=163, y=395)
    """

    def __init__(
        self,
        bucket_name: str,
        prefix: str = "ozt2/",
        *,
        r2_account_id: str | None = None,
        r2_access_key_id: str | None = None,
        r2_secret_access_key: str | None = None,
    ):
        self.bucket_name = bucket_name
        self.prefix = prefix.rstrip("/") + "/"
        self._client = None

        import os
        self.r2_account_id = r2_account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        self.r2_access_key_id = r2_access_key_id or os.environ.get("R2_ACCESS_KEY_ID")
        self.r2_secret_access_key = r2_secret_access_key or os.environ.get("R2_SECRET_ACCESS_KEY")

    def _get_client(self):
        """Lazily create S3-compatible client for R2."""
        if self._client is not None:
            return self._client

        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 required for R2 backend. Install: pip install boto3")

        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{self.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=self.r2_access_key_id,
            aws_secret_access_key=self.r2_secret_access_key,
        )
        return self._client

    def _tile_key(self, z: int, x: int, y: int) -> str:
        """Build the R2 object key for a tile."""
        return f"{self.prefix}z{z}/{x}/{y}.ozt2"

    def fetch_tile(self, z: int, x: int, y: int) -> np.ndarray | None:
        """Fetch and decode an OZT2 tile from R2.

        Uses boto3 to fetch the raw bytes, then decodes with OZT2.
        """
        from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError

        key = self._tile_key(z, x, y)
        try:
            client = self._get_client()
            response = client.get_object(Bucket=self.bucket_name, Key=key)
            data = response["Body"].read()
            elevation, _ = decode(data)
            return elevation
        except (ClientError, EndpointConnectionError, ReadTimeoutError, TileError) as err:
            _logger.debug("R2 tile fetch failed (key=%s): %s: %s", key, type(err).__name__, err)
            return None

    def tile_exists(self, z: int, x: int, y: int) -> bool:
        """Check if a tile exists in R2."""
        from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError

        key = self._tile_key(z, x, y)
        try:
            client = self._get_client()
            client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except (ClientError, EndpointConnectionError, ReadTimeoutError) as err:
            _logger.debug("R2 tile exists check failed (key=%s): %s: %s", key, type(err).__name__, err)
            return False


class OZT2HFBackend:
    """Fetch OZT2 tiles from HuggingFace datasets.

    Downloads tiles on-demand from a HuggingFace dataset repository,
    with optional local disk caching. Uses direct HTTP requests to avoid
    HfFileSystem issues.

    Usage:
        from openzenith.backends.ozt2 import OZT2HFBackend

        backend = OZT2HFBackend("aliasfox/srtm30m-ozt2-v2")
        grid = backend.fetch_tile(z=10, x=163, y=395)

        # With local cache
        backend = OZT2HFBackend("aliasfox/srtm30m-ozt2-v2", cache_dir="/tmp/ozt2_cache")
        grid = backend.fetch_tile(z=10, x=163, y=395)
    """

    def __init__(
        self,
        repo_id: str = "aliasfox/srtm30m-ozt2-v2",
        cache_dir: str | Path | None = None,
        revision: str = "main",
    ):
        self.repo_id = repo_id
        self.revision = revision
        self._cache_dir = Path(cache_dir) if cache_dir else None

    def _get_token(self) -> str | None:
        """Get HF token from env or token attribute."""
        import os
        return os.environ.get("HF_TOKEN")

    def _tile_url(self, z: int, x: int, y: int) -> str:
        """Build the HuggingFace raw URL for a tile."""
        return (
            f"https://huggingface.co/datasets/{self.repo_id}"
            f"/resolve/{self.revision}/tiles/z{z}/{x}/{y}.ozt2"
        )

    def _cached_path(self, z: int, x: int, y: int) -> Path | None:
        """Get local cache path for a tile, if cached."""
        if self._cache_dir is None:
            return None
        return self._cache_dir / f"z{z}" / str(x) / f"{y}.ozt2"

    async def fetch_tile_async(self, z: int, x: int, y: int) -> np.ndarray | None:
        """Fetch and decode a single OZT2 tile from HuggingFace (async).

        Checks local cache first, then downloads via aiohttp.
        """
        # Check local cache
        cached = self._cached_path(z, x, y)
        if cached and cached.exists():
            try:
                data = cached.read_bytes()
                elevation, _ = decode(data)
                _logger.debug("HF tile fetch hit cache: z=%d x=%d y=%d", z, x, y)
                return elevation
            except (OSError, TileError) as err:
                _logger.debug("HF cache tile decode failed: %s: %s", cached, err)

        # Download from HuggingFace via aiohttp
        url = self._tile_url(z, x, y)
        token = self._get_token()
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            import aiohttp
            from aiohttp import ClientError
        except ImportError:
            raise ImportError("aiohttp required for async fetch. Install: pip install aiohttp")

        try:
            async with aiohttp.ClientSession() as session, session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                data = await resp.read()
            elevation, _ = decode(data)

            # Cache locally if cache_dir is set
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(data)

            _logger.debug("HF tile fetch success: z=%d x=%d y=%d", z, x, y)
            return elevation
        except (ClientError, TileError) as err:
            _logger.debug("HF tile fetch/decode failed (url=%s): %s: %s", url, type(err).__name__, err)
            return None

    def fetch_tile(self, z: int, x: int, y: int) -> np.ndarray | None:
        """Fetch and decode an OZT2 tile from HuggingFace.

        Checks local cache first, then downloads via HTTP.
        """
        import asyncio
        return asyncio.run(self.fetch_tile_async(z, x, y))

    def fetch_tile_bytes(self, z: int, x: int, y: int) -> bytes | None:
        """Fetch raw OZT2 tile bytes from HuggingFace (no decode)."""
        cached = self._cached_path(z, x, y)
        if cached and cached.exists():
            return cached.read_bytes()

        url = self._tile_url(z, x, y)
        token = self._get_token()
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            import urllib.error
            import urllib.request
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(data)
            return data
        except (urllib.error.URLError, OSError, TileError) as err:
            _logger.debug("HF tile bytes fetch failed (url=%s): %s: %s", url, type(err).__name__, err)
            return None

    def tile_exists(self, z: int, x: int, y: int) -> bool:
        """Check if a tile exists on HuggingFace via HEAD request."""
        url = self._tile_url(z, x, y)
        token = self._get_token()
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            import urllib.error
            import urllib.request
            req = urllib.request.Request(url, method="HEAD", headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except (urllib.error.URLError, OSError) as err:
            _logger.debug("HF tile exists check failed (url=%s): %s: %s", url, type(err).__name__, err)
            return False

    async def prefetch_tiles_async(
        self, tiles: list[tuple[int, int, int]], max_concurrent: int = 10
    ) -> int:
        """Prefetch multiple tiles into local cache concurrently.

        Args:
            tiles: List of (z, x, y) tuples to download
            max_concurrent: Maximum number of concurrent downloads (default 10)

        Returns:
            Number of tiles successfully cached.
        """
        if self._cache_dir is None:
            return 0

        import asyncio
        semaphore = asyncio.Semaphore(max_concurrent)

        async def _fetch_one(z: int, x: int, y: int) -> bool:
            cached = self._cached_path(z, x, y)
            if cached and cached.exists():
                return True
            try:
                url = self._tile_url(z, x, y)
                token = self._get_token()
                headers = {}
                if token:
                    headers["Authorization"] = f"Bearer {token}"

                import aiohttp
                from aiohttp import ClientError
                async with semaphore, aiohttp.ClientSession() as session, session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    data = await resp.read()
                if cached:
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    cached.write_bytes(data)
                _logger.debug("HF prefetch success: z=%d x=%d y=%d", z, x, y)
                return True
            except (ClientError, TileError) as err:
                _logger.debug("HF prefetch failed (z=%d,x=%d,y=%d): %s: %s", z, x, y, type(err).__name__, err)
                return False

        results = await asyncio.gather(*[_fetch_one(z, x, y) for z, x, y in tiles])
        return sum(results)

    def prefetch_tiles(self, tiles: list[tuple[int, int, int]]) -> int:
        """Prefetch multiple tiles into local cache.

        Args:
            tiles: List of (z, x, y) tuples to download

        Returns:
            Number of tiles successfully cached.
        """
        import asyncio
        return asyncio.run(self.prefetch_tiles_async(tiles))
