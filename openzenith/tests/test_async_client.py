"""Tests for openzenith.async_client."""

import asyncio
import sys
from unittest.mock import AsyncMock, patch

import aiohttp
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
        results = await client.get_elevation_batch(
            [
                (40.7128, -74.0060),  # NYC
                (35.6762, 139.6503),  # Tokyo
            ]
        )
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
        results = await client.get_elevation_batch(
            [
                {"lat": 40.7128, "lon": -74.0060, "id": "nyc"},
                {"lat": 35.6762, "lon": 139.6503},
            ]
        )
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
            lat=40.0,
            lon=-74.0,
            elevation=10.5,
            id="pt1",
            source="srtm",
            surface_type="land",
            resolution=30,
            error=None,
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
            result = await proc.process_all(
                [
                    {"lat": 40.0, "lon": -74.0},
                    {"lat": 41.0, "lon": -73.0},
                ]
            )

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


# ─── Fake transport for the request/retry/ETag machinery ───────────────────────


class _FakeResponse:
    """aiohttp response stand-in: async context manager with json/text."""

    def __init__(self, status=200, payload=None, headers=None, text=""):
        self.status = status
        self._payload = {} if payload is None else payload
        self.headers = headers or {}
        self._text = text

    async def json(self):
        return self._payload

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


class _FakeSession:
    """aiohttp.ClientSession stand-in playing back scripted outcomes.

    Each scripted entry is a _FakeResponse (returned once) or an Exception
    (raised from request(), like a failed connect would be).
    """

    def __init__(self, script):
        self._script = list(script)
        self.calls: list[tuple[str, str, dict]] = []

    def request(self, method, url, headers=None, timeout=None, **kwargs):
        self.calls.append((method, url, dict(headers or {})))
        outcome = self._script.pop(0) if self._script else self._script
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def call_headers(self, n):
        return self.calls[n][2]


def _client_with(script, **kwargs):
    """ElevationClient wired to a fake external session."""
    session = _FakeSession(script)
    kwargs.setdefault("retry_delay", 0.001)
    client = ElevationClient(session=session, **kwargs)
    return client, session


def _echo_results(method, url, headers=None, timeout=None, json=None, **kwargs):
    """_request replacement echoing one result per requested point."""
    return {
        "results": [
            {
                "lat": p["lat"],
                "lon": p["lon"],
                "elevation": 10.0,
                **({"id": p["id"]} if "id" in p else {}),
            }
            for p in json["points"]
        ]
    }


@pytest.mark.asyncio
class TestRequestRetryAndEtag:
    """_request against the fake transport: status handling, retries, ETag."""

    async def test_success_with_etag_then_304_serves_cache(self):
        client, session = _client_with(
            [
                _FakeResponse(200, {"elevation": 10.0}, headers={"ETag": '"v1"'}),
                _FakeResponse(304),
            ]
        )
        first = await client._request("GET", "/api/elevation?lat=1")
        assert first == {"elevation": 10.0}

        second = await client._request("GET", "/api/elevation?lat=1")
        assert second == {"elevation": 10.0}
        # Second call carried the cached ETag and the session saw it
        assert session.call_headers(1).get("If-None-Match") == '"v1"'
        await client.close()

    async def test_success_without_etag_is_not_cached(self):
        client, session = _client_with(
            [
                _FakeResponse(200, {"elevation": 3.0}),
                _FakeResponse(200, {"elevation": 4.0}),
            ]
        )
        await client._request("GET", "/api/x")
        second = await client._request("GET", "/api/x")
        assert second == {"elevation": 4.0}  # not the first payload
        assert "If-None-Match" not in session.call_headers(1)
        await client.close()

    async def test_500_retries_then_succeeds(self):
        client, _session = _client_with(
            [
                _FakeResponse(500, text="boom"),
                _FakeResponse(200, {"ok": True}),
            ]
        )
        assert await client._request("GET", "/api/x") == {"ok": True}

    async def test_429_retries_then_succeeds(self):
        client, _session = _client_with(
            [
                _FakeResponse(429, text="slow down"),
                _FakeResponse(200, {"ok": True}),
            ]
        )
        assert await client._request("GET", "/api/x") == {"ok": True}

    async def test_client_error_retries_then_succeeds(self):
        client, _session = _client_with(
            [
                aiohttp.ClientConnectionError("reset"),
                _FakeResponse(200, {"ok": True}),
            ]
        )
        assert await client._request("GET", "/api/x") == {"ok": True}

    async def test_timeout_error_retries_then_fails(self):
        script = [asyncio.TimeoutError("t")] * 4
        client, _session = _client_with(script, max_retries=3)
        with pytest.raises(RuntimeError, match="after 4 attempts"):
            await client._request("GET", "/api/x")

    async def test_all_500s_exhaust_retries(self):
        client, _session = _client_with([_FakeResponse(503, text="down")] * 4, max_retries=3)
        with pytest.raises(RuntimeError, match="after 4 attempts"):
            await client._request("GET", "/api/x")

    async def test_404_fails_immediately_without_retry(self):
        client, session = _client_with(
            [
                _FakeResponse(404, text="nope"),
            ]
        )
        with pytest.raises(RuntimeError, match="HTTP 404"):
            await client._request("GET", "/api/x")
        assert len(session.calls) == 1  # no retry on 4xx
        await client.close()


