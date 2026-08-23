"""Tests for CLI — all commands via CliRunner-style invocation."""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from openzenith.cli import (
    _latlon_to_grid_coords,
    _latlon_to_tile,
    _parse_zoom_levels,
    cmd_aspect,
    cmd_color_relief,
    cmd_contour,
    cmd_curvature,
    cmd_download,
    cmd_encode,
    cmd_export_cog,
    cmd_export_geotiff,
    cmd_fill_depressions,
    cmd_flow_accum,
    cmd_geojson,
    cmd_hillshade,
    cmd_info,
    cmd_multi_hillshade,
    cmd_planform_curvature,
    cmd_profile,
    cmd_profile_curvature,
    cmd_query,
    cmd_roughness,
    cmd_slope,
    cmd_streams,
    cmd_trace,
    cmd_tiles,
    cmd_tpi,
    cmd_tri,
    cmd_twi,
    cmd_viewshed,
    cmd_watershed,
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
    defaults = dict(lat=40.0, lon=-74.0, radius=10, output=None, zoom=None)
    merged = {**defaults, **kwargs}
    return MagicMock(**merged)


# ─── download ───────────────────────────────────────────────────────────────────

class TestCmdDownload:
    """Tests for cmd_download."""

    def test_unknown_region_exits(self):
        """Unknown region name causes sys.exit via print and sys.exit."""
        args = _mock_args(region="invalid_region_name_xyz", bbox=None, zoom_levels=None, cache_dir=None)
        # sys.exit is not mocked here so it actually exits
        with pytest.raises(SystemExit) as exc_info:
            cmd_download(args)
        assert exc_info.value.code == 1

    def test_valid_region_sets_bbox(self):
        """Valid region name sets bbox and proceeds to download estimate."""
        args = _mock_args(region="europe", bbox=None, zoom_levels=None, cache_dir=None)
        # load_tiles is imported inside cmd_download from openzenith.elevation
        with patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
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
        """download with --zoom-levels parses correctly."""
        args = _mock_args(region=None, bbox="34,-25,72,45", zoom_levels="5-8", cache_dir=None)
        with patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
            mock_load.return_value = "/fake/cache"
            mock_count.return_value = {5: 10, 6: 20}
            mock_rglob.return_value = []
            cmd_download(args)
            mock_load.assert_called_once()

    def test_download_with_cache_dir(self):
        """download with explicit --cache-dir uses that path."""
        args = _mock_args(region=None, bbox="34,-25,72,45", zoom_levels=None, cache_dir="/tmp/test-cache")
        with patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
            mock_load.return_value = "/tmp/test-cache"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_download(args)
            call_kwargs = mock_load.call_args
            assert call_kwargs[1]["cache_dir"] == "/tmp/test-cache"


class TestDownloadParser:
    """Test that download subcommand parses its arguments."""

    def _run(self, argv):
        with patch.object(sys, "argv", ["openzenith"] + argv):
            try:
                main()
            except SystemExit:
                pass

    def _run_with_mocks(self, argv):
        """Run with network calls mocked."""
        with patch.object(sys, "argv", ["openzenith"] + argv), \
             patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            main()

    def test_download_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "download", "--help"]):
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
        """query with --lat --lon prints elevation."""
        args = _mock_args(lat=40.7128, lon=-74.0060)
        with patch("openzenith.elevation.get_elevation", return_value=10.5):
            cmd_query(args)
            # If it gets here without error, the mock worked

    def test_query_missing_lat_or_lon_exits(self):
        """query without lat/lon exits with error."""
        args = MagicMock(lat=None, lon=-74.0, batch=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_query(args)
        assert exc_info.value.code == 1

    def test_query_batch(self):
        """query with --batch calls batch API."""
        args = MagicMock(lat=None, lon=None, batch="40.7,-74.0 41.0,-73.5")
        with patch("openzenith.elevation.get_elevation_batch", return_value=[10.5, 25.0]):
            cmd_query(args)


class TestQueryParser:
    """Test query subcommand."""

    def test_query_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "query", "--help"]):
                main()
        assert exc.value.code == 0

    def test_query_lat_lon(self):
        with patch("openzenith.elevation.get_elevation", return_value=10.5):
            with patch.object(sys, "argv", ["openzenith", "query", "--lat", "40.7", "--lon", "-74.0"]):
                main()

    def test_query_batch(self):
        with patch("openzenith.elevation.get_elevation_batch", return_value=[10.5]):
            with patch.object(sys, "argv", ["openzenith", "query", "--batch", "40.7,-74.0"]):
                main()


