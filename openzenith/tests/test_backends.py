"""Tests for OZT2 tile backends."""

from pathlib import Path
from unittest.mock import MagicMock, patch

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
