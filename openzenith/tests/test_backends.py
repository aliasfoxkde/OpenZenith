"""Tests for OZT2 tile backends."""

import asyncio
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from openzenith.backends.ozt2 import OZT2Backend, OZT2HFBackend, OZT2R2Backend
from openzenith.tile_format_v2 import auto_encode

NODATA = -32768
TILE_SIZE = 256


def make_grid(vmin: int = 0, vmax: int = 1000) -> np.ndarray:
    """Create a synthetic 256×256 elevation grid with a vertical gradient."""
    grid = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.int16)
    for row in range(TILE_SIZE):
        grid[row, :] = vmin + int((vmax - vmin) * row / TILE_SIZE)
    return grid


class TestOZT2Backend:
    """Tests for OZT2Backend reading local .ozt2 tiles."""

    def test_fetch_tile_nonexistent(self, tmp_path: Path):
        backend = OZT2Backend(tmp_path)
        result = backend.fetch_tile(z=10, x=163, y=395)
        assert result is None

    def test_fetch_tile_roundtrip(self, tmp_path: Path):
        grid = make_grid(0, 1000)
        encoded, _ = auto_encode(grid, nodata_value=NODATA, max_rmse=1.0)

        tile_dir = tmp_path / "z10" / "163"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "395.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        result = backend.fetch_tile(z=10, x=163, y=395)

        assert result is not None
        assert result.shape == (TILE_SIZE, TILE_SIZE)
        assert abs(float(result[0, 0]) - float(grid[0, 0])) <= 2

    def test_fetch_tile_wrong_zoom(self, tmp_path: Path):
        grid = make_grid(0, 500)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)
        tile_dir = tmp_path / "z9" / "163"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "395.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        result = backend.fetch_tile(z=10, x=163, y=395)
        assert result is None

    def test_tile_exists(self, tmp_path: Path):
        grid = make_grid(0, 500)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)
        tile_dir = tmp_path / "z8" / "50"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "100.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        assert backend.tile_exists(z=8, x=50, y=100) is True
        assert backend.tile_exists(z=8, x=50, y=101) is False
        assert backend.tile_exists(z=9, x=50, y=100) is False

    def test_fetch_tile_bytes(self, tmp_path: Path):
        grid = make_grid(0, 500)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)
        tile_dir = tmp_path / "z7" / "10"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "20.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        raw = backend.fetch_tile_bytes(z=7, x=10, y=20)
        assert raw is not None
        assert len(raw) == len(encoded)

    def test_custom_suffix(self, tmp_path: Path):
        grid = make_grid(0, 500)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)
        tile_dir = tmp_path / "z5" / "1"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "2.bin").write_bytes(encoded)

        backend = OZT2Backend(tmp_path, suffix=".bin")
        result = backend.fetch_tile(z=5, x=1, y=2)
        assert result is not None
        assert result.shape == (TILE_SIZE, TILE_SIZE)

    def test_nodata_tiles(self, tmp_path: Path):
        """All-NODATA tiles should decode to a valid array."""
        grid = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.int16)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z6" / "30"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "60.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        result = backend.fetch_tile(z=6, x=30, y=60)
        assert result is not None
        assert result.shape == (TILE_SIZE, TILE_SIZE)

    def test_various_elevation_ranges(self, tmp_path: Path):
        """Test tiles at different elevation ranges (flat, moderate, extreme)."""
        cases = [
            ("flat", 0, 50),
            ("moderate", 200, 800),
            ("extreme", -400, 8900),
        ]

        backend = OZT2Backend(tmp_path)
        for name, vmin, vmax in cases:
            grid = make_grid(vmin, vmax)
            encoded, _meta = auto_encode(grid, nodata_value=NODATA, max_rmse=1.0)

            z, x, y = 10, 100, 200
            tile_dir = tmp_path / f"z{z}" / str(x)
            tile_dir.mkdir(parents=True, exist_ok=True)
            (tile_dir / f"{y}.ozt2").write_bytes(encoded)

            result = backend.fetch_tile(z=z, x=x, y=y)
            assert result is not None, f"{name}: fetch_tile returned None"
            assert result.shape == (TILE_SIZE, TILE_SIZE), f"{name}: wrong shape"

    def test_get_elevation_at_inside_tile(self, tmp_path: Path):
        """Test get_elevation_at with a point clearly inside a tile."""
        # Tile (2, 1) at z=2: lon=[0, 90), lat=[0, ~66°]
        # Use center of tile: lon=45, lat=33
        grid = np.full((TILE_SIZE, TILE_SIZE), 1000, dtype=np.int16)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z2" / "2"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "1.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        elev = backend.get_elevation_at(z=2, x=2, y=1, lat=33.0, lon=45.0)
        assert elev is not None
        # Grid is constant 1000 everywhere, so any interpolation gives ~1000
        assert abs(elev - 1000.0) < 50

    def test_get_elevation_at_outside_tile(self, tmp_path: Path):
        """Point outside tile should still return interpolated value (clamped)."""
        grid = np.full((TILE_SIZE, TILE_SIZE), 500, dtype=np.int16)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z1" / "0"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "0.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        # lon=200 is outside z1/x0 tile (which is [−180, 0) × [−85, 85])
        elev = backend.get_elevation_at(z=1, x=0, y=0, lat=0.0, lon=200.0)
        # Should not crash; returns interpolated (clamped) or nodata
        assert elev is None or isinstance(elev, float)

    def test_get_elevation_at_nodata_tile(self, tmp_path: Path):
        """All-nodata tile should return None."""
        grid = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.int16)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z3" / "5"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "5.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        elev = backend.get_elevation_at(z=3, x=5, y=5, lat=30.0, lon=0.0)
        # NODATA tiles may produce interpolated nodata — either None or nodata value
        assert elev is None or elev == -32768