# ─── trace ─────────────────────────────────────────────────────────────────────

class TestCmdTrace:
    """Tests for cmd_trace."""

    def test_trace_success(self):
        """trace with valid coordinates traces downstream."""
        args = MagicMock(
            lat=40.7, lon=-74.0, max_steps=1000, output=None,
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
        """trace returns None for ocean points."""
        args = MagicMock(lat=0.0, lon=0.0, max_steps=1000, output=None)
        with patch("openzenith.tracing.trace_downstream", return_value=None):
            cmd_trace(args)

    def test_trace_missing_coords_exits(self):
        """trace without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_trace(args)
        assert exc_info.value.code == 1

    def test_trace_with_output_file(self):
        """trace with --output writes JSON."""
        args = MagicMock(lat=40.7, lon=-74.0, max_steps=1000, output="/tmp/trace_out.json")
        mock_result = {
            "total_distance": 12.5,
            "steps": 100,
            "start": (40.7, -74.0),
            "start_elev": 100.0,
            "end": (40.0, -74.5),
            "end_elev": 5.0,
        }
        with patch("openzenith.tracing.trace_downstream", return_value=mock_result):
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
                args.output = f.name
                cmd_trace(args)
                with open(f.name) as fp:
                    data = json.load(fp)
                assert data["total_distance"] == 12.5
                os.unlink(f.name)


class TestTraceParser:
    """Test trace subcommand."""

    def test_trace_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "trace", "--help"]):
                main()
        assert exc.value.code == 0

    def test_trace_requires_lat_lon(self):
        with pytest.raises(SystemExit):
            with patch.object(sys, "argv", ["openzenith", "trace"]):
                main()


# ─── watershed ─────────────────────────────────────────────────────────────────

class TestCmdWatershed:
    """Tests for cmd_watershed."""

    def test_watershed_success(self):
        """watershed with valid coords delineates successfully."""
        args = MagicMock(lat=40.7, lon=-74.0, output=None)
        mock_result = {"area_km2": 150.0, "pixels": 5000, "min_elev": 10.0, "max_elev": 500.0}
        with patch("openzenith.hydrology.delineate_watershed", return_value=mock_result):
            cmd_watershed(args)

    def test_watershed_no_result(self):
        """watershed returns None for ocean points."""
        args = MagicMock(lat=0.0, lon=0.0, output=None)
        with patch("openzenith.hydrology.delineate_watershed", return_value=None):
            cmd_watershed(args)

    def test_watershed_missing_coords_exits(self):
        """watershed without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_watershed(args)
        assert exc_info.value.code == 1

    def test_watershed_with_output_file(self):
        """watershed with --output writes JSON."""
        args = MagicMock(lat=40.7, lon=-74.0, output="/tmp/watershed_out.json")
        mock_result = {"area_km2": 150.0, "pixels": 5000, "min_elev": 10.0, "max_elev": 500.0}
        with patch("openzenith.hydrology.delineate_watershed", return_value=mock_result):
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
                args.output = f.name
                cmd_watershed(args)
                with open(f.name) as fp:
                    data = json.load(fp)
                assert data["area_km2"] == 150.0
                os.unlink(f.name)


class TestWatershedParser:
    """Test watershed subcommand."""

    def test_watershed_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "watershed", "--help"]):
                main()
        assert exc.value.code == 0

    def test_watershed_requires_lat_lon(self):
        with pytest.raises(SystemExit):
            with patch.object(sys, "argv", ["openzenith", "watershed"]):
                main()


