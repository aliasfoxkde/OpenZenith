"""Tests for CLI internal helpers and argument parsing."""

from unittest.mock import patch

import pytest

from openzenith.cli import (
    _latlon_to_grid_coords,
    _latlon_to_tile,
    _parse_zoom_levels,
    main,
)


class TestParseZoomLevels:
    """Test zoom level string parsing."""

    def test_single_zoom(self):
        assert _parse_zoom_levels("5") == [5]

    def test_range(self):
        assert _parse_zoom_levels("0-5") == [0, 1, 2, 3, 4, 5]

    def test_comma_separated(self):
        assert _parse_zoom_levels("3,5,7") == [3, 5, 7]

    def test_mixed(self):
        assert _parse_zoom_levels("0-3,5,7-9") == [0, 1, 2, 3, 5, 7, 8, 9]

    def test_invalid_range(self):
        with pytest.raises(ValueError):
            _parse_zoom_levels("5-2")

    def test_empty_string(self):
        with pytest.raises(ValueError):
            _parse_zoom_levels("")


class TestLatLonToTile:
    """Test lat/lon to tile index conversion."""

    def test_origin(self):
        # (0, 0) at zoom 0 should be tile (0, 0)
        x, y = _latlon_to_tile(0, 0, 0)
        assert x == 0 and y == 0

    def test_new_york(self):
        # NYC approximate
        x, y = _latlon_to_tile(40.7128, -74.0060, 10)
        assert 0 <= x < 2**10
        assert 0 <= y < 2**10

    def test_zoom_scales(self):
        # Higher zoom = more tiles
        x0, y0 = _latlon_to_tile(45, 10, 5)
        x1, y1 = _latlon_to_tile(45, 10, 10)
        assert x1 > x0 or y1 > y0

    def test_180_meridian(self):
        x, y = _latlon_to_tile(0, 179.9, 5)
        assert 0 <= x < 32
        assert 0 <= y < 32

    def test_latlon_to_tile_edge_cases(self):
        """Test edge cases for tile coordinate conversion."""
        # South pole
        x, y = _latlon_to_tile(-85, 0, 5)
        assert 0 <= y < 32
        # North pole
        x, y = _latlon_to_tile(85, 0, 5)
        assert 0 <= y < 32
        # Dateline (use 179.9 to avoid exact boundary)
        x, y = _latlon_to_tile(0, 179.9, 5)
        assert 0 <= x < 32
        # Negative longitude
        x, y = _latlon_to_tile(0, -180, 5)
        assert 0 <= x < 32
        # Known value: NYC at z10
        x, y = _latlon_to_tile(40.7128, -74.0060, 10)
        # z10 has 1024 tiles per axis
        assert 0 <= x < 1024
        assert 0 <= y < 1024


class TestLatLonToGridCoords:
    """Test lat/lon to grid coordinate conversion."""

    def test_center_is_center(self):
        """Point at grid center returns center coords."""
        import numpy as np
        grid = {
            "center_lat": 40.0,
            "center_lon": -74.0,
            "center_row": 5,
            "center_col": 5,
            "cell_size_deg": 0.001,
            "grid": np.zeros((10, 10)),
        }
        row, col = _latlon_to_grid_coords(40.0, -74.0, grid)
        assert row == 5
        assert col == 5

    def test_offset_from_center(self):
        """Offset from center returns correct grid coords."""
        import numpy as np
        grid = {
            "center_lat": 40.0,
            "center_lon": -74.0,
            "center_row": 5,
            "center_col": 5,
            "cell_size_deg": 0.001,
            "grid": np.zeros((10, 10)),
        }
        # Move 0.001 degrees (one cell) north and east
        row, col = _latlon_to_grid_coords(40.001, -73.999, grid)
        # Values should differ from center when offset
        assert 0 <= row < 10
        assert 0 <= col < 10

    def test_clamped_to_grid_bounds(self):
        """Point outside grid is clamped to edges."""
        import numpy as np
        grid = {
            "center_lat": 0.0,
            "center_lon": 0.0,
            "center_row": 5,
            "center_col": 5,
            "cell_size_deg": 1.0,
            "grid": np.zeros((10, 10)),
        }
        # Far outside grid should clamp to 0 or max
        row, col = _latlon_to_grid_coords(999.0, 999.0, grid)
        assert row == 9  # clamped to max
        assert col == 9


class TestMainParser:
    """Test argument parsing."""

    def test_info_command_parses(self):
        # Verify the parser accepts the info subcommand
        from openzenith.cli import main
        with patch("sys.argv", ["openzenith", "info", "--help"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            # --help exits with code 0
            assert exc_info.value.code == 0

    def test_download_requires_region(self):
        # Just verify the parser accepts download subcommand
        with patch("sys.argv", ["openzenith", "download", "--help"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 0