@pytest.mark.asyncio
class TestClientConstruction:
    """Session ownership and ImportError paths."""

    async def test_missing_aiohttp_raises_actionable_error(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "aiohttp", None)
        with pytest.raises(ImportError, match="pip install aiohttp"):
            ElevationClient()

    async def test_get_session_recreates_after_close(self):
        client = ElevationClient()
        first = client._get_session()
        assert client._get_session() is first
        await first.close()
        second = client._get_session()
        assert second is not first
        await second.close()
        await client.close()

    async def test_external_session_not_closed_by_client(self):
        session = _FakeSession([])
        client = ElevationClient(session=session)
        assert client._get_session() is session
        await client.close()  # must not touch the foreign session

    async def test_close_closes_owned_session(self):
        client = ElevationClient()
        session = client._get_session()
        await client.close()
        assert session.closed


@pytest.mark.asyncio
class TestBatchMapping:
    """get_elevation_batch: dict points, chunking, mapping, gaps."""

    async def test_get_elevation_single_wraps_batch(self):
        client = ElevationClient()
        with patch.object(client, "get_elevation_batch", new_callable=AsyncMock) as mock:
            mock.return_value = [ElevationResult(lat=1.0, lon=2.0, elevation=5.0)]
            result = await client.get_elevation(1.0, 2.0, id="pt")
        assert result.elevation == 5.0
        mock.assert_awaited_once_with([(1.0, 2.0)], ids=["pt"])
        await client.close()

    async def test_dict_points_and_ids(self):
        client = ElevationClient()
        with patch.object(client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.side_effect = _echo_results
            results = await client.get_elevation_batch(
                [
                    {"lat": 40.0, "lon": -74.0, "id": "nyc"},
                    {"lat": 41.0, "lon": -73.0},
                ]
            )
        assert [r.id for r in results] == ["nyc", None]
        assert all(r.elevation == 10.0 for r in results)
        await client.close()

    async def test_dict_point_with_bad_coords_raises(self):
        client = ElevationClient()
        with pytest.raises(TypeError, match="Point 0"):
            await client.get_elevation_batch([{"lat": "x", "lon": None}])
        await client.close()

    async def test_results_mapped_back_to_request_order(self):
        client = ElevationClient()

        async def shuffled(method, path, json=None, **kw):
            # Deliberately out of order: server echoes reversed
            return {
                "results": list(
                    reversed(
                        [
                            {"lat": p["lat"], "lon": p["lon"], "elevation": 1.0}
                            for p in json["points"]
                        ]
                    )
                )
            }

        with patch.object(client, "_request", side_effect=shuffled):
            results = await client.get_elevation_batch([(10.0, 20.0), (11.0, 21.0), (12.0, 22.0)])
        assert [(r.lat, r.lon) for r in results] == [(10.0, 20.0), (11.0, 21.0), (12.0, 22.0)]
        await client.close()

    async def test_unmatched_result_entries_are_dropped(self):
        client = ElevationClient()

        async def extra(method, path, json=None, **kw):
            return {
                "results": [
                    {"lat": 99.0, "lon": 99.0, "elevation": 1.0},  # not requested
                    {"lat": 10.0, "lon": 20.0, "elevation": 7.0},
                ]
            }

        with patch.object(client, "_request", side_effect=extra):
            results = await client.get_elevation_batch([(10.0, 20.0)])
        assert len(results) == 1
        assert results[0].elevation == 7.0
        await client.close()

    async def test_points_missing_from_response_marked_not_returned(self):
        client = ElevationClient()

        async def partial(method, path, json=None, **kw):
            return {"results": []}  # server lost the whole chunk

        with patch.object(client, "_request", side_effect=partial):
            results = await client.get_elevation_batch([(10.0, 20.0), (11.0, 21.0)], ids=["a", "b"])
        assert all(r.elevation is None for r in results)
        assert all(r.error == "not_returned" for r in results)
        assert [r.id for r in results] == ["a", "b"]
        await client.close()

    async def test_large_batch_chunked_into_parallel_requests(self):
        client = ElevationClient()
        calls = []

        async def counting(method, path, json=None, **kw):
            calls.append(len(json["points"]))
            return {
                "results": [
                    {"lat": p["lat"], "lon": p["lon"], "elevation": 1.0} for p in json["points"]
                ]
            }

        points = [(float(i), 0.0) for i in range(2500)]
        with patch.object(client, "_request", side_effect=counting):
            results = await client.get_elevation_batch(points)
        assert calls == [2000, 500]
        assert len(results) == 2500
        await client.close()


@pytest.mark.asyncio
class TestBatchProcessorChunking:
    """ElevationBatchProcessor concurrency, ordering, and generator paths."""

    async def test_process_all_chunks_with_concurrency(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client, max_concurrency=2, chunk_size=2)
        seen = []

        async def fake_batch(points, ids=None, **kw):
            seen.append(len(points))
            return [
                ElevationResult(lat=la, lon=lo, elevation=float(len(seen))) for la, lo in points
            ]

        with patch.object(client, "get_elevation_batch", side_effect=fake_batch):
            results = await proc.process_all([(float(i), 0.0) for i in range(5)])
        assert seen == [2, 2, 1]  # chunk_size respected
        assert len(results) == 5
        await client.close()

    async def test_process_all_progress_prints(self, capsys):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)

        async def fake_batch(points, ids=None, **kw):
            return [ElevationResult(lat=la, lon=lo, elevation=1.0) for la, lo in points]

        with patch.object(client, "get_elevation_batch", side_effect=fake_batch):
            await proc.process_all([(1.0, 2.0)], progress=True)
        assert "Processed 1 point" in capsys.readouterr().out
        await client.close()

    async def test_process_all_empty_returns_empty(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)
        assert await proc.process_all([]) == []
        await client.close()

    async def test_process_generator_yields_across_chunks(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client, chunk_size=2)

        async def fake_batch(points, ids=None, **kw):
            return [ElevationResult(lat=la, lon=lo, elevation=1.0) for la, lo in points]

        with patch.object(client, "get_elevation_batch", side_effect=fake_batch):
            yielded = [r async for r in proc.process([(float(i), 0.0) for i in range(3)])]
        assert len(yielded) == 3
        await client.close()

    async def test_process_empty_generator_yields_nothing(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)
        yielded = [r async for r in proc.process([])]
        assert yielded == []
        await client.close()

    async def test_process_accepts_dict_points_with_ids(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client, chunk_size=2)

        async def fake_batch(points, ids=None, **kw):
            assert ids == ["a", "b"]
            return [ElevationResult(lat=la, lon=lo, elevation=1.0) for la, lo in points]

        with patch.object(client, "get_elevation_batch", side_effect=fake_batch):
            yielded = [
                r
                async for r in proc.process(
                    [
                        {"lat": 1.0, "lon": 2.0, "id": "a"},
                        {"lat": 3.0, "lon": 4.0, "id": "b"},
                    ]
                )
            ]
        assert len(yielded) == 2
        await client.close()

    async def test_fetch_chunk_passes_points_and_ids(self):
        client = ElevationClient()
        proc = ElevationBatchProcessor(client)

        with patch.object(client, "get_elevation_batch", new_callable=AsyncMock) as mock:
            mock.return_value = []
            await proc._fetch_chunk([(0, 1.0, 2.0, "a"), (1, 3.0, 4.0, "b")])
        mock.assert_awaited_once_with([(1.0, 2.0), (3.0, 4.0)], ids=["a", "b"])
        await client.close()