class TestOZT2HFBackend:
    """Tests for OZT2HFBackend."""

    def test_init_default_repo(self):
        backend = OZT2HFBackend()
        assert backend.repo_id == "aliasfox/srtm30m-ozt2-v2"
        assert backend.revision == "main"
        assert backend._cache_dir is None

    def test_init_with_cache_dir(self, tmp_path: Path):
        backend = OZT2HFBackend(cache_dir=tmp_path)
        assert backend._cache_dir == tmp_path

    def test_tile_url(self):
        backend = OZT2HFBackend("aliasfox/srtm30m-ozt2-v2")
        url = backend._tile_url(10, 163, 395)
        assert "aliasfox/srtm30m-ozt2-v2" in url
        assert "z10" in url
        assert "163" in url
        assert "395.ozt2" in url

    def test_cached_path(self, tmp_path: Path):
        backend = OZT2HFBackend(cache_dir=tmp_path)
        path = backend._cached_path(10, 163, 395)
        assert path is not None
        assert str(path).endswith("z10/163/395.ozt2")

    def test_cached_path_no_cache_dir(self):
        backend = OZT2HFBackend()
        path = backend._cached_path(10, 163, 395)
        assert path is None

    def test_fetch_tile_bytes_cached(self, tmp_path: Path):
        """fetch_tile_bytes returns cached data without network call."""
        backend = OZT2HFBackend(cache_dir=tmp_path)
        # Create a fake cached tile
        cached_tile = tmp_path / "z10" / "163" / "395.ozt2"
        cached_tile.parent.mkdir(parents=True, exist_ok=True)
        fake_data = b"\x00\x01\x02\x03"
        cached_tile.write_bytes(fake_data)
        result = backend.fetch_tile_bytes(z=10, x=163, y=395)
        assert result == fake_data

    def test_tile_exists_false_for_nonexistent(self):
        """tile_exists returns False for non-existent tiles (no network)."""
        backend = OZT2HFBackend()
        # This will try a HEAD request which will fail
        result = backend.tile_exists(999, 999, 999)
        assert result is False

    def test_fetch_tile_returns_none_for_missing(self):
        """fetch_tile returns None for non-existent tiles."""
        backend = OZT2HFBackend()
        # This would try to download from HF which will fail
        result = backend.fetch_tile(999, 999, 999)
        assert result is None


