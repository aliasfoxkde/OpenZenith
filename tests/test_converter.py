"""Tests for openzenith.converter module."""

from unittest.mock import MagicMock, patch

import numpy as np


class TestConvertTile:
    """Test convert_tile with mocked dependencies."""

    @patch("openzenith.converter.load_geotiff")
    @patch("openzenith.converter.srtm_filename_to_bounds", return_value=(28.0, 86.0, 29.0, 87.0))
    @patch("openzenith.converter.classify_terrain", return_value="mountain")
    @patch("os.path.getsize", return_value=1024000)
    @patch("builtins.open", create=True)
    def test_convert_tile_basic(self, mock_open, mock_size, mock_classify, mock_bounds, mock_load, tmp_path):
        from openzenith.converter import convert_tile

        tile = np.random.randint(0, 5000, (3601, 3601)).astype(np.int16)
        mock_load.return_value = tile

        mock_file = MagicMock()
        mock_open.return_value.__enter__ = MagicMock(return_value=mock_file)
        mock_open.return_value.__exit__ = MagicMock(return_value=False)

        result = convert_tile("/fake/N28E086.tif", str(tmp_path))

        assert result["source"] == "N28E086.tif"
        assert result["verified"] is True
        assert "output_bytes" in result
        assert result["terrain_type"] == "mountain"
        assert result["bounds"]["lat_min"] == 28.0
