"""Tests for CLI — all commands via CliRunner-style invocation."""

import contextlib
import json
import struct
import sys
import tempfile
import types
import zlib
from pathlib import Path
from typing import ClassVar
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from openzenith.cli import (
    _filename_to_bbox,
    _latlon_to_grid_coords,
    _latlon_to_tile,
    _load_merged,
    _load_rawint16,
    _parse_zoom_levels,
    cmd_aspect,
    cmd_color_relief,
    cmd_contour,
    cmd_curvature,
    cmd_download,
    cmd_drainage_density,
    cmd_encode,
    cmd_export_cog,
    cmd_export_geotiff,
    cmd_fill_depressions,
    cmd_flow_accum,
    cmd_geojson,
    cmd_hillshade,
    cmd_info,
    cmd_ingest,
    cmd_multi_hillshade,
    cmd_planform_curvature,
    cmd_profile,
    cmd_profile_curvature,
    cmd_query,
    cmd_roughness,
    cmd_slope,
    cmd_streams,
    cmd_tiles,
    cmd_tpi,
    cmd_trace,
    cmd_tri,
    cmd_twi,
    cmd_validate,
    cmd_viewshed,
    cmd_watershed,
    main,
)
from openzenith.merged import MAGIC


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


# ─── Helpers ───────────────────────────────────────────────────────────────────


def _mock_grid():
    """Return a small mock elevation grid dict used by many cmd_* functions."""
    return {
        "grid": np.random.rand(20, 20).astype(np.float32) * 1000,
        "center_lat": 40.0,
        "center_lon": -74.0,
        "center_row": 10,
        "center_col": 10,
        "cell_size_deg": 0.001,
        "nodata": -32768.0,
    }


def _mock_args(**kwargs):
    """Build a mock argparse.Namespace with defaults for terrain commands."""
    defaults = {"lat": 40.0, "lon": -74.0, "radius": 10, "output": None, "zoom": None}
    merged = {**defaults, **kwargs}
    return MagicMock(**merged)


# ─── download ───────────────────────────────────────────────────────────────────