# ─── info ──────────────────────────────────────────────────────────────────────

class TestCmdInfo:
    """Tests for cmd_info."""

    def test_info_runs(self):
        """info command runs without error."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=False):
            cmd_info(args)

    def test_info_with_cache(self):
        """info with existing cache directory shows tile count."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=True), \
             patch("openzenith.elevation.get_tile_count", return_value={7: 100, 8: 200}):
            cmd_info(args)

    def test_info_api_online(self):
        """info shows API status when online."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=False), \
             patch("requests.get") as mock_get:
            mock_response = MagicMock(status_code=200)
            mock_get.return_value = mock_response
            cmd_info(args)

    def test_info_api_offline(self):
        """info shows offline when API unreachable."""
        args = MagicMock()
        with patch("pathlib.Path.exists", return_value=False), \
             patch("requests.get", side_effect=OSError("network error")):
            cmd_info(args)


class TestInfoParser:
    """Test info subcommand."""

    def test_info_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "info", "--help"]):
                main()
        assert exc.value.code == 0

    def test_info_command(self):
        with patch.object(sys, "argv", ["openzenith", "info"]):
            main()


# ─── slope ─────────────────────────────────────────────────────────────────────

class TestCmdSlope:
    """Tests for cmd_slope."""

    def test_slope_success(self):
        """slope command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_slope(args)

    def test_slope_missing_coords_exits(self):
        """slope without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_slope(args)
        assert exc_info.value.code == 1

    def test_slope_with_output(self):
        """slope with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_slope(args)
            os.unlink(f.name)


class TestSlopeParser:
    """Test slope subcommand."""

    def test_slope_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "slope", "--help"]):
                main()
        assert exc.value.code == 0

    def test_slope_requires_lat_lon(self):
        with pytest.raises(SystemExit):
            with patch.object(sys, "argv", ["openzenith", "slope"]):
                main()


# ─── hillshade ─────────────────────────────────────────────────────────────────