class TestOZT2R2Backend:
    """Tests for OZT2R2Backend."""

    def test_init(self):
        backend = OZT2R2Backend(bucket_name="test-bucket", prefix="ozt2/")
        assert backend.bucket_name == "test-bucket"
        assert backend.prefix == "ozt2/"

    def test_tile_key(self):
        backend = OZT2R2Backend(bucket_name="test", prefix="ozt2/")
        key = backend._tile_key(10, 163, 395)
        assert key == "ozt2/z10/163/395.ozt2"

    def test_tile_key_no_trailing_slash(self):
        backend = OZT2R2Backend(bucket_name="test", prefix="ozt2")
        assert backend.prefix == "ozt2/"

    def test_fetch_tile_without_boto3(self):
        """fetch_tile raises ImportError if boto3 not available."""
        with patch.dict("sys.modules", {"boto3": None, "botocore": None}):
            backend = OZT2R2Backend(bucket_name="test")
            with pytest.raises(ImportError, match="boto3 required"):
                backend._get_client()

    def test_tile_exists_without_boto3(self):
        """tile_exists raises ImportError if boto3 not available."""
        with patch.dict("sys.modules", {"boto3": None, "botocore.exceptions": None}):
            backend = OZT2R2Backend(bucket_name="test")
            with pytest.raises((ImportError, ModuleNotFoundError)):
                backend.tile_exists(10, 163, 395)


class TestOZT2BackendGetElevationAtEdgeCases:
    """Edge case tests for OZT2Backend.get_elevation_at."""

    def test_bilinear_interpolation_corners(self, tmp_path: Path):
        """Test bilinear interpolation at all four corners."""
        # Create a tile with known gradient
        grid = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.int16)
        for r in range(TILE_SIZE):
            grid[r, :] = r * 10  # vertical gradient
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z2" / "0"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "0.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        # NW corner (should be low)
        elev_nw = backend.get_elevation_at(z=2, x=0, y=0, lat=85.0, lon=-180.0)
        # SE corner (should be high)
        elev_se = backend.get_elevation_at(z=2, x=0, y=0, lat=-85.0, lon=0.0)

        assert elev_nw is not None
        assert elev_se is not None
        assert elev_nw < elev_se  # NW should be lower due to gradient

    def test_all_nodata_returns_none(self, tmp_path: Path):
        """All-NODATA tile returns None."""
        grid = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.int16)
        encoded, _ = auto_encode(grid, nodata_value=NODATA)

        tile_dir = tmp_path / "z5" / "10"
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / "10.ozt2").write_bytes(encoded)

        backend = OZT2Backend(tmp_path)
        elev = backend.get_elevation_at(z=5, x=10, y=10, lat=0.0, lon=0.0)
        assert elev is None


# ─── Fakes for R2 / HF transports ──────────────────────────────────────────────


class _FakeS3Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class _FakeS3Client:
    """boto3 client stand-in serving canned objects or raising canned errors."""

    def __init__(self, objects=None, get_error=None, head_error=None):
        self.objects = objects or {}
        self.get_error = get_error
        self.head_error = head_error
        self.gets = []
        self.heads = []

    def get_object(self, Bucket, Key):
        self.gets.append(Key)
        if self.get_error is not None:
            raise self.get_error
        return {"Body": _FakeS3Body(self.objects[Key])}

    def head_object(self, Bucket, Key):
        self.heads.append(Key)
        if self.head_error is not None:
            raise self.head_error
        return {}


class _FakeAiohttpResponse:
    def __init__(self, data):
        self._data = data

    async def read(self):
        return self._data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


class _FakeAiohttpSession:
    def __init__(self, data):
        self._data = data
        self.urls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        if isinstance(self._data, Exception):
            raise self._data
        return _FakeAiohttpResponse(self._data)


class _FakeUrlResponse:
    """urllib response stand-in: context manager with read()/status."""

    def __init__(self, data=b"", status=200):
        self._data = data
        self.status = status

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def _write_tile(tile_dir: Path, z: int, x: int, y: int, grid: np.ndarray) -> Path:
    tile_path = tile_dir / f"z{z}" / str(x)
    tile_path.mkdir(parents=True, exist_ok=True)
    (tile_path / f"{y}.ozt2").write_bytes(auto_encode(grid)[0])
    return tile_path


class TestOZT2BackendFailurePaths:
    """OZT2Backend decode failures and absent-tile branches."""

    def test_corrupt_tile_returns_none(self, tmp_path: Path):
        tile_path = tmp_path / "z10" / "163"
        tile_path.mkdir(parents=True)
        (tile_path / "395.ozt2").write_bytes(b"garbage")
        backend = OZT2Backend(tmp_path)
        assert backend.fetch_tile(z=10, x=163, y=395) is None

    def test_fetch_tile_bytes_nonexistent(self, tmp_path: Path):
        backend = OZT2Backend(tmp_path)
        assert backend.fetch_tile_bytes(z=10, x=1, y=2) is None

    def test_get_elevation_at_missing_tile_is_none(self, tmp_path: Path):
        backend = OZT2Backend(tmp_path)
        assert backend.get_elevation_at(z=10, x=1, y=2, lat=40.0, lon=-74.0) is None


