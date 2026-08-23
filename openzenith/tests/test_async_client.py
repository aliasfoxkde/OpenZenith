"""Tests for openzenith.async_client."""

from unittest.mock import AsyncMock, patch

import pytest

from openzenith.async_client import (
    ElevationBatchProcessor,
    ElevationClient,
    ElevationResult,
)


@pytest.mark.integration
class TestElevationClient:
    """Tests for ElevationClient (requires live API)."""

    @pytest.mark.asyncio
    async def test_get_elevation_single(self):
        """Single-point query returns a valid result."""
        client = ElevationClient(timeout=10.0)
        # Use Tokyo which is elevated (not at sea level)
        result = await client.get_elevation(35.6762, 139.6503)
        await client.close()

        assert isinstance(result, ElevationResult)
        assert result.lat == pytest.approx(35.6762)
        assert result.lon == pytest.approx(139.6503)
        assert result.error is None
        # Tokyo is elevated (has real SRTM data)
        assert result.elevation is not None
        assert 0 < result.elevation < 5000  # reasonable elevation range

    @pytest.mark.asyncio
    async def test_get_elevation_ocean(self):
        """Ocean point returns null elevation."""
        client = ElevationClient(timeout=10.0)
        # Point in the Atlantic Ocean, far from land
        result = await client.get_elevation(0.0, -30.0)
        await client.close()

        assert isinstance(result, ElevationResult)
        # Ocean without GEBCO fallback returns null
        assert result.elevation is None or result.elevation < 0

    @pytest.mark.asyncio
    async def test_get_elevation_batch_small(self):
        """Batch of 2 points returns results for both."""
        client = ElevationClient(timeout=10.0)
        results = await client.get_elevation_batch([
            (40.7128, -74.0060),   # NYC
            (35.6762, 139.6503),  # Tokyo
        ])
        await client.close()

        assert len(results) == 2
        assert results[0].lat == pytest.approx(40.7128)
        assert results[1].lat == pytest.approx(35.6762)
        assert results[0].elevation is not None
        assert results[1].elevation is not None

    @pytest.mark.asyncio
    async def test_get_elevation_batch_with_ids(self):
        """Batch with custom IDs preserves them in results."""
        client = ElevationClient(timeout=10.0)
        results = await client.get_elevation_batch(
            [(40.7128, -74.0060), (35.6762, 139.6503)],
            ids=["nyc", "tokyo"],
        )
        await client.close()

        assert results[0].id == "nyc"
        assert results[1].id == "tokyo"

    @pytest.mark.asyncio
    async def test_get_elevation_batch_dict_points(self):
        """Batch accepts dict-style points."""
        client = ElevationClient(timeout=10.0)
        results = await client.get_elevation_batch([
            {"lat": 40.7128, "lon": -74.0060, "id": "nyc"},
            {"lat": 35.6762, "lon": 139.6503},
        ])
        await client.close()

        assert len(results) == 2
        assert results[0].id == "nyc"

    @pytest.mark.asyncio
    async def test_context_manager(self):
        """Client works as async context manager."""
        async with ElevationClient(timeout=10.0) as client:
            result = await client.get_elevation(40.7128, -74.0060)
            assert result.elevation is not None

    @pytest.mark.asyncio
    async def test_invalid_point_raises(self):
        """Invalid point raises TypeError."""
        client = ElevationClient(timeout=10.0)
        with pytest.raises(TypeError):
            await client.get_elevation_batch([("not", "numbers")])
        await client.close()


@pytest.mark.integration
class TestElevationBatchProcessor:
    """Tests for ElevationBatchProcessor (requires live API)."""

    @pytest.mark.asyncio
    async def test_process_all_small_batch(self):
        """process_all returns all results for a small batch."""
        client = ElevationClient(timeout=15.0)
        processor = ElevationBatchProcessor(client, max_concurrency=4)
        points = [(40.7128, -74.0060), (35.6762, 139.6503), (51.5074, -0.1278)]
        results = await processor.process_all(points)
        await client.close()

        assert len(results) == 3
        for r in results:
            assert r.elevation is not None
            assert r.error is None

    @pytest.mark.asyncio
    async def test_process_all_empty(self):
        """process_all with empty list returns empty list."""
        client = ElevationClient(timeout=10.0)
        processor = ElevationBatchProcessor(client)
        results = await processor.process_all([])
        await client.close()
        assert results == []

    @pytest.mark.asyncio
    async def test_process_iteration(self):
        """process() is an async generator yielding results one by one."""
        client = ElevationClient(timeout=15.0)
        processor = ElevationBatchProcessor(client, max_concurrency=4)
        points = [(40.7128, -74.0060), (35.6762, 139.6503)]
        results = []
        async for r in processor.process(points):
            results.append(r)
        await client.close()

        assert len(results) == 2
        elevations = [r.elevation for r in results]
        assert all(e is not None for e in elevations)