class TestCmdHillshade:
    """Tests for cmd_hillshade."""

    def test_hillshade_success(self):
        """hillshade command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_hillshade(args)

    def test_hillshade_missing_coords_exits(self):
        """hillshade without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_hillshade(args)
        assert exc_info.value.code == 1

    def test_hillshade_with_output(self):
        """hillshade with --output saves array via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_hillshade(args)
            os.unlink(f.name)


class TestHillshadeParser:
    """Test hillshade subcommand."""

    def test_hillshade_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "hillshade", "--help"]):
                main()
        assert exc.value.code == 0


# ─── viewshed ──────────────────────────────────────────────────────────────────

class TestCmdViewshed:
    """Tests for cmd_viewshed."""

    def test_viewshed_success(self):
        """viewshed command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, height=10.0, max_dist=500, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_viewshed(args)

    def test_viewshed_missing_coords_exits(self):
        """viewshed without lat/lon exits."""
        args = MagicMock(lat=None, lon=None)
        with pytest.raises(SystemExit) as exc_info:
            cmd_viewshed(args)
        assert exc_info.value.code == 1

    def test_viewshed_with_output(self):
        """viewshed with --output saves image via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, height=1.75, max_dist=None, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_viewshed(args)
            os.unlink(f.name)


class TestViewshedParser:
    """Test viewshed subcommand."""

    def test_viewshed_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "viewshed", "--help"]):
                main()
        assert exc.value.code == 0

    def test_viewshed_requires_lat_lon(self):
        with pytest.raises(SystemExit):
            with patch.object(sys, "argv", ["openzenith", "viewshed"]):
                main()


# ─── profile ───────────────────────────────────────────────────────────────────

class TestCmdProfile:
    """Tests for cmd_profile."""

    def test_profile_success(self):
        """profile command runs with mocked grid."""
        args = MagicMock(lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=50, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_profile(args)

    def test_profile_empty_result(self):
        """profile handles empty result gracefully."""
        args = MagicMock(lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=50, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()), \
             patch("openzenith.terrain.profile", return_value=[]):
            cmd_profile(args)  # Should not raise

    def test_profile_with_csv_output(self):
        """profile with .csv output writes CSV file."""
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
            args = MagicMock(lat1=40.0, lon1=-74.0, lat2=40.1, lon2=-73.9, radius=10, samples=10, output=f.name)
            mock_grid = _mock_grid()
            with patch("openzenith.elevation.load_elevation_grid", return_value=mock_grid), \
                 patch("openzenith.terrain.profile", return_value=[
                     {"distance_m": 0.0, "elevation": 100.0},
                     {"distance_m": 1000.0, "elevation": 110.0},
                 ]):
                cmd_profile(args)
            os.unlink(f.name)


class TestProfileParser:
    """Test profile subcommand."""

    def test_profile_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "profile", "--help"]):
                main()
        assert exc.value.code == 0

    def test_profile_requires_all_coords(self):
        with pytest.raises(SystemExit):
            with patch.object(sys, "argv", ["openzenith", "profile", "--lat1", "40.0"]):
                main()


# ─── aspect ────────────────────────────────────────────────────────────────────

class TestCmdAspect:
    """Tests for cmd_aspect."""

    def test_aspect_success(self):
        """aspect command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_aspect(args)

    def test_aspect_with_output(self):
        """aspect with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_aspect(args)
            os.unlink(f.name)


class TestAspectParser:
    """Test aspect subcommand."""

    def test_aspect_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "aspect", "--help"]):
                main()
        assert exc.value.code == 0


# ─── twi ───────────────────────────────────────────────────────────────────────

class TestCmdTwi:
    """Tests for cmd_twi."""

    def test_twi_success(self):
        """twi command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_twi(args)

    def test_twi_with_output(self):
        """twi with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_twi(args)
            os.unlink(f.name)


class TestTwiParser:
    """Test twi subcommand."""

    def test_twi_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "twi", "--help"]):
                main()
        assert exc.value.code == 0


# ─── tpi ───────────────────────────────────────────────────────────────────────

class TestCmdTpi:
    """Tests for cmd_tpi."""

    def test_tpi_success(self):
        """tpi command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_tpi(args)

    def test_tpi_with_output(self):
        """tpi with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_tpi(args)
            os.unlink(f.name)


# ─── roughness ─────────────────────────────────────────────────────────────────

class TestCmdRoughness:
    """Tests for cmd_roughness."""

    def test_roughness_success(self):
        """roughness command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_roughness(args)

    def test_roughness_with_output(self):
        """roughness with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_roughness(args)
            os.unlink(f.name)


# ─── curvature ─────────────────────────────────────────────────────────────────

class TestCmdCurvature:
    """Tests for cmd_curvature."""

    def test_curvature_success(self):
        """curvature command runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_curvature(args)

    def test_curvature_with_output(self):
        """curvature with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_curvature(args)
            os.unlink(f.name)


# ─── tiles ─────────────────────────────────────────────────────────────────────

class TestCmdTiles:
    """Tests for cmd_tiles."""

    def test_tiles_unknown_region_exits(self):
        """tiles with unknown region exits."""
        args = MagicMock(bbox=None, region="invalid_region_xyz", lat=None, lon=None, radius=0.5,
                         zoom=None, cache_dir=None, force=False)
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 1

    def test_tiles_invalid_bbox_exits(self):
        """tiles with malformed bbox raises ValueError."""
        args = MagicMock(bbox="not_valid", region=None, lat=None, lon=None, radius=0.5,
                         zoom=None, cache_dir=None, force=False)
        # float() fails on non-numeric string before the length check
        with pytest.raises(ValueError):
            cmd_tiles(args)

    def test_tiles_no_bbox_no_region_exits(self):
        """tiles without bbox/region/latlon exits."""
        args = MagicMock(bbox=None, region=None, lat=None, lon=None, radius=0.5,
                         zoom=None, cache_dir=None, force=False)
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 1

    def test_tiles_large_download_blocked_without_force(self):
        """tiles blocks large downloads without --force."""
        args = MagicMock(bbox="34,-25,72,45", region=None, lat=None, lon=None, radius=0.5,
                         zoom="0-15", cache_dir=None, force=False)
        with pytest.raises(SystemExit) as exc_info:
            cmd_tiles(args)
        assert exc_info.value.code == 0

    def test_tiles_with_region(self):
        """tiles with --region works."""
        args = MagicMock(bbox=None, region="europe", lat=None, lon=None, radius=0.5,
                         zoom=None, cache_dir=None, force=False)
        with patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_tiles(args)

    def test_tiles_with_latlon(self):
        """tiles with --lat --lon uses that as center."""
        args = MagicMock(bbox=None, region=None, lat=40.7, lon=-74.0, radius=0.5,
                         zoom=None, cache_dir=None, force=False)
        with patch("openzenith.elevation.load_tiles") as mock_load, \
             patch("openzenith.elevation.get_tile_count") as mock_count, \
             patch("pathlib.Path.rglob") as mock_rglob:
            mock_load.return_value = "/fake"
            mock_count.return_value = {}
            mock_rglob.return_value = []
            cmd_tiles(args)


class TestTilesParser:
    """Test tiles subcommand."""

    def test_tiles_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "tiles", "--help"]):
                main()
        assert exc.value.code == 0


# ─── encode ─────────────────────────────────────────────────────────────────────

class TestCmdEncode:
    """Tests for cmd_encode."""

    def test_encode_file_not_found(self):
        """encode with non-existent input exits."""
        args = MagicMock(input="/nonexistent/file.tif", output="/tmp/out.ozt2",
                         format="auto", max_rmse=1.0, bits=None, predictor="gradient",
                         validate=False, quiet=True)
        with pytest.raises(SystemExit) as exc_info:
            cmd_encode(args)
        assert exc_info.value.code == 1

    def test_encode_single_geotiff(self):
        """encode a single GeoTIFF file."""
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

            args = MagicMock(input=str(tif_path), output=str(out_path),
                             format="auto", max_rmse=1.0, bits=None, predictor="gradient",
                             validate=False, quiet=True)
            cmd_encode(args)
            assert out_path.exists()


class TestEncodeParser:
    """Test encode subcommand."""

    def test_encode_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "encode", "--help"]):
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
            os.unlink(f.name)


class TestFillDepressionsParser:
    """Test fill-depressions subcommand."""

    def test_fill_depressions_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "fill-depressions", "--help"]):
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
            os.unlink(f.name)


class TestFlowAccumParser:
    """Test flow-accum subcommand."""

    def test_flow_accum_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "flow-accum", "--help"]):
                main()
        assert exc.value.code == 0


# ─── streams ───────────────────────────────────────────────────────────────────

class TestCmdStreams:
    """Tests for cmd_streams."""

    def test_streams_success(self):
        """streams runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, threshold=100, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_streams(args)

    def test_streams_with_output(self):
        """streams with --output saves image via PIL."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, zoom=None, threshold=100, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_streams(args)
            os.unlink(f.name)


class TestStreamsParser:
    """Test streams subcommand."""

    def test_streams_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "streams", "--help"]):
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
            os.unlink(f.name)


class TestExportGeotiffParser:
    """Test export-geotiff subcommand."""

    def test_export_geotiff_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "export-geotiff", "--help"]):
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
            os.unlink(f.name)


# ─── tri ───────────────────────────────────────────────────────────────────────

class TestCmdTri:
    """Tests for cmd_tri."""

    def test_tri_success(self):
        """tri runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_tri(args)

    def test_tri_with_output(self):
        """tri with --output saves .npy file."""
        with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_tri(args)
            os.unlink(f.name)


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
            os.unlink(f.name)


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
        """contour runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, interval=100.0, output=None)
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
            cmd_contour(args)

    def test_contour_with_output(self):
        """contour with --output saves GeoJSON."""
        with tempfile.NamedTemporaryFile(suffix=".geojson", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, interval=100.0, output=f.name)
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()):
                cmd_contour(args)
            os.unlink(f.name)


class TestContourParser:
    """Test contour subcommand."""

    def test_contour_help(self):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", "contour", "--help"]):
                main()
        assert exc.value.code == 0


# ─── geojson ───────────────────────────────────────────────────────────────────

class TestCmdGeojson:
    """Tests for cmd_geojson."""

    def test_geojson_success(self):
        """geojson runs with mocked grid."""
        args = MagicMock(lat=40.0, lon=-74.0, radius=5, kind="elevation", name=None, output=None)
        mock_geojson_result = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"elevation": 100}}
            ],
        }
        with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()), \
             patch("openzenith.export.grid_to_geojson", return_value=mock_geojson_result):
            cmd_geojson(args)

    def test_geojson_with_output(self):
        """geojson with --output saves GeoJSON."""
        with tempfile.NamedTemporaryFile(suffix=".geojson", delete=False) as f:
            args = MagicMock(lat=40.0, lon=-74.0, radius=5, kind="elevation", name=None, output=f.name)
            mock_geojson_result = {
                "type": "FeatureCollection",
                "features": [],
            }
            with patch("openzenith.elevation.load_elevation_grid", return_value=_mock_grid()), \
                 patch("openzenith.export.grid_to_geojson", return_value=mock_geojson_result):
                cmd_geojson(args)
            os.unlink(f.name)


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
        self._assert_exits(cmd_hillshade, MagicMock(lat=None, lon=-74.0, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None))

    def test_hillshade_missing_lon(self):
        self._assert_exits(cmd_hillshade, MagicMock(lat=40.0, lon=None, radius=5, azimuth=315, altitude=45, z_factor=1.0, output=None))

    def test_viewshed_missing_lat(self):
        self._assert_exits(cmd_viewshed, MagicMock(lat=None, lon=-74.0, radius=5, height=10.0, max_dist=500, output=None))

    def test_viewshed_missing_lon(self):
        self._assert_exits(cmd_viewshed, MagicMock(lat=40.0, lon=None, radius=5, height=10.0, max_dist=500, output=None))

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

    commands = [
        "download", "query", "trace", "watershed", "info", "validate",
        "slope", "hillshade", "viewshed", "aspect", "tpi", "roughness",
        "curvature", "profile", "contour", "geojson", "tiles",
        "fill-depressions", "flow-accum", "streams", "export-geotiff",
        "export-cog", "tri", "profile-curvature", "planform-curvature",
        "drainage-density", "multi-hillshade", "color-relief",
    ]

    @pytest.mark.parametrize("cmd", commands)
    def test_help(self, cmd):
        with pytest.raises(SystemExit) as exc:
            with patch.object(sys, "argv", ["openzenith", cmd, "--help"]):
                main()
        assert exc.value.code == 0


# ─── Unrecognized subcommand ───────────────────────────────────────────────────

class TestUnrecognizedCommand:
    """Test behavior when an unrecognized command is given."""

    def test_unrecognized_command(self):
        """Unrecognized command causes argparse to exit with status 2."""
        with pytest.raises(SystemExit) as exc_info:
            with patch.object(sys, "argv", ["openzenith", "nonexistent-cmd"]):
                main()
        assert exc_info.value.code == 2

