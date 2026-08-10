"""Async elevation client for OpenZenith API.

Provides an async HTTP client for querying the OpenZenith elevation API
with connection pooling, retry logic, and batch processing.

Usage:
    import asyncio
    from openzenith.async_client import ElevationClient

    async def main():
        client = ElevationClient()

        # Single point
        result = await client.get_elevation(40.7128, -74.0060)
        print(f"NYC: {result.elevation}m")

        # Batch (up to 2000 points per request)
        results = await client.get_elevation_batch([
            (40.7128, -74.0060),   # NYC
            (35.6762, 139.6503),  # Tokyo
        ])
        for r in results:
            print(f"({r.lat}, {r.lon}): {r.elevation}m")

        # Large batch: auto-chunks and runs concurrently
        from openzenith.async_client import ElevationBatchProcessor
        processor = ElevationBatchProcessor(client, max_concurrency=4)
        async for result in processor.process(points):
            print(result)

        await client.close()

    asyncio.run(main())

Installation:
    pip install openzenith[async]   # installs aiohttp
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, AsyncIterator, cast

if TYPE_CHECKING:
    import aiohttp

__all__ = [
    "ElevationClient",
    "ElevationBatchProcessor",
    "ElevationResult",
    "ElevationPoint",
]


# ─── Data types ────────────────────────────────────────────────────────────────


@dataclass
class ElevationResult:
    """Result of a single elevation query."""

    lat: float
    lon: float
    elevation: float | None
    id: str | None = None
    source: str | None = None  # "srtm", "gebco2025", "none"
    surface_type: str | None = None  # "land", "ocean", "unknown"
    resolution: int | None = None  # meters
    error: str | None = None  # non-null when the query failed

    @property
    def is_valid(self) -> bool:
        """Return True if a valid elevation was found."""
        return self.elevation is not None and self.error is None


ElevationPoint = tuple[float, float] | dict[str, float | str | None]
"""A point: either (lat, lon) tuple or dict with 'lat', 'lon', optional 'id'."""


# ─── Async HTTP Client ────────────────────────────────────────────────────────


class ElevationClient:
    """Async HTTP client for the OpenZenith elevation API.

    Uses aiohttp for connection pooling and async I/O. The client is safe
    to reuse across many requests; it maintains a persistent connection pool.

    Args:
        base_url: Base URL of the elevation API (default: OpenZenith API).
        timeout: Request timeout in seconds (default: 30).
        max_retries: Max retries on transient failures (default: 3).
        retry_delay: Base delay between retries in seconds (default: 1).
        connector_limit: Max concurrent connections (default: 32).
        session: Optional existing aiohttp.ClientSession. If provided, the
            client does not take ownership and will not close it.

    Example:
        client = ElevationClient()
        result = await client.get_elevation(40.7128, -74.0060)
        await client.close()
    """

    def __init__(
        self,
        base_url: str = "https://openzenith.cyopsys.com",
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        connector_limit: int = 32,
        session: "aiohttp.ClientSession | None" = None,
    ):
        try:
            import aiohttp
        except ImportError:
            raise ImportError(
                "aiohttp required for async client. "
                "Install with: pip install openzenith[async] or pip install aiohttp"
            )

        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._external_session = session
        self._connector = aiohttp.TCPConnector(limit=connector_limit)
        self._owns_session = session is None
        self._session: "aiohttp.ClientSession | None" = None

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs,
    ) -> dict:
        """Make an HTTP request with retry logic."""
        import aiohttp

        delay = self._retry_delay
        last_err: Exception | None = None

        for attempt in range(self._max_retries + 1):
            session = self._get_session()
            try:
                async with session.request(
                    method,
                    f"{self._base_url}{path}",
                    timeout=aiohttp.ClientTimeout(total=self._timeout),
                    **kwargs,
                ) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    elif resp.status == 429 or resp.status >= 500:
                        # Rate-limited or server error: retry with backoff
                        last_err = RuntimeError(f"HTTP {resp.status}: {await resp.text()}")
                    else:
                        text = await resp.text()
                        raise RuntimeError(f"HTTP {resp.status}: {text}")
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                last_err = e

            if attempt < self._max_retries:
                await asyncio.sleep(delay)
                delay *= 2  # exponential backoff

        raise RuntimeError(f"Request failed after {self._max_retries + 1} attempts: {last_err}")

    def _get_session(self) -> "aiohttp.ClientSession":
        if self._external_session is not None:
            return self._external_session
        if not hasattr(self, "_session") or self._session is None or self._session.closed:
            import aiohttp
            self._session = aiohttp.ClientSession(connector=self._connector)
        assert self._session is not None
        return self._session

    async def get_elevation(
        self,
        lat: float,
        lon: float,
        *,
        id: str | None = None,
    ) -> ElevationResult:
        """Query elevation at a single lat/lon.

        Args:
            lat: Latitude (-90 to 90).
            lon: Longitude (-180 to 180).
            id: Optional identifier echoed in the result.

        Returns:
            ElevationResult with elevation in meters, or None if no data.
        """
        results = await self.get_elevation_batch([(lat, lon)], ids=[id] if id else None)
        return results[0]

    async def get_elevation_batch(
        self,
        points: list[ElevationPoint],
        *,
        ids: list[str | None] | None = None,
        zoom: int = 12,
    ) -> list[ElevationResult]:
        """Query elevation for multiple lat/lon points in one API call.

        The API accepts up to 2000 points per request. If more points are
        provided, they are automatically chunked and sent in parallel requests.

        Args:
            points: List of (lat, lon) tuples or dicts with 'lat', 'lon', optional 'id'.
            ids: Optional list of string IDs (must match len(points)). If not provided,
                IDs are not set in the request but preserved in results.
            zoom: Zoom level for the query (default: 12 = ~30m resolution).

        Returns:
            List of ElevationResult in the same order as input points.

        Raises:
            RuntimeError: If all requests fail after retries.
        """
        if not points:
            return []

        # Normalize points and track original order
        normalized: list[tuple[int, float, float, str | None]] = []  # (orig_idx, lat, lon, id)
        for i, pt in enumerate(points):
            if isinstance(pt, dict):
                lat = pt.get("lat")
                lon = pt.get("lon")
                pid = pt.get("id")
            else:
                lat, lon = pt
                pid = ids[i] if ids and i < len(ids) else None

            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                raise TypeError(f"Point {i} must be (lat, lon) tuple or dict with lat/lon: {pt!r}")
            normalized.append((i, float(lat), float(lon), cast("str | None", pid)))

        # Chunk into batches of 2000 (API limit)
        chunk_size = 2000
        chunks: list[list[tuple[int, float, float, str | None]]] = []
        for i in range(0, len(normalized), chunk_size):
            chunks.append(normalized[i : i + chunk_size])

        # Send all chunks concurrently
        async def fetch_chunk(
            chunk: list[tuple[int, float, float, str | None]],
        ) -> list[ElevationResult]:
            payload = {
                "points": [
                    {"lat": lat, "lon": lon, **({"id": pid} if pid else {})}
                    for _, lat, lon, pid in chunk
                ]
            }
            data = await self._request("POST", "/api/elevation/batch", json=payload)
            api_results: list[dict] = data.get("results", [])

            # Map back to original indices
            results_by_idx: dict[int, ElevationResult] = {}
            for r in api_results:
                idx = None
                for orig_idx, lat, lon, pid in chunk:
                    if r.get("lat") == lat and r.get("lon") == lon:
                        idx = orig_idx
                        break
                if idx is None:
                    continue
                results_by_idx[idx] = ElevationResult(
                    lat=r.get("lat", lat),
                    lon=r.get("lon", lon),
                    elevation=r.get("elevation"),
                    id=r.get("id"),
                    source="srtm",
                    resolution=30,
                )

            # Fill in missing entries (API didn't return them)
            out: list[ElevationResult] = []
            for orig_idx, lat, lon, pid in chunk:
                if orig_idx in results_by_idx:
                    out.append(results_by_idx[orig_idx])
                else:
                    out.append(ElevationResult(
                        lat=lat, lon=lon, elevation=None,
                        id=pid, error="not_returned",
                    ))

            return out

        # Run all chunks concurrently
        chunk_results = await asyncio.gather(*[fetch_chunk(c) for c in chunks])

        # Flatten in original order
        ordered: list[ElevationResult] = []
        for chunk_out in chunk_results:
            ordered.extend(chunk_out)

        return ordered

    async def close(self) -> None:
        """Close the underlying aiohttp session (no-op if session was injected)."""
        if self._owns_session and hasattr(self, "_session") and self._session is not None and not self._session.closed:
            assert self._session is not None
            await self._session.close()

    async def __aenter__(self) -> "ElevationClient":
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()


# ─── Batch Processor (large-scale) ───────────────────────────────────────────


class ElevationBatchProcessor:
    """Processes large elevation batches with controlled concurrency.

    Unlike ``ElevationClient.get_elevation_batch()`` which sends one large
    request per 2000-point chunk sequentially, this processor maintains
    N concurrent API requests so HTTP round-trips overlap.

    Use it when you have thousands of points and want maximum throughput.

    Example:
        client = ElevationClient()
        processor = ElevationBatchProcessor(client, max_concurrency=8)

        results = await processor.process_all(my_points)
        print(f"Got {len(results)} results")

        await client.close()

    Args:
        client: An ElevationClient instance.
        max_concurrency: Max simultaneous API requests (default: 8).
        chunk_size: Points per API call, max 2000 (default: 2000).
    """

    def __init__(
        self,
        client: ElevationClient,
        max_concurrency: int = 8,
        chunk_size: int = 2000,
    ):
        self._client = client
        self._max_concurrency = max_concurrency
        self._chunk_size = min(chunk_size, 2000)
        self._semaphore: asyncio.Semaphore | None = None

    def _ensure_semaphore(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self._max_concurrency)
        return self._semaphore

    async def _fetch_chunk(
        self,
        chunk: list[tuple[int, float, float, str | None]],
    ) -> list[ElevationResult]:
        """Fetch a single chunk with semaphore-controlled concurrency."""
        sem = self._ensure_semaphore()
        async with sem:
            return await self._client.get_elevation_batch(
                [(lat, lon) for _, lat, lon, _ in chunk],
                ids=[pid for _, _, _, pid in chunk],
            )

    async def process_all(
        self,
        points: list[ElevationPoint],
        *,
        ids: list[str | None] | None = None,
        progress: bool = False,
    ) -> list[ElevationResult]:
        """Process all points concurrently and return when complete.

        Args:
            points: List of (lat, lon) tuples or dicts.
            ids: Optional string IDs.
            progress: If True, prints progress every 10,000 points.

        Returns:
            List of ElevationResult in input order.
        """
        if not points:
            return []

        # Normalize
        normalized: list[tuple[int, float, float, str | None]] = []
        for i, pt in enumerate(points):
            if isinstance(pt, dict):
                lat = cast("float | int", pt.get("lat"))
                lon = cast("float | int", pt.get("lon"))
                pid = cast("str | None", pt.get("id"))
            else:
                lat, lon = pt
                pid = ids[i] if ids and i < len(ids) else None
            normalized.append((i, float(lat), float(lon), pid))

        # Chunk
        chunks: list[list[tuple[int, float, float, str | None]]] = []
        for i in range(0, len(normalized), self._chunk_size):
            chunks.append(normalized[i : i + self._chunk_size])

        # Fetch all chunks concurrently with semaphore
        chunk_results: list[list[ElevationResult]] = await asyncio.gather(
            *[self._fetch_chunk(c) for c in chunks]
        )

        # Flatten and sort back to original order
        flat: list[ElevationResult] = []
        for cr in chunk_results:
            flat.extend(cr)

        if progress:
            print(f"  Processed {len(points):,} points")

        return flat

    async def process(
        self,
        points: list[ElevationPoint],
        *,
        ids: list[str | None] | None = None,
    ) -> AsyncIterator[ElevationResult]:
        """Async generator yielding results as they arrive.

        Uses a semaphore to limit concurrent API requests to max_concurrency.
        """
        if not points:
            return

        sem = self._ensure_semaphore()

        # Normalize points
        normalized: list[tuple[int, float, float, str | None]] = []
        for i, pt in enumerate(points):
            if isinstance(pt, dict):
                lat = cast("float | int", pt.get("lat"))
                lon = cast("float | int", pt.get("lon"))
                pid = cast("str | None", pt.get("id"))
            else:
                lat, lon = pt
                pid = ids[i] if ids and i < len(ids) else None
            normalized.append((i, float(lat), float(lon), pid))

        # Chunk and fetch with controlled concurrency
        chunk_size = self._chunk_size
        for i in range(0, len(normalized), chunk_size):
            chunk = normalized[i : i + chunk_size]
            async with sem:
                results = await self._client.get_elevation_batch(
                    [(lat, lon) for _, lat, lon, _ in chunk],
                    ids=[pid for _, _, _, pid in chunk],
                )
            for r in results:
                yield r