class TestOZT2R2BackendFetch:
    """OZT2R2Backend against a faked boto3 client."""

    def _backend(self, client):
        backend = OZT2R2Backend(
            bucket_name="test-bucket",
            r2_account_id="acct",
            r2_access_key_id="key",
            r2_secret_access_key="secret",
        )
        backend._client = client
        return backend

    def test_fetch_tile_decodes_object(self):
        grid = make_grid()
        client = _FakeS3Client(objects={"ozt2/z10/163/395.ozt2": auto_encode(grid)[0]})
        backend = self._backend(client)
        result = backend.fetch_tile(z=10, x=163, y=395)
        assert result is not None and result.shape == (TILE_SIZE, TILE_SIZE)
        assert client.gets == ["ozt2/z10/163/395.ozt2"]

    def test_fetch_tile_client_error_returns_none(self):
        from botocore.exceptions import ClientError

        err = ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        backend = self._backend(_FakeS3Client(get_error=err))
        assert backend.fetch_tile(z=10, x=163, y=395) is None

    def test_fetch_tile_corrupt_object_returns_none(self):
        backend = self._backend(_FakeS3Client(objects={"ozt2/z10/1/2.ozt2": b"garbage"}))
        assert backend.fetch_tile(z=10, x=1, y=2) is None

    def test_tile_exists_true_and_false(self):
        from botocore.exceptions import ClientError

        err = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        present = self._backend(_FakeS3Client(objects={"ozt2/z10/1/2.ozt2": b"x"}))
        assert present.tile_exists(z=10, x=1, y=2) is True
        absent = self._backend(_FakeS3Client(head_error=err))
        assert absent.tile_exists(z=10, x=1, y=2) is False

    def test_get_client_creates_and_reuses_boto3_client(self):
        pytest.importorskip("boto3")
        backend = OZT2R2Backend(
            bucket_name="b",
            r2_account_id="acct",
            r2_access_key_id="k",
            r2_secret_access_key="s",
        )
        first = backend._get_client()
        assert first is not None
        assert backend._get_client() is first  # cached, not rebuilt

    def test_get_client_without_boto3_raises(self, monkeypatch):
        import sys

        backend = OZT2R2Backend(
            bucket_name="b",
            r2_account_id="acct",
            r2_access_key_id="k",
            r2_secret_access_key="s",
        )
        monkeypatch.setitem(sys.modules, "boto3", None)
        with pytest.raises(ImportError, match="pip install boto3"):
            backend._get_client()


class TestOZT2HFBackendAsyncFetch:
    """OZT2HFBackend.fetch_tile_async with a faked aiohttp layer."""

    def test_cache_hit_skips_network(self, tmp_path: Path):
        grid = make_grid()
        _write_tile(tmp_path, 10, 163, 395, grid)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        result = asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395))
        assert result is not None and result.shape == (TILE_SIZE, TILE_SIZE)

    def test_corrupt_cache_falls_through_to_download(self, tmp_path: Path, monkeypatch):
        import aiohttp

        grid = make_grid()
        corrupt = tmp_path / "z10" / "163"
        corrupt.mkdir(parents=True)
        (corrupt / "395.ozt2").write_bytes(b"garbage")

        session = _FakeAiohttpSession(auto_encode(grid)[0])
        monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **k: session)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        result = asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395))
        assert result is not None
        # The freshly downloaded bytes replaced the corrupt cache entry
        assert (tmp_path / "z10" / "163" / "395.ozt2").read_bytes() == session._data

    def test_download_success_writes_cache(self, tmp_path: Path, monkeypatch):
        import aiohttp

        grid = make_grid()
        payload = auto_encode(grid)[0]
        session = _FakeAiohttpSession(payload)
        monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **k: session)

        backend = OZT2HFBackend(cache_dir=tmp_path)
        result = asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395))
        assert result is not None and result.shape == (TILE_SIZE, TILE_SIZE)
        assert (tmp_path / "z10" / "163" / "395.ozt2").read_bytes() == payload

    def test_download_client_error_returns_none(self, tmp_path: Path, monkeypatch):
        import aiohttp

        session = _FakeAiohttpSession(aiohttp.ClientError("offline"))
        monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **k: session)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        assert asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395)) is None

    def test_download_corrupt_payload_returns_none(self, tmp_path: Path, monkeypatch):
        import aiohttp

        session = _FakeAiohttpSession(b"not a tile")
        monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **k: session)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        assert asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395)) is None

    def test_missing_aiohttp_raises(self, tmp_path: Path, monkeypatch):
        import sys

        monkeypatch.setitem(sys.modules, "aiohttp", None)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        with pytest.raises(ImportError, match="pip install aiohttp"):
            asyncio.run(backend.fetch_tile_async(z=10, x=163, y=395))