class TestCmdDownload:
    """Tests for cmd_download."""

    def test_unknown_region_exits(self):
        """Unknown region name causes sys.exit via print and sys.exit."""
        args = _mock_args(
            region="invalid_region_name_xyz", bbox=None, zoom_levels=None, cache_dir=None
        )
        # sys.exit is not mocked here so it actually exits
        with pytest.raises(SystemExit) as exc_info:
            cmd_download(args)
        assert exc_info.value.code == 1

    def test_valid_region_sets_bbox(self):
        """Valid region name sets bbox and proceeds to download estimate."""
        args = _mock_args(region="europe", bbox=None, zoom_levels=None, cache_dir=None)
        # load_tiles is imported inside cmd_download from openzenith.elevation
        with (
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/fake/cache"
            mock_count.return_value = {7: 100, 8: 200}
            mock_rglob.return_value = []
            cmd_download(args)
            mock_load.assert_called()

    def test_bbox_parse_error_exits(self):
        """Malformed bbox causes ValueError from float() conversion."""
        args = _mock_args(region=None, bbox="not_a_bbox", zoom_levels=None, cache_dir=None)
        # The code calls float() on the bbox parts, which raises ValueError
        # for non-numeric strings before ever reaching the length check
        with pytest.raises(ValueError):
            cmd_download(args)

    def test_download_with_zoom_levels(self):
        """Download with --zoom-levels parses correctly."""
        args = _mock_args(region=None, bbox="34,-25,72,45", zoom_levels="5-8", cache_dir=None)
        with (
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/fake/cache"
            mock_count.return_value = {5: 10, 6: 20}
            mock_rglob.return_value = []
            cmd_download(args)
            mock_load.assert_called_once()

    def test_download_with_cache_dir(self):
        """Download with explicit --cache-dir uses that path."""
        args = _mock_args(
            region=None, bbox="34,-25,72,45", zoom_levels=None, cache_dir="/tmp/test-cache"
        )
        with (
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/tmp/test-cache"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_download(args)
            call_kwargs = mock_load.call_args
            assert call_kwargs[1]["cache_dir"] == "/tmp/test-cache"


class TestDownloadParser:
    """Test that download subcommand parses its arguments."""

    def _run(self, argv):
        with (
            patch.object(sys, "argv", ["openzenith", *argv]),
            contextlib.suppress(SystemExit),
        ):
            main()

    def _run_with_mocks(self, argv):
        """Run with network calls mocked."""
        with (
            patch.object(sys, "argv", ["openzenith", *argv]),
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            main()

    def test_download_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "download", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_download_region(self):
        self._run_with_mocks(["download", "--region", "europe"])

    def test_download_bbox(self):
        self._run_with_mocks(["download", "--bbox", "34,-25,72,45"])

    def test_download_zoom_levels(self):
        self._run_with_mocks(["download", "--bbox", "34,-25,72,45", "--zoom-levels", "0-5"])

    def test_download_cache_dir(self):
        self._run_with_mocks(["download", "--region", "europe", "--cache-dir", "/tmp/oz-cache"])


# ─── query ─────────────────────────────────────────────────────────────────────


class TestCmdQuery:
    """Tests for cmd_query."""

    def test_query_single_point(self):
        """Query with --lat --lon prints elevation."""
        args = _mock_args(lat=40.7128, lon=-74.0060)
        with patch("openzenith.elevation.get_elevation", return_value=10.5):
            cmd_query(args)
            # If it gets here without error, the mock worked

    def test_query_missing_lat_or_lon_exits(self):
        """Query without lat/lon exits with error."""
        args = MagicMock(lat=None, lon=-74.0, batch=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_query(args)
        assert exc_info.value.code == 1

    def test_query_batch(self):
        """Query with --batch calls batch API."""
        args = MagicMock(lat=None, lon=None, batch="40.7,-74.0 41.0,-73.5")
        with patch("openzenith.elevation.get_elevation_batch", return_value=[10.5, 25.0]):
            cmd_query(args)


class TestQueryParser:
    """Test query subcommand."""

    def test_query_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "query", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_query_lat_lon(self):
        with (
            patch("openzenith.elevation.get_elevation", return_value=10.5),
            patch.object(sys, "argv", ["openzenith", "query", "--lat", "40.7", "--lon", "-74.0"]),
        ):
            main()

    def test_query_batch(self):
        with (
            patch("openzenith.elevation.get_elevation_batch", return_value=[10.5]),
            patch.object(sys, "argv", ["openzenith", "query", "--batch", "40.7,-74.0"]),
        ):
            main()


# ─── trace ─────────────────────────────────────────────────────────────────────


class TestCmdTrace:
    """Tests for cmd_trace."""

    def test_trace_success(self):
        """Trace with valid coordinates traces downstream."""
        args = MagicMock(
            lat=40.7,
            lon=-74.0,
            max_steps=1000,
            output=None,
        )
        mock_result = {
            "total_distance": 12.5,
            "steps": 100,
            "start": (40.7, -74.0),
            "start_elev": 100.0,
            "end": (40.0, -74.5),
            "end_elev": 5.0,
        }
        with patch("openzenith.tracing.trace_downstream", return_value=mock_result):
            cmd_trace(args)

    def test_trace_no_result(self):
        """Trace returns None for ocean points."""
        args = MagicMock(lat=0.0, lon=0.0, max_steps=1000, output=None)
        with patch("openzenith.tracing.trace_downstream", return_value=None):
            cmd_trace(args)

    def test_trace_missing_coords_exits(self):
        """Trace without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_trace(args)
        assert exc_info.value.code == 1

    def test_trace_with_output_file(self):
        """Trace with --output writes JSON."""
        args = MagicMock(lat=40.7, lon=-74.0, max_steps=1000, output="/tmp/trace_out.json")
        mock_result = {
            "total_distance": 12.5,
            "steps": 100,
            "start": (40.7, -74.0),
            "start_elev": 100.0,
            "end": (40.0, -74.5),
            "end_elev": 5.0,
        }
        with (
            patch("openzenith.tracing.trace_downstream", return_value=mock_result),
            tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f,
        ):
            args.output = f.name
            cmd_trace(args)
            with Path(f.name).open() as fp:
                data = json.load(fp)
            assert data["total_distance"] == 12.5
            Path(f.name).unlink()


class TestTraceParser:
    """Test trace subcommand."""

    def test_trace_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "trace", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_trace_requires_lat_lon(self):
        with pytest.raises(SystemExit), patch.object(sys, "argv", ["openzenith", "trace"]):
            main()


# ─── watershed ─────────────────────────────────────────────────────────────────


class TestCmdWatershed:
    """Tests for cmd_watershed."""

    def test_watershed_success(self):
        """Watershed with valid coords delineates successfully."""
        args = MagicMock(lat=40.7, lon=-74.0, output=None)
        mock_result = {"area_km2": 150.0, "pixels": 5000, "min_elev": 10.0, "max_elev": 500.0}
        with patch("openzenith.hydrology.delineate_watershed", return_value=mock_result):
            cmd_watershed(args)

    def test_watershed_no_result(self):
        """Watershed returns None for ocean points."""
        args = MagicMock(lat=0.0, lon=0.0, output=None)
        with patch("openzenith.hydrology.delineate_watershed", return_value=None):
            cmd_watershed(args)

    def test_watershed_missing_coords_exits(self):
        """Watershed without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_watershed(args)
        assert exc_info.value.code == 1

    def test_watershed_with_output_file(self):
        """Watershed with --output writes JSON."""
        args = MagicMock(lat=40.7, lon=-74.0, output="/tmp/watershed_out.json")
        mock_result = {"area_km2": 150.0, "pixels": 5000, "min_elev": 10.0, "max_elev": 500.0}
        with (
            patch("openzenith.hydrology.delineate_watershed", return_value=mock_result),
            tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f,
        ):
            args.output = f.name
            cmd_watershed(args)
            with Path(f.name).open() as fp:
                data = json.load(fp)
            assert data["area_km2"] == 150.0
            Path(f.name).unlink()


class TestWatershedParser:
    """Test watershed subcommand."""

    def test_watershed_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "watershed", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_watershed_requires_lat_lon(self):
        with (
            pytest.raises(SystemExit),
            patch.object(sys, "argv", ["openzenith", "watershed"]),
        ):
            main()


# ─── info ──────────────────────────────────────────────────────────────────────


class TestCmdInfo:
    """Tests for cmd_info."""

    def test_info_runs(self):
        """Info command runs without error."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=False):
            cmd_info(args)

    def test_info_with_cache(self):
        """Info with existing cache directory shows tile count."""
        args = MagicMock()
        with (
            patch("pathlib.Path.exists", return_value=True),
            patch("openzenith.elevation.get_tile_count", return_value={7: 100, 8: 200}),
        ):
            cmd_info(args)

    def test_info_api_online(self):
        """Info shows API status when online."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=False), patch("requests.get") as mock_get:
            mock_response = MagicMock(status_code=200)
            mock_get.return_value = mock_response
            cmd_info(args)

    def test_info_api_offline(self):
        """Info shows offline when API unreachable."""
        args = MagicMock()
        with (
            patch("pathlib.Path.exists", return_value=False),
            patch("requests.get", side_effect=OSError("network error")),
        ):
            cmd_info(args)


class TestInfoParser:
    """Test info subcommand."""

    def test_info_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "info", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_info_command(self):
        with patch.object(sys, "argv", ["openzenith", "info"]):
            main()


# ─── slope ─────────────────────────────────────────────────────────────────────


class TestCmdSlope:
    """Tests for cmd_slope."""

    def test_slope_success(self):
        """Slope command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_slope(args)

    def test_slope_missing_coords_exits(self):
        """Slope without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_slope(args)
        assert exc_info.value.code == 1

    def test_slope_with_output(self):
        """Slope with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_slope(args)
            Path(f.name).unlink()


class TestSlopeParser:
    """Test slope subcommand."""

    def test_slope_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "slope", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_slope_requires_lat_lon(self):
        with pytest.raises(SystemExit), patch.object(sys, "argv", ["openzenith", "slope"]):
            main()


# ─── hillshade ─────────────────────────────────────────────────────────────────


class TestCmdHillshade:
    """Tests for cmd_hillshade."""

    def test_hillshade_success(self):
        """Hillshade command runs with mocked grid."""
        args = MagicMock(
            lat=40.0, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None
        )
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_hillshade(args)

    def test_hillshade_missing_coords_exits(self):
        """Hillshade without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_hillshade(args)
        assert exc_info.value.code == 1

    def test_hillshade_with_output(self):
        """Hillshade with --output saves array via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(
                lat=40.0, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=f.name
            )
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_hillshade(args)
            Path(f.name).unlink()


class TestHillshadeParser:
    """Test hillshade subcommand."""

    def test_hillshade_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "hillshade", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── viewshed ──────────────────────────────────────────────────────────────────


class TestCmdViewshed:
    """Tests for cmd_viewshed."""

    def test_viewshed_success(self):
        """Viewshed command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, height=10.0, max_dist=500, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_viewshed(args)

    def test_viewshed_missing_coords_exits(self):
        """Viewshed without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_viewshed(args)
        assert exc_info.value.code == 1

    def test_viewshed_with_output(self):
        """Viewshed with --output saves image via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(
                lat=40.0, lon=-74.0, radius=5, height=1.75, max_dist=None, output=f.name
            )
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_viewshed(args)
            Path(f.name).unlink()


class TestViewshedParser:
    """Test viewshed subcommand."""

    def test_viewshed_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "viewshed", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_viewshed_requires_lat_lon(self):
        with (
            pytest.raises(SystemExit),
            patch.object(sys, "argv", ["openzenith", "viewshed"]),
        ):
            main()


# ─── profile ───────────────────────────────────────────────────────────────────


class TestCmdProfile:
    """Tests for cmd_profile."""

    def test_profile_success(self):
        """Profile command runs with mocked grid."""
        args = MagicMock(
            lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=50, output=None
        )
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_profile(args)

    def test_profile_empty_result(self):
        """Profile handles empty result gracefully."""
        args = MagicMock(
            lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=50, output=None
        )
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.profile", return_value=[]),
        ):
            cmd_profile(args)  # Should not raise

    def test_profile_with_csv_output(self):
        """Profile with .csv output writes CSV file."""
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
            args = MagicMock(
                lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=10, output=f.name
            )
            mock_grid = _mock_grid()
            with (
                patch("openzenith.elevation.load_elevation_grid", return_value=mock_grid),
                patch(
                    "openzenith.terrain.profile",
                    return_value=[
                        {"distance_m": 0.0, "elevation": 100.0},
                        {"distance_m": 1000.0, "elevation": 110.0},
                    ],
                ),
            ):
                cmd_profile(args)
            Path(f.name).unlink()


class TestProfileParser:
    """Test profile subcommand."""

    def test_profile_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "profile", "--help"]),
        ):
            main()
        assert exc.value.code == 0

    def test_profile_requires_all_coords(self):
        with (
            pytest.raises(SystemExit),
            patch.object(sys, "argv", ["openzenith", "profile", "--lat1", "40.0"]),
        ):
            main()


# ─── aspect ────────────────────────────────────────────────────────────────────


class TestCmdAspect:
    """Tests for cmd_aspect."""

    def test_aspect_success(self):
        """Aspect command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_aspect(args)

    def test_aspect_with_output(self):
        """Aspect with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_aspect(args)
            Path(f.name).unlink()


class TestAspectParser:
    """Test aspect subcommand."""

    def test_aspect_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "aspect", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── twi ───────────────────────────────────────────────────────────────────────


class TestCmdTwi:
    """Tests for cmd_twi."""

    def test_twi_success(self):
        """Twi command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_twi(args)

    def test_twi_with_output(self):
        """Twi with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_twi(args)
            Path(f.name).unlink()


class TestTwiParser:
    """Test twi subcommand."""

    def test_twi_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "twi", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── tpi ───────────────────────────────────────────────────────────────────────


class TestCmdTpi:
    """Tests for cmd_tpi."""

    def test_tpi_success(self):
        """Tpi command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_tpi(args)

    def test_tpi_with_output(self):
        """Tpi with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_tpi(args)
            Path(f.name).unlink()


# ─── roughness ─────────────────────────────────────────────────────────────────


class TestCmdRoughness:
    """Tests for cmd_roughness."""

    def test_roughness_success(self):
        """Roughness command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_roughness(args)

    def test_roughness_with_output(self):
        """Roughness with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_roughness(args)
            Path(f.name).unlink()


# ─── curvature ─────────────────────────────────────────────────────────────────


class TestCmdCurvature:
    """Tests for cmd_curvature."""

    def test_curvature_success(self):
        """Curvature command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_curvature(args)

    def test_curvature_with_output(self):
        """Curvature with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_curvature(args)
            Path(f.name).unlink()


# ─── tiles ─────────────────────────────────────────────────────────────────────


class TestCmdTiles:
    """Tests for cmd_tiles."""

    def test_tiles_unknown_region_exits(self):
        """Tiles with unknown region exits."""
        args = MagicMock(
            bbox=None,
            region="invalid_region_xyz",
            lat=None,
            lon=None,
            radius=0.5,
            zoom=None,
            cache_dir=None,
            force=False,
        )
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 1

    def test_tiles_invalid_bbox_exits(self):
        """Tiles with malformed bbox raises ValueError."""
        args = MagicMock(
            bbox="not_valid",
            region=None,
            lat=None,
            lon=None,
            radius=0.5,
            zoom=None,
            cache_dir=None,
            force=False,
        )
        # float() fails on non-numeric string before the length check
        with pytest.raises(ValueError):
            cmd_tiles(args)

    def test_tiles_no_bbox_no_region_exits(self):
        """Tiles without bbox/region/latlon exits."""
        args = MagicMock(
            bbox=None,
            region=None,
            lat=None,
            lon=None,
            radius=0.5,
            zoom=None,
            cache_dir=None,
            force=False,
        )
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 1

    def test_tiles_large_download_blocked_without_force(self):
        """Tiles blocks large downloads without --force."""
        args = MagicMock(
            bbox="34,-25,72,45",
            region=None,
            lat=None,
            lon=None,
            radius=0.5,
            zoom="0-15",
            cache_dir=None,
            force=False,
        )
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 0

    def test_tiles_with_region(self):
        """Tiles with --region works."""
        args = MagicMock(
            bbox=None,
            region="europe",
            lat=None,
            lon=None,
            radius=0.5,
            zoom=None,
            cache_dir=None,
            force=False,
        )
        with (
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_tiles(args)

    def test_tiles_with_latlon(self):
        """Tiles with --lat --lon uses that as center."""
        args = MagicMock(
            bbox=None,
            region=None,
            lat=40.7,
            lon=-74.0,
            radius=0.5,
            zoom=None,
            cache_dir=None,
            force=False,
        )
        with (
            patch("openzenith.elevation.load_tiles") as mock_load,
            patch("openzenith.elevation.get_tile_count") as mock_count,
            patch("pathlib.Path.rglob") as mock_rglob,
        ):
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_tiles(args)


class TestTilesParser:
    """Test tiles subcommand."""

    def test_tiles_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "tiles", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── encode ─────────────────────────────────────────────────────────────────────


class TestCmdEncode:
    """Tests for cmd_encode."""

    def test_encode_file_not_found(self):
        """Encode with non-existent input exits."""
        args = MagicMock(
            input="/nonexistent/file.tif",
            output="/tmp/out.ozt2",
            format="auto",
            max_rmse=1.0,
            bits=None,
            predictor="gradient",
            validate=False,
            quiet=True,
        )
        with pytest.raises(SystemExit) as exc_info:
            cmd_encode(args)
        assert exc_info.value.code == 1

    def test_encode_single_geotiff(self):
        """Encode a single GeoTIFF file."""
        import rasterio
        from rasterio.transform import from_bounds

        with tempfile.TemporaryDirectory() as tmpdir:
            tif_path = Path(tmpdir) / "test.tif"
            out_path = Path(tmpdir) / "test.ozt2"

            # Create a small valid GeoTIFF
            data = np.random.randint(0, 3000, size=(30, 30), dtype=np.int16)
            transform = from_bounds(-74.1, 39.9, -73.9, 40.1, 30, 30)
            with rasterio.open(
                tif_path,
                "w",
                driver="GTiff",
                height=30,
                width=30,
                count=1,
                dtype=np.int16,
                transform=transform,
            ) as dst:
                dst.write(data, 1)

            args = MagicMock(
                input=str(tif_path),
                output=str(out_path),
                format="auto",
                max_rmse=1.0,
                bits=None,
                predictor="gradient",
                validate=False,
                quiet=True,
            )
            cmd_encode(args)
            assert out_path.exists()


class TestEncodeParser:
    """Test encode subcommand."""

    def test_encode_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "encode", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── fill-depressions ─────────────────────────────────────────────────────────


class TestCmdFillDepressions:
    """Tests for cmd_fill_depressions."""

    def test_fill_depressions_success(self):
        """fill-depressions runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_fill_depressions(args)

    def test_fill_depressions_with_output(self):
        """fill-depressions with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_fill_depressions(args)
            Path(f.name).unlink()


class TestFillDepressionsParser:
    """Test fill-depressions subcommand."""

    def test_fill_depressions_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "fill-depressions", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── flow-accum ────────────────────────────────────────────────────────────────


class TestCmdFlowAccum:
    """Tests for cmd_flow_accum."""

    def test_flow_accum_success(self):
        """flow-accum runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_flow_accum(args)

    def test_flow_accum_with_output(self):
        """flow-accum with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_flow_accum(args)
            Path(f.name).unlink()


class TestFlowAccumParser:
    """Test flow-accum subcommand."""

    def test_flow_accum_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "flow-accum", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── streams ───────────────────────────────────────────────────────────────────


class TestCmdStreams:
    """Tests for cmd_streams."""

    def test_streams_success(self):
        """Streams runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, threshold=100, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_streams(args)

    def test_streams_with_output(self):
        """Streams with --output saves image via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, threshold=100, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_streams(args)
            Path(f.name).unlink()


class TestStreamsParser:
    """Test streams subcommand."""

    def test_streams_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "streams", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── export-geotiff ────────────────────────────────────────────────────────────


class TestCmdExportGeotiff:
    """Tests for cmd_export_geotiff."""

    def test_export_geotiff_success(self):
        """export-geotiff runs with mocked grid."""
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_export_geotiff(args)
            Path(f.name).unlink()


class TestExportGeotiffParser:
    """Test export-geotiff subcommand."""

    def test_export_geotiff_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "export-geotiff", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── export-cog ───────────────────────────────────────────────────────────────


class TestCmdExportCog:
    """Tests for cmd_export_cog."""

    def test_export_cog_success(self):
        """export-cog runs with mocked grid."""
        with tempfile.NamedTemporaryFile(suffix="_cog.tif", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_export_cog(args)
            Path(f.name).unlink()


# ─── tri ───────────────────────────────────────────────────────────────────────


class TestCmdTri:
    """Tests for cmd_tri."""

    def test_tri_success(self):
        """Tri runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_tri(args)

    def test_tri_with_output(self):
        """Tri with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_tri(args)
            Path(f.name).unlink()


# ─── profile-curvature ─────────────────────────────────────────────────────────


class TestCmdProfileCurvature:
    """Tests for cmd_profile_curvature."""

    def test_profile_curvature_success(self):
        """profile-curvature runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_profile_curvature(args)


# ─── planform-curvature ───────────────────────────────────────────────────────


class TestCmdPlanformCurvature:
    """Tests for cmd_planform_curvature."""

    def test_planform_curvature_success(self):
        """planform-curvature runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_planform_curvature(args)


# ─── multi-hillshade ──────────────────────────────────────────────────────────


class TestCmdMultiHillshade:
    """Tests for cmd_multi_hillshade."""

    def test_multi_hillshade_success(self):
        """multi-hillshade runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, z_factor=3.0, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_multi_hillshade(args)

    def test_multi_hillshade_with_output(self):
        """multi-hillshade with --output saves image via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, z_factor=3.0, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_multi_hillshade(args)
            Path(f.name).unlink()


# ─── color-relief ─────────────────────────────────────────────────────────────


class TestCmdColorRelief:
    """Tests for cmd_color_relief."""

    def test_color_relief_success(self):
        """color-relief runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_color_relief(args)


# ─── contour ───────────────────────────────────────────────────────────────────


class TestCmdContour:
    """Tests for cmd_contour."""

    def test_contour_success(self):
        """Contour runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, interval=100.0, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_contour(args)

    def test_contour_with_output(self):
        """Contour with --output saves GeoJSON."""
        with tempfile.NamedTemporaryFile(suffix=".geojson", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, interval=100.0, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_contour(args)
            Path(f.name).unlink()


class TestContourParser:
    """Test contour subcommand."""

    def test_contour_help(self):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", "contour", "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── geojson ───────────────────────────────────────────────────────────────────


class TestCmdGeojson:
    """Tests for cmd_geojson."""

    def test_geojson_success(self):
        """Geojson runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, kind="elevation", name=None, output=None)
        mock_geojson_result = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                    "properties": {"elevation": 100},
                }
            ],
        }
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.export.grid_to_geojson", return_value=mock_geojson_result),
        ):
            cmd_geojson(args)

    def test_geojson_with_output(self):
        """Geojson with --output saves GeoJSON."""
        with tempfile.NamedTemporaryFile(suffix=".geojson", delete=False) as f:
            args = MagicMock(
                lat=40.0, lon=-74.0, radius=5, kind="elevation", name=None, output=f.name
            )
            mock_geojson_result = {
                "type": "FeatureCollection",
                "features": [],
            }
            with (
                patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
                patch("openzenith.export.grid_to_geojson", return_value=mock_geojson_result),
            ):
                cmd_geojson(args)
            Path(f.name).unlink()


# ─── Missing required args error cases ────────────────────────────────────────


class TestMissingRequiredArgs:
    """Test that commands with required lat/lon exit when those args are missing."""

    def _assert_exits(self, cmd_func, args):
        with pytest.raises(SystemExit) as exc_info:
            cmd_func(args)
        assert exc_info.value.code == 1

    def test_slope_missing_lat(self):
        self._assert_exits(cmd_slope, MagicMock(lat=None, lon=-74.0))

    def test_slope_missing_lon(self):
        self._assert_exits(cmd_slope, MagicMock(lat=40.0, lon=None))

    def test_hillshade_missing_lat(self):
        self._assert_exits(
            cmd_hillshade,
            MagicMock(
                lat=None, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None
            ),
        )

    def test_hillshade_missing_lon(self):
        self._assert_exits(
            cmd_hillshade,
            MagicMock(
                lat=40.0, lon=None, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None
            ),
        )

    def test_viewshed_missing_lat(self):
        self._assert_exits(
            cmd_viewshed,
            MagicMock(lat=None, lon=-74.0, radius=5, height=10.0, max_dist=500, output=None),
        )

    def test_viewshed_missing_lon(self):
        self._assert_exits(
            cmd_viewshed,
            MagicMock(lat=40.0, lon=None, radius=5, height=10.0, max_dist=500, output=None),
        )

    def test_trace_missing_lat(self):
        self._assert_exits(cmd_trace, MagicMock(lat=None, lon=-74.0, max_steps=1000, output=None))

    def test_trace_missing_lon(self):
        self._assert_exits(cmd_trace, MagicMock(lat=40.0, lon=None, max_steps=1000, output=None))

    def test_watershed_missing_lat(self):
        self._assert_exits(cmd_watershed, MagicMock(lat=None, lon=-74.0, output=None))

    def test_watershed_missing_lon(self):
        self._assert_exits(cmd_watershed, MagicMock(lat=40.0, lon=None, output=None))


# ─── Help output tests ─────────────────────────────────────────────────────────


class TestHelpOutputs:
    """Test that --help works for all commands."""

    commands: ClassVar[list[str]] = [
        "download",
        "query",
        "trace",
        "watershed",
        "info",
        "validate",
        "slope",
        "hillshade",
        "viewshed",
        "aspect",
        "tpi",
        "roughness",
        "curvature",
        "profile",
        "contour",
        "geojson",
        "tiles",
        "fill-depressions",
        "flow-accum",
        "streams",
        "export-geotiff",
        "export-cog",
        "tri",
        "profile-curvature",
        "planform-curvature",
        "drainage-density",
        "multi-hillshade",
        "color-relief",
    ]

    @pytest.mark.parametrize("cmd", commands)
    def test_help(self, cmd):
        with (
            pytest.raises(SystemExit) as exc,
            patch.object(sys, "argv", ["openzenith", cmd, "--help"]),
        ):
            main()
        assert exc.value.code == 0


# ─── Unrecognized subcommand ───────────────────────────────────────────────────


class TestUnrecognizedCommand:
    """Test behavior when an unrecognized command is given."""

    def test_unrecognized_command(self):
        """Unrecognized command causes argparse to exit with status 2."""
        with (
            pytest.raises(SystemExit) as exc_info,
            patch.object(sys, "argv", ["openzenith", "nonexistent-cmd"]),
        ):
            main()
        assert exc_info.value.code == 2


# ─── Loader helpers (encode/ingest paths) ─────────────────────────────────────

NODATA = -32768


def _write_merged(path: Path, fill_by_chunk: dict, ocean: set | None = None) -> None:
    """Write a synthetic OZCHNK01 file.

    Args:
        path: Destination file.
        fill_by_chunk: {(row, col): elevation} for populated chunks. Every
            (row, col) in the grid must appear here or in ``ocean``.
        ocean: Chunks stored empty (size 0) — decode as nodata.

    """
    rows = max(r for r, _c in fill_by_chunk) + 1
    cols = max(c for _r, c in fill_by_chunk) + 1
    ocean = ocean or set()

    index = b""
    body = b""
    offset = 12 + rows * cols * 8
    for r in range(rows):
        for c in range(cols):
            if (r, c) in ocean:
                index += struct.pack("<II", offset, 0)
                continue
            # Horizontal differencing: first column absolute, rest zeros
            raw = np.zeros((256, 256), dtype=np.int16)
            raw[:, 0] = fill_by_chunk[(r, c)]
            payload = zlib.compress(raw.tobytes())
            index += struct.pack("<II", offset, len(payload))
            body += payload
            offset += len(payload)

    header = MAGIC + struct.pack("<H", 1) + bytes([rows, cols])
    path.write_bytes(header + index + body)


class TestLoadRawInt16:
    """_load_rawint16 square-dimension detection."""

    def test_square_file_loads(self, tmp_path: Path):
        p = tmp_path / "dem.raw"
        data = np.arange(16, dtype=np.int16)
        p.write_bytes(data.tobytes())
        grid = _load_rawint16(str(p))
        assert grid.shape == (4, 4)
        assert grid.ravel().tolist() == data.tolist()

    def test_non_square_size_raises(self, tmp_path: Path):
        p = tmp_path / "dem.raw"
        p.write_bytes(np.arange(17, dtype=np.int16).tobytes())
        with pytest.raises(ValueError, match="not a perfect square"):
            _load_rawint16(str(p))


class TestFilenameToBbox:
    """SRTM and Copernicus filename parsing."""

    def test_srtm_north_east(self):
        assert _filename_to_bbox("N40W075.tif") == {"bbox": [-76, 40, -75, 41]}

    def test_srtm_south_west_offsets_by_one(self):
        assert _filename_to_bbox("S10W170.tif") == {"bbox": [-171, -11, -170, -10]}

    def test_copernicus_style(self):
        name = "Copernicus_DSM_COG_10_N22_00_E016_00_DEM.tif"
        assert _filename_to_bbox(name) == {"bbox": [16, 22, 17, 23]}

    def test_unrecognized_returns_none(self):
        assert _filename_to_bbox("readme.txt") is None


class TestLoadMerged:
    """_load_merged assembles 256x256 chunks; ocean chunks stay nodata."""

    def test_assembles_chunks_and_crops(self, tmp_path: Path):
        p = tmp_path / "N00E000.merged"
        _write_merged(p, {(0, 0): 100, (0, 1): 110, (1, 0): 120, (1, 1): 130})
        tile = _load_merged(str(p))
        assert tile.shape == (512, 512)
        assert tile[0, 0] == 100
        assert tile[5, 300] == 110  # chunk (0, 1)
        assert tile[300, 5] == 120  # chunk (1, 0)
        assert tile[300, 300] == 130

    def test_ocean_chunks_become_nodata(self, tmp_path: Path):
        p = tmp_path / "N00E000.merged"
        _write_merged(p, {(0, 0): 100, (0, 1): 110, (1, 0): 120, (1, 1): 130}, ocean={(1, 1)})
        tile = _load_merged(str(p))
        assert tile[300, 300] == NODATA
        assert tile[0, 0] == 100

    def test_full_size_tile_crops_to_3601(self, tmp_path: Path):
        """15x15 chunks assemble on the 3840 canvas and crop to 3601²."""
        p = tmp_path / "N00E000.merged"
        fills = {(r, c): 10 * r + c for r in range(15) for c in range(15)}
        _write_merged(p, fills)
        tile = _load_merged(str(p))
        assert tile.shape == (3601, 3601)
        assert tile[3600, 3600] == 10 * 14 + 14  # last valid pixel, chunk (14, 14)


# ─── Terrain commands missing output paths ────────────────────────────────────


class TestCmdDrainageDensity:
    """cmd_drainage_density: flow-accumulation density pipeline."""

    def test_computes_and_saves(self, tmp_path: Path):
        out = tmp_path / "density.npy"
        args = _mock_args(output=str(out))
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.hydrology.d8_flow_direction", return_value=np.zeros((20, 20))),
            patch("openzenith.hydrology.flow_accumulation", return_value=np.ones((20, 20))),
            patch("openzenith.terrain.drainage_density", return_value=np.full((20, 20), 2.5)),
        ):
            cmd_drainage_density(args)
        assert out.exists()

    def test_missing_grid_dependency_exits(self):
        args = _mock_args(output=None)
        with (
            patch("openzenith.elevation.load_elevation_grid", side_effect=ImportError("no hub")),
            pytest.raises(ImportError),
        ):
            cmd_drainage_density(args)


class TestImageOutputFallbacks:
    """PIL-less environments fall back to np.save for image outputs."""

    def test_multi_hillshade_falls_back_without_pillow(self, tmp_path: Path):
        out = tmp_path / "hs.npy"
        args = _mock_args(output=str(out), z_factor=1.0)
        shade = np.full((20, 20), 128, dtype=np.uint8)
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.multi_hillshade", return_value=shade),
            patch.dict(sys.modules, {"PIL": None}),
        ):
            cmd_multi_hillshade(args)
        assert np.load(out).shape == (20, 20)

    def test_color_relief_falls_back_without_pillow(self, tmp_path: Path):
        out = tmp_path / "relief.npy"
        args = _mock_args(output=str(out))
        rgba = np.zeros((20, 20, 4), dtype=np.uint8)
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.color_relief", return_value=rgba),
            patch.dict(sys.modules, {"PIL": None}),
        ):
            cmd_color_relief(args)
        assert np.load(out).shape == (20, 20, 4)

    def test_streams_falls_back_without_pillow(self, tmp_path: Path):
        out = tmp_path / "streams.npy"
        args = _mock_args(output=str(out), lat=40.0, lon=-74.0)
        streams = np.zeros((20, 20), dtype=bool)
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.hydrology.d8_flow_direction", return_value=np.zeros((20, 20))),
            patch("openzenith.hydrology.flow_accumulation", return_value=np.ones((20, 20))),
            patch("openzenith.hydrology.extract_streams", return_value=streams),
            patch.dict(sys.modules, {"PIL": None}),
        ):
            cmd_streams(args)
        assert np.load(out).shape == (20, 20)

    def test_color_relief_saves_png_with_pillow(self, tmp_path: Path):
        out = tmp_path / "relief.png"
        args = _mock_args(output=str(out))
        rgba = np.zeros((20, 20, 4), dtype=np.uint8)
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.color_relief", return_value=rgba),
        ):
            cmd_color_relief(args)
        assert out.exists()


# ─── encode ───────────────────────────────────────────────────────────────────


class TestCmdEncodePaths:
    """cmd_encode format detection, options, and directory mode."""

    def _raw(self, tmp_path: Path, name="dem.raw", side=4):
        p = tmp_path / name
        p.write_bytes((np.arange(side * side, dtype=np.int16) % 300).tobytes())
        return p

    def test_missing_input_exits(self, tmp_path: Path):
        args = _mock_args(
            input=str(tmp_path / "nope.raw"),
            output=str(tmp_path),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=True,
        )
        with pytest.raises(SystemExit) as exc:
            cmd_encode(args)
        assert exc.value.code == 1

    def test_unknown_extension_skipped_in_directory_mode(self, tmp_path: Path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "notes.txt").write_text("not a dem")
        args = _mock_args(
            input=str(tmp_path / "src"),
            output=str(tmp_path / "out"),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=True,
        )
        with pytest.raises(SystemExit) as exc:
            cmd_encode(args)
        assert exc.value.code == 1  # no DEM files found

    def test_single_raw_with_fixed_bits(self, tmp_path: Path):
        src = self._raw(tmp_path)
        out = tmp_path / "dem.ozt2"
        args = _mock_args(
            input=str(src),
            output=str(out),
            predictor="gradient",
            bits=12,
            max_rmse=1.0,
            validate=True,
            quiet=False,
        )
        cmd_encode(args)
        assert out.exists()

    def test_single_raw_auto_encode(self, tmp_path: Path):
        src = self._raw(tmp_path)
        out = tmp_path / "dem.ozt2"
        args = _mock_args(
            input=str(src),
            output=str(out),
            predictor="none",
            bits=None,
            max_rmse=1.0,
            validate=True,
            quiet=False,
        )
        cmd_encode(args)
        assert out.exists()

    def test_directory_mode_writes_summary(self, tmp_path: Path, capsys):
        src = tmp_path / "src"
        src.mkdir()
        self._raw(src, "a.raw")
        self._raw(src, "b.raw", side=8)
        args = _mock_args(
            input=str(src),
            output=str(tmp_path / "out"),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=False,
        )
        cmd_encode(args)
        outdir = tmp_path / "out"
        assert (outdir / "a.ozt2").exists()
        assert (outdir / "b.ozt2").exists()
        captured = capsys.readouterr().out
        assert "Encoded 2/2" in captured

    def test_directory_all_failures_exit(self, tmp_path: Path):
        src = tmp_path / "src"
        src.mkdir()
        (src / "bad.merged").write_bytes(b"garbage" * 4)
        args = _mock_args(
            input=str(src),
            output=str(tmp_path / "out"),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=True,
        )
        with pytest.raises(SystemExit) as exc:
            cmd_encode(args)
        assert exc.value.code == 1

    def test_merged_input_encoded(self, tmp_path: Path):
        src = tmp_path / "tile.merged"
        _write_merged(src, {(0, 0): 100, (0, 1): 110, (1, 0): 120, (1, 1): 130})
        out = tmp_path / "tile.ozt2"
        args = _mock_args(
            input=str(src),
            output=str(out),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=True,
        )
        cmd_encode(args)
        assert out.exists()


# ─── ingest ───────────────────────────────────────────────────────────────────


class TestCmdIngest:
    """cmd_ingest builds a contribution bundle with manifest."""

    def _ingest_args(self, tmp_path: Path, dataset: Path, **kw):
        defaults = {
            "dataset": str(dataset),
            "name": "test-tiles",
            "license": "CC-BY-4.0",
            "description": "test dataset",
            "source_url": "https://example.com",
            "contributor": "tester",
            "output": str(tmp_path / "bundles"),
        }
        defaults.update(kw)
        args = _mock_args(**defaults)
        args.name = defaults["name"]  # MagicMock(**name=...) is special-cased
        return args

    def test_missing_dataset_exits(self, tmp_path: Path):
        args = self._ingest_args(tmp_path, tmp_path / "missing")
        with pytest.raises(SystemExit) as exc:
            cmd_ingest(args)
        assert exc.value.code == 1

    def test_dataset_with_no_dem_files_exits(self, tmp_path: Path):
        dataset = tmp_path / "dataset"
        dataset.mkdir()
        (dataset / "README.md").write_text("no tifs here")
        args = self._ingest_args(tmp_path, dataset)
        with pytest.raises(SystemExit) as exc:
            cmd_ingest(args)
        assert exc.value.code == 1

    def test_builds_bundle_and_manifest(self, tmp_path: Path):
        dataset = tmp_path / "dataset"
        dataset.mkdir()
        _write_merged(
            dataset / "N00E000.merged", {(0, 0): 100, (0, 1): 110, (1, 0): 120, (1, 1): 130}
        )
        args = self._ingest_args(tmp_path, dataset)
        cmd_ingest(args)

        bundle = tmp_path / "bundles" / "test-tiles"
        assert (bundle / "tiles" / "N00E000.ozt2").exists()
        manifest = json.loads((bundle / "manifest.json").read_text())
        assert manifest["name"] == "test-tiles"
        assert manifest["license"] == "CC-BY-4.0"
        assert manifest["total_tiles"] == 1
        assert manifest["errors"] == 0
        tile = manifest["tiles"][0]
        assert tile["file"] == "N00E000.ozt2"
        assert tile["coverage"] == {"bbox": [0, 0, 1, 1]}
        assert tile["bits"] > 0

    def test_corrupt_file_recorded_as_error(self, tmp_path: Path):
        dataset = tmp_path / "dataset"
        dataset.mkdir()
        (dataset / "bad.merged").write_bytes(b"garbage" * 4)
        args = self._ingest_args(tmp_path, dataset)
        cmd_ingest(args)

        bundle = tmp_path / "bundles" / "test-tiles"
        manifest = json.loads((bundle / "manifest.json").read_text())
        assert manifest["total_tiles"] == 0
        assert manifest["errors"] == 1


# ─── main() dispatch ─────────────────────────────────────────────────────────


class TestMainDispatch:
    """main() builds the parser, dispatches commands, prints help bare."""

    def test_no_command_prints_help(self, capsys, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["openzenith"])
        main()
        assert "usage: openzenith" in capsys.readouterr().out

    def test_dispatches_info_command(self, monkeypatch):
        called = {}
        monkeypatch.setattr(sys, "argv", ["openzenith", "info"])
        with patch("openzenith.cli.cmd_info", side_effect=lambda a: called.update(hit=True)):
            main()
        assert called.get("hit") is True


# ─── Import guards, fallbacks, and remaining output paths (#109) ──────────────


class TestImportGuards:
    """Optional-dependency guards degrade to a clear exit(1)."""

    def test_download_without_elevation_module_exits(self):
        args = _mock_args(region="europe", bbox=None, zoom_levels=None, cache_dir=None)
        with (
            patch.dict(sys.modules, {"openzenith.elevation": None}),
            pytest.raises(SystemExit) as exc,
        ):
            cmd_download(args)
        assert exc.value.code == 1

    def test_trace_without_tracing_module_exits(self):
        with (
            patch.dict(sys.modules, {"openzenith.tracing": None}),
            pytest.raises(SystemExit) as exc,
        ):
            cmd_trace(_mock_args())
        assert exc.value.code == 1

    def test_watershed_without_hydrology_module_exits(self):
        with (
            patch.dict(sys.modules, {"openzenith.hydrology": None}),
            pytest.raises(SystemExit) as exc,
        ):
            cmd_watershed(_mock_args())
        assert exc.value.code == 1

    def test_download_rejects_wrong_part_count_bbox(self):
        args = _mock_args(region=None, bbox="1,2,3", zoom_levels=None, cache_dir=None)
        with pytest.raises(SystemExit) as exc:
            cmd_download(args)
        assert exc.value.code == 1

    def test_tiles_rejects_wrong_part_count_bbox(self):
        args = _mock_args(bbox="1,2,3", region=None, lat=None, lon=None, zoom=None)
        with pytest.raises(SystemExit) as exc:
            cmd_tiles(args)
        assert exc.value.code == 1


class TestCmdInfoAndValidate:
    """info cache-error path; validate delegates to the script."""

    def test_info_reports_unreadable_cache(self, tmp_path: Path, capsys, monkeypatch):
        cache = tmp_path / ".cache" / "openzenith-dem"
        cache.mkdir(parents=True)
        monkeypatch.setattr("pathlib.Path.home", classmethod(lambda cls: tmp_path), raising=False)
        with (
            patch("openzenith.elevation.get_tile_count", side_effect=OSError("busy")),
            patch("requests.get", side_effect=OSError("offline")),
        ):
            cmd_info(_mock_args())
        assert "could not count tiles" in capsys.readouterr().out

    def test_validate_delegates_to_script(self):
        fake = types.ModuleType("scripts.validate_elevation")
        fake.main = MagicMock()
        with patch.dict(sys.modules, {"scripts.validate_elevation": fake}):
            cmd_validate(_mock_args())
        fake.main.assert_called_once_with()


class TestImageOutputFallbacks2:
    """Remaining PIL fallbacks and array outputs."""

    def test_hillshade_falls_back_without_pillow(self, tmp_path: Path):
        out = tmp_path / "hs.npy"
        args = _mock_args(output=str(out))
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.hillshade", return_value=np.full((20, 20), 9, np.uint8)),
            patch.dict(sys.modules, {"PIL": None}),
        ):
            cmd_hillshade(args)
        assert np.load(out).shape == (20, 20)

    def test_viewshed_falls_back_without_pillow(self, tmp_path: Path):
        out = tmp_path / "vs.npy"
        args = _mock_args(output=str(out), lat=40.0, lon=-74.0)
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.viewshed", return_value=np.ones((20, 20), dtype=bool)),
            patch.dict(sys.modules, {"PIL": None}),
        ):
            cmd_viewshed(args)
        assert np.load(out).shape == (20, 20)

    def test_profile_json_output(self, tmp_path: Path):
        out = tmp_path / "profile.json"
        args = _mock_args(
            lat1=40.0, lon1=-74.0, lat2=40.01, lon2=-74.01, radius=10, samples=5, output=str(out)
        )
        profile = [{"distance_m": 0.0, "elevation": 10.0}, {"distance_m": 5.0, "elevation": 12.0}]
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch("openzenith.terrain.profile", return_value=profile),
        ):
            cmd_profile(args)
        assert json.loads(out.read_text())[0]["elevation"] == 10.0

    @pytest.mark.parametrize("cmd", ["profile_curvature", "planform_curvature"])
    def test_curvature_commands_save_output(self, tmp_path: Path, cmd: str):
        out = tmp_path / "curv.npy"
        args = _mock_args(output=str(out))
        fn = {
            "profile_curvature": cmd_profile_curvature,
            "planform_curvature": cmd_planform_curvature,
        }[cmd]
        terrain_fn = f"openzenith.terrain.{cmd}"
        with (
            patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()),
            patch(terrain_fn, return_value=np.zeros((20, 20))),
        ):
            fn(args)
        assert np.load(out).shape == (20, 20)


class TestCmdEncodeUnknownSingleFile:
    """Single-file encode of an unknown format is skipped, not fatal."""

    def test_unknown_extension_single_file(self, tmp_path: Path, capsys):
        src = tmp_path / "data.txt"
        src.write_text("not a dem")
        args = _mock_args(
            input=str(src),
            output=str(tmp_path / "out.ozt2"),
            predictor="gradient",
            bits=None,
            max_rmse=1.0,
            validate=False,
            quiet=False,
        )
        cmd_encode(args)
        assert "Unknown format" in capsys.readouterr().out
        assert not (tmp_path / "out.ozt2").exists()
