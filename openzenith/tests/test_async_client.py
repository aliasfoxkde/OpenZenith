"""Tests for openzenith.async_client."""

import asyncio
import pytest

from openzenith.async_client import (
    ElevationClient,
    ElevationBatchProcessor,
    ElevationResult,
    ElevationPoint,
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


class TestElevationResult:
    """Tests for ElevationResult dataclass."""

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