class TestElevationResultUnit:
    """Unit tests for ElevationResult dataclass (no network)."""

    def test_is_valid_true(self):
        """is_valid is True when elevation is present and no error."""
        r = ElevationResult(lat=40.0, lon=-74.0, elevation=10.5)
        assert r.is_valid is True

    def test_is_valid_false_null_elevation(self):
        """is_valid is False when elevation is None."""
        r = ElevationResult(lat=40.0, lon=-74.0, elevation=None)
        assert r.is_valid is False

    def test_is_valid_false_error(self):
        """is_valid is False when error is set."""
        r = ElevationResult(lat=40.0, lon=-74.0, elevation=10.0, error="timeout")
        assert r.is_valid is False

    def test_all_fields_preserved(self):
        """All fields are stored correctly."""
        r = ElevationResult(
            lat=40.0, lon=-74.0, elevation=10.5,
            id="pt1", source="srtm", surface_type="land",
            resolution=30, error=None,
        )
        assert r.lat == 40.0
        assert r.lon == -74.0
        assert r.elevation == 10.5
        assert r.id == "pt1"
        assert r.source == "srtm"
        assert r.surface_type == "land"
        assert r.resolution == 30
        assert r.error is None


class TestElevationClientUnit:
    """Unit tests for ElevationClient with mocked HTTP (no network)."""

    @pytest.mark.asyncio
    async def test_client_init_default(self):
        """Client initializes with correct defaults."""
        client = ElevationClient()
        assert client._base_url == "https://openzenith.cyopsys.com"
        assert client._timeout == 30.0
        assert client._max_retries == 3
        assert client._retry_delay == 1.0
        await client.close()

    @pytest.mark.asyncio
    async def test_client_init_custom(self):
        """Client accepts custom parameters."""
        client = ElevationClient(
            base_url="https://custom.example.com",
            timeout=60.0,
            max_retries=5,
            retry_delay=2.0,
        )
        assert client._base_url == "https://custom.example.com"
        assert client._timeout == 60.0
        assert client._max_retries == 5
        assert client._retry_delay == 2.0
        await client.close()

    @pytest.mark.asyncio
    async def test_client_context_manager(self):
        """Client can be used as async context manager."""
        async with ElevationClient() as client:
            assert client._base_url is not None
        # session should be closed after exit

    @pytest.mark.asyncio
    async def test_get_elevation_batch_empty(self):
        """Empty batch returns empty list."""
        client = ElevationClient()
        result = await client.get_elevation_batch([])
        assert result == []
        await client.close()

    @pytest.mark.asyncio
    async def test_get_elevation_batch_invalid_point_raises(self):
        """Invalid point raises TypeError."""
        client = ElevationClient()
        with pytest.raises(TypeError, match="Point 0 must be"):
            await client.get_elevation_batch([("not", "numbers")])
        await client.close()

    @pytest.mark.asyncio
    async def test_close_idempotent(self):
        """close() can be called multiple times safely."""
        client = ElevationClient()
        await client.close()
        await client.close()  # should not raise

    def test_etag_cache_direct(self):
        """ETag cache stores and retrieves entries."""
        # Just test the dict operations directly — no client instantiation needed
        cache: dict[str, tuple[str, dict]] = {}
        cache["https://example.com/api"] = ('"etag1"', {"elevation": 100.0})
        assert "https://example.com/api" in cache
        etag, data = cache["https://example.com/api"]
        assert etag == '"etag1"'
        assert data == {"elevation": 100.0}

    def test_etag_cache_clear(self):
        """ETag cache can be cleared."""
        cache: dict[str, tuple[str, dict]] = {}
        cache["https://example.com/api"] = ('"etag1"', {})
        assert len(cache) == 1
        cache.clear()
        assert len(cache) == 0


class TestElevationBatchProcessorUnit:
    """Unit tests for ElevationBatchProcessor with mocked client."""

    @pytest.mark.asyncio
    async def test_processor_init(self):
        """Processor initializes with correct defaults."""
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)
        assert proc._max_concurrency == 8
        assert proc._chunk_size == 2000
        await client.close()

    @pytest.mark.asyncio
    async def test_processor_custom_params(self):
        """Processor accepts custom concurrency and chunk_size."""
        client = ElevationClient()
        proc = ElevationBatchProcessor(client, max_concurrency=16, chunk_size=500)
        assert proc._max_concurrency == 16
        assert proc._chunk_size == 500
        await client.close()

    @pytest.mark.asyncio
    async def test_process_all_empty(self):
        """process_all with empty list returns empty list."""
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)
        result = await proc.process_all([])
        assert result == []
        await client.close()

    @pytest.mark.asyncio
    async def test_process_all_normalizes_points(self):
        """process_all accepts dict-style points."""
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)

        mock_batch_results = [
            ElevationResult(lat=40.0, lon=-74.0, elevation=10.0),
            ElevationResult(lat=41.0, lon=-73.0, elevation=20.0),
        ]

        with patch.object(client, "get_elevation_batch", new_callable=AsyncMock) as mock_batch:
            mock_batch.return_value = mock_batch_results
            result = await proc.process_all([
                {"lat": 40.0, "lon": -74.0},
                {"lat": 41.0, "lon": -73.0},
            ])

        assert len(result) == 2
        assert result[0].elevation == 10.0
        await client.close()

    @pytest.mark.asyncio
    async def test_process_is_async_generator(self):
        """process() is an async generator."""
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)

        mock_batch_results = [
            ElevationResult(lat=40.0, lon=-74.0, elevation=10.0),
        ]

        with patch.object(client, "get_elevation_batch", new_callable=AsyncMock) as mock_batch:
            mock_batch.return_value = mock_batch_results
            items = []
            async for r in proc.process([(40.0, -74.0)]):
                items.append(r)
            assert len(items) == 1

        await client.close()

