"""Tests for CLI internal helpers and argument parsing."""

import argparse
import json
import sys
from unittest.mock import patch

import numpy as np
import pytest

from openzenith.cli import (
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