class TestOZT2HFBackendBytesAndExists:
    """fetch_tile_bytes / tile_exists over a faked urllib."""

    def test_fetch_bytes_downloads_and_caches(self, tmp_path: Path, monkeypatch):
        import urllib.request

        payload = auto_encode(make_grid())[0]

        def fake_urlopen(req, timeout=None):
            return _FakeUrlResponse(payload)

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        data = backend.fetch_tile_bytes(z=10, x=163, y=395)
        assert data == payload
        assert (tmp_path / "z10" / "163" / "395.ozt2").read_bytes() == payload

    def test_fetch_bytes_urlerror_returns_none(self, tmp_path: Path, monkeypatch):
        import urllib.error
        import urllib.request

        def fake_urlopen(req, timeout=None):
            raise urllib.error.URLError("no dns")

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
        backend = OZT2HFBackend(cache_dir=tmp_path)
        assert backend.fetch_tile_bytes(z=10, x=163, y=395) is None

    def test_tile_exists_head_200(self, monkeypatch):
        import urllib.request

        monkeypatch.setattr(
            urllib.request, "urlopen", lambda req, timeout=None: _FakeUrlResponse(status=200)
        )
        backend = OZT2HFBackend()
        assert backend.tile_exists(z=10, x=163, y=395) is True

    def test_tile_exists_head_fails(self, monkeypatch):
        import urllib.error
        import urllib.request

        def fake_urlopen(req, timeout=None):
            raise urllib.error.URLError("refused")

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
        backend = OZT2HFBackend()
        assert backend.tile_exists(z=10, x=163, y=395) is False


class TestOZT2HFBackendPrefetch:
    """prefetch_tiles_async counting across cached/fresh/failed tiles."""

    def test_no_cache_dir_returns_zero(self):
        backend = OZT2HFBackend()
        assert asyncio.run(backend.prefetch_tiles_async([(10, 1, 2)])) == 0

    def test_mixed_prefetch_counts(self, tmp_path: Path, monkeypatch):
        import aiohttp

        # One tile already cached, two to download (one succeeds, one fails).
        # Prefetch caches raw bytes without decoding, so a stub payload is fine.
        _write_tile(tmp_path, 10, 1, 1, make_grid())

        class _RoutingSession:
            """Serve per-URL canned bytes so concurrent fetches stay deterministic."""

            def __init__(self, routes):
                self._routes = routes

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc_info):
                return False

            def get(self, url, headers=None, timeout=None):
                for suffix, data in self._routes.items():
                    if url.endswith(suffix):
                        if isinstance(data, Exception):
                            raise data
                        return _FakeAiohttpResponse(data)
                raise AssertionError(f"unexpected prefetch url: {url}")

        session = _RoutingSession(
            {
                "/1/2.ozt2": b"payload",
                "/1/3.ozt2": aiohttp.ClientError("offline"),
            }
        )
        monkeypatch.setattr(aiohttp, "ClientSession", lambda *a, **k: session)

        backend = OZT2HFBackend(cache_dir=tmp_path)
        count = asyncio.run(backend.prefetch_tiles_async([(10, 1, 1), (10, 1, 2), (10, 1, 3)]))
        assert count == 2  # cached + first download
        assert (tmp_path / "z10" / "1" / "2.ozt2").read_bytes() == b"payload"

    def test_prefetch_sync_wrapper(self, tmp_path: Path):
        _write_tile(tmp_path, 10, 1, 1, make_grid())
        _write_tile(tmp_path, 10, 1, 2, make_grid())
        backend = OZT2HFBackend(cache_dir=tmp_path)
        assert backend.prefetch_tiles([(10, 1, 1), (10, 1, 2)]) == 2
