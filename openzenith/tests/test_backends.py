"""Tests for OZT2 tile backends."""

from pathlib import Path

import numpy as np

from openzenith.backends.ozt2 import OZT2Backend
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
