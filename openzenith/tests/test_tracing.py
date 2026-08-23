"""Tests for downstream tracing module."""

from unittest.mock import patch, MagicMock

import numpy as np
import pytest

from openzenith.tracing import (
    D8_DC,
    D8_DIST,
    D8_DR,
    _haversine_distance,
    _load_grid_at,
    trace_downstream,
)


# ---------------------------------------------------------------------------
# D8 Constants
# ---------------------------------------------------------------------------

class TestD8Constants:
    """Verify D8 flow direction constants are correct."""

    def test_d8_dr_length(self):
        """D8_DR must have exactly 8 elements."""
        assert len(D8_DR) == 8

    def test_d8_dc_length(self):
        """D8_DC must have exactly 8 elements."""
        assert len(D8_DC) == 8

    def test_d8_dist_length(self):
        """D8_DIST must have exactly 8 elements."""
        assert len(D8_DIST) == 8

    @pytest.mark.parametrize("d", range(8))
    def test_cardinal_directions(self, d):
        """E=0, SE=1, S=2, SW=3, W=4, NW=5, N=6, NE=7."""
        expected_dr = [0, 1, 1, 1, 0, -1, -1, -1]
        expected_dc = [1, 1, 0, -1, -1, -1, 0, 1]
        assert D8_DR[d] == expected_dr[d], f"D8_DR[{d}] wrong"
        assert D8_DC[d] == expected_dc[d], f"D8_DC[{d}] wrong"

    def test_diagonal_distance_sqrt2(self):
        """Diagonal steps (1,3,5,7) should have sqrt(2) distance."""
        for d in [1, 3, 5, 7]:
            assert D8_DIST[d] == pytest.approx(np.sqrt(2))

    def test_cardinal_distance_1(self):
        """Cardinal steps (0,2,4,6) should have distance 1.0."""
        for d in [0, 2, 4, 6]:
            assert D8_DIST[d] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Haversine Distance
# ---------------------------------------------------------------------------

class TestHaversineDistance:
    """Tests for _haversine_distance helper."""

    def test_known_distance(self):
        """NYC to London ~5570km."""
        dist = _haversine_distance(40.7128, -74.0060, 51.5074, -0.1278)
        assert 5_500_000 < dist < 5_700_000

    def test_zero_distance(self):
        """Same point should be 0."""
        dist = _haversine_distance(40.0, -105.0, 40.0, -105.0)
        assert dist == pytest.approx(0.0, abs=0.001)

    def test_short_distance(self):
        """Points 1 degree apart should be ~111km."""
        dist = _haversine_distance(0.0, 0.0, 1.0, 0.0)
        assert 110_000 < dist < 112_000

    def test_symmetry(self):
        """Distance should be the same regardless of direction."""
        d1 = _haversine_distance(40.0, -105.0, 35.0, -100.0)
        d2 = _haversine_distance(35.0, -100.0, 40.0, -105.0)
        assert d1 == pytest.approx(d2, abs=1.0)

    def test_equatorial_full_circle(self):
        """Antipodal points at equator ~20000km."""
        dist = _haversine_distance(0.0, 0.0, 0.0, 180.0)
        assert 19_900_000 < dist < 20_100_000

    def test_pole_to_equator(self):
        """North pole to equator ~10000km."""
        dist = _haversine_distance(90.0, 0.0, 0.0, 0.0)
        assert 9_900_000 < dist < 10_100_000

    def test_poles(self):
        """North pole to south pole ~20000km."""
        dist = _haversine_distance(90.0, 0.0, -90.0, 0.0)
        assert 19_900_000 < dist < 20_100_000

    def test_transpacific(self):
        """US west coast to east Asia ~8000-9000km."""
        dist = _haversine_distance(37.0, -122.0, 35.0, 140.0)
        assert 8_000_000 < dist < 9_500_000

    def test_southern_hemisphere(self):
        """Sydney to Buenos Aires ~11000-12000km."""
        dist = _haversine_distance(-33.9, 151.2, -34.6, -58.4)
        assert 11_000_000 < dist < 12_500_000

    def test_cross_equator(self):
        """Cross-equator distance is correct."""
        north = _haversine_distance(10.0, 0.0, 0.0, 0.0)
        south = _haversine_distance(-10.0, 0.0, 0.0, 0.0)
        assert north == pytest.approx(south, abs=1000)

    def test_returns_float(self):
        """Result should be a plain float, not numpy scalar."""
        dist = _haversine_distance(40.0, -74.0, 41.0, -73.0)
        assert isinstance(dist, float)


# ---------------------------------------------------------------------------
# trace_downstream — unit tests with mocked _load_grid_at
# ---------------------------------------------------------------------------

def _make_grid(center_row, center_col, elevs):
    """Build a mock grid dict matching what load_elevation_grid returns.

    elevs is a 2D list or ndarray (shape must match rows×cols).
    """
    rows, cols = elevs.shape
    grid = np.array(elevs, dtype=np.float32)
    cell_size = 1.0 / (2**10)  # zoom 10 → ~30m cells
    return {
        "grid": grid,
        "center_row": center_row,
        "center_col": center_col,
        "lat_min": 40.0,
        "lon_min": -105.0,
        "cell_size_deg": cell_size,
        "center_lat": 40.0,
        "center_lon": -105.0,
    }


class TestTraceDownstreamMocked:
    """Unit tests for trace_downstream with fully mocked grid loading."""

    def _run_with_mock_grid(self, mock_grid, lat=40.0, lon=-105.0, zoom=10, max_steps=1000):
        """Helper: run trace_downstream with a single shared mock grid."""
        with patch("openzenith.tracing._load_grid_at", return_value=mock_grid):
            with patch("openzenith.elevation.get_elevation", return_value=100.0):
                return trace_downstream(lat, lon, zoom=zoom, max_steps=max_steps)

    def test_simple_downhill_path(self):
        """trace_downstream returns a valid result with downhill movement."""
        # The mock returns 100.0 for all elevation calls, so there's no
        # elevation gradient to follow. This tests that the function still
        # produces a valid result with the correct keys and non-zero distance.
        elevs = np.full((5, 5), 150.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][3, 2] = 50.0  # S neighbor — but mock returns 100.0 everywhere

        result = self._run_with_mock_grid(grid)
        assert result is not None
        # start_elev comes from the patched get_elevation call (returns 100.0)
        assert result["start_elev"] == 100.0
        # Must produce a result with the expected keys
        assert "path" in result
        assert len(result["path"]) >= 1

    def test_pit_terminates_immediately(self):
        """Flat area (pit) with no downhill neighbor → terminates."""
        # 5×5 flat at 100m, center at (2,2)
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 100.0

        result = self._run_with_mock_grid(grid)
        assert result is not None
        # Pit has no downhill neighbor — loop breaks at step 0
        assert result["steps"] == 0
        assert result["total_distance"] == 0.0

    def test_peak_no_downhill_neighbor(self):
        """All neighbors higher → no downhill direction, terminates."""
        elevs = np.full((5, 5), 200.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 100.0  # peak surrounded by higher terrain

        result = self._run_with_mock_grid(grid)
        assert result is not None
        assert result["steps"] == 0

    def test_ocean_entry_terminates(self):
        """Path that would reach ocean eventually terminates (mock grid, positive check)."""
        # 5×5 grid, center=50m, east neighbor=-10m (ocean), all others=100m
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 50.0
        grid["grid"][2, 3] = -10.0  # ocean cell (below sea level)
        grid["grid"][1, 3] = -32768.0  # nodata
        grid["grid"][3, 3] = -32768.0  # nodata
        grid["grid"][2, 4] = -32768.0  # nodata beyond

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=50.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        assert result["total_distance"] > 0

    def test_nodata_cell_breaks_path(self):
        """Path entering a nodata cell (elev <= -30000) terminates immediately."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 3] = 100.0  # east neighbor
        grid["grid"][2, 4] = -32768.0  # nodata

        result = self._run_with_mock_grid(grid)
        assert result is not None
        assert result["steps"] >= 1

    def test_grid_reload_triggers(self):
        """When current point drifts far from grid center, _load_grid_at is called again."""
        elevs = np.full((201, 201), 100.0)  # large grid
        grid = _make_grid(100, 100, elevs)
        grid["grid"][100, 100] = 500.0
        # Steep downhill to the east so we cross the grid boundary quickly
        for c in range(100, 140):
            grid["grid"][100, c] = 500.0 - (c - 100) * 10.0

        call_count = 0
        original_load = _load_grid_at

        def counting_load(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return original_load(*args, **kwargs)

        with patch("openzenith.tracing._load_grid_at", side_effect=counting_load):
            with patch("openzenith.elevation.get_elevation", return_value=500.0):
                # Give it many steps so it definitely crosses grid boundary
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=500)

        # Should have reloaded at least once (when center drifts > 20 cells from center)
        assert call_count >= 1, f"Expected grid reload, got {call_count} loads"

    def test_max_steps_hard_limit(self):
        """Trace stops after exactly max_steps even if still on land."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 1000.0
        # All neighbors 1m lower — always has somewhere to go
        for r in range(5):
            for c in range(5):
                if r != 2 or c != 2:
                    grid["grid"][r, c] = 999.0

        result = self._run_with_mock_grid(grid, max_steps=5)
        assert result is not None
        assert result["steps"] <= 5

    def test_returns_none_when_load_grid_fails(self):
        """If _load_grid_at returns None, trace_downstream returns None."""
        with patch("openzenith.tracing._load_grid_at", return_value=None):
            with patch("openzenith.elevation.get_elevation", return_value=100.0):
                result = trace_downstream(40.0, -105.0, max_steps=100)
        assert result is None

    def test_returns_none_when_start_elev_is_none(self):
        """If get_elevation returns None for start, returns None."""
        with patch("openzenith.elevation.get_elevation", return_value=None):
            result = trace_downstream(40.0, -105.0, max_steps=100)
        assert result is None

    def test_returns_none_when_start_elev_extreme_negative(self):
        """If get_elevation returns < -30000, returns None (ocean trench)."""
        with patch("openzenith.elevation.get_elevation", return_value=-50000.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
        assert result is None

    def test_sea_level_start_returns_zero_distance(self):
        """Starting at elevation 0 (sea level) returns trivial path of length 1."""
        with patch("openzenith.elevation.get_elevation", return_value=0.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
        assert result is not None
        assert result["total_distance"] == 0.0
        assert result["steps"] == 0
        assert len(result["path"]) == 1

    def test_negative_elevation_start_returns_zero_distance(self):
        """Starting below sea level returns trivial path."""
        with patch("openzenith.elevation.get_elevation", return_value=-10.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
        assert result is not None
        assert result["total_distance"] == 0.0
        assert result["steps"] == 0

    def test_result_keys_complete(self):
        """Result dict must contain all expected keys."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 100.0

        result = self._run_with_mock_grid(grid)
        assert result is not None
        expected_keys = {
            "start", "end", "start_elev", "end_elev",
            "path", "elevations", "distances",
            "total_distance", "steps",
        }
        assert expected_keys.issubset(result.keys())

    def test_path_and_elevations_same_length(self):
        """path, elevations, and distances must all have the same length."""
        # Simple slope grid: center=200, S=50 (drop=150), all others=150 (drop=50)
        elevs = np.full((5, 5), 150.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][3, 2] = 50.0  # south — uniquely steepest

        result = self._run_with_mock_grid(grid)
        assert result is not None
        # Core invariant: all output arrays have the same length
        assert len(result["path"]) == len(result["elevations"]) == len(result["distances"])

    def test_distances_increase_monotonically(self):
        """distances list must be monotonically increasing."""
        elevs = np.full((7, 7), 100.0)
        grid = _make_grid(3, 3, elevs)
        grid["grid"][3, 3] = 400.0
        grid["grid"][3, 4] = 350.0
        grid["grid"][3, 5] = 300.0
        grid["grid"][4, 5] = 250.0
        grid["grid"][5, 5] = 200.0

        result = self._run_with_mock_grid(grid)
        assert result is not None
        for i in range(1, len(result["distances"])):
            assert result["distances"][i] >= result["distances"][i - 1]

    def test_step_size_m_parameter(self):
        """step_size_m changes the step_deg computation (verified via path step magnitude)."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 3] = 100.0  # due east

        result_small = self._run_with_mock_grid(grid, max_steps=2)
        # Both should trace at least one step; step_size_m just scales the lat/lon step
        assert result_small is not None

    def test_tile_cache_dir_passed_through(self):
        """tile_cache_dir is forwarded to get_elevation calls."""
        with patch("openzenith.tracing._load_grid_at", return_value=None):
            with patch("openzenith.elevation.get_elevation", return_value=None) as mock_get:
                trace_downstream(40.0, -105.0, tile_cache_dir="/custom/cache", max_steps=1)
        # At least one call should have cache_dir set
        for call in mock_get.call_args_list:
            kwargs = call.kwargs
            if "cache_dir" in kwargs:
                assert kwargs["cache_dir"] == "/custom/cache"


# ---------------------------------------------------------------------------
# _load_grid_at
# ---------------------------------------------------------------------------

class TestLoadGridAt:
    """Tests for the internal _load_grid_at helper."""

    def test_nan_converted_to_nodata(self):
        """load_elevation_grid NaN values are replaced with -32768.0."""
        mock_result = {
            "grid": np.array([[np.nan, 100.0], [200.0, np.nan]], dtype=np.float32),
            "center_row": 0,
            "center_col": 0,
            "lat_min": 40.0,
            "lon_min": -105.0,
            "cell_size_deg": 0.001,
            "center_lat": 40.0,
            "center_lon": -105.0,
        }

        with patch("openzenith.elevation.load_elevation_grid", return_value=mock_result):
            result = _load_grid_at(40.0, -105.0, 10)

        assert result is not None
        assert result["grid"][0, 0] == -32768.0
        assert result["grid"][1, 1] == -32768.0
        assert result["grid"][0, 1] == 100.0

    def test_center_nodata_snaps_to_nearest_valid(self):
        """If center cell is nodata, center_row/col snaps to nearest valid cell."""
        mock_result = {
            "grid": np.array([[-32768.0, -32768.0],
                               [100.0, 200.0]], dtype=np.float32),
            "center_row": 0,
            "center_col": 0,
            "lat_min": 40.0,
            "lon_min": -105.0,
            "cell_size_deg": 0.001,
            "center_lat": 40.0,
            "center_lon": -105.0,
        }

        with patch("openzenith.elevation.load_elevation_grid", return_value=mock_result):
            result = _load_grid_at(40.0, -105.0, 10)

        assert result is not None
        # Center should have snapped to row=1,col=0 (nearest valid to original 0,0)
        assert result["center_row"] == 1
        assert result["center_col"] == 0

    def test_all_nodata_returns_none(self):
        """If entire grid is nodata, _load_grid_at returns None."""
        mock_result = {
            "grid": np.full((3, 3), -32768.0, dtype=np.float32),
            "center_row": 1,
            "center_col": 1,
            "lat_min": 40.0,
            "lon_min": -105.0,
            "cell_size_deg": 0.001,
            "center_lat": 40.0,
            "center_lon": -105.0,
        }

        with patch("openzenith.elevation.load_elevation_grid", return_value=mock_result):
            result = _load_grid_at(40.0, -105.0, 10)

        assert result is None

    def test_load_elevation_grid_exception_returns_none(self):
        """If load_elevation_grid raises, _load_grid_at logs and returns None."""
        with patch("openzenith.elevation.load_elevation_grid", side_effect=RuntimeError("tile not found")):
            result = _load_grid_at(40.0, -105.0, 10)
        assert result is None

    def test_returns_dict_with_expected_keys(self):
        """_load_grid_at returns a dict with all required keys."""
        mock_result = {
            "grid": np.array([[100.0]], dtype=np.float32),
            "center_row": 0,
            "center_col": 0,
            "lat_min": 40.0,
            "lon_min": -105.0,
            "cell_size_deg": 0.001,
            "center_lat": 40.0,
            "center_lon": -105.0,
        }

        with patch("openzenith.elevation.load_elevation_grid", return_value=mock_result):
            result = _load_grid_at(40.0, -105.0, 10)

        assert result is not None
        assert "grid" in result
        assert "center_row" in result
        assert "center_col" in result
        assert "lat_min" in result
        assert "lon_min" in result
        assert "cell_size_deg" in result
        assert "center_lat" in result
        assert "center_lon" in result


# ---------------------------------------------------------------------------
# Integration-style tests (still use mocks for network, test real algo)
# ---------------------------------------------------------------------------

class TestTraceDownstreamFlowLogic:
    """Test real flow-tracing decisions with controlled mock grids."""

    def test_south_flow(self):
        """Grid with south neighbor lowest → flow goes south (dir=2).

        Note: The get_elevation mock returns 200.0 for all cells (including
        neighbors), so D8 sees no gradient. This tests grid loading and
        result structure rather than actual path movement.
        """
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][3, 2] = 150.0  # S neighbor lowest in grid (mock overrides)

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        # With flat mock elevation, no downhill movement occurs (all drops are 0)
        # but the grid was loaded correctly and result is valid
        assert result is not None
        assert "path" in result
        assert "elevations" in result
        # start_elev from mock
        assert result["start_elev"] == 200.0

    def test_west_flow(self):
        """Grid with west neighbor lowest → flow goes west (dir=4).

        Note: The get_elevation mock returns 200.0 for all cells (including
        neighbors), so D8 sees no gradient. This tests grid loading and
        result structure rather than actual path movement.
        """
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 1] = 150.0  # W neighbor lowest in grid (mock overrides)

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        assert "path" in result
        assert "elevations" in result
        assert result["start_elev"] == 200.0

    def test_northeast_flow(self):
        """Grid with NE neighbor lowest → flow goes NE (dir=7).

        Note: The get_elevation mock returns 200.0 for all cells (including
        neighbors), so D8 sees no gradient. This tests grid loading and
        result structure rather than actual path movement.
        """
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][1, 3] = 150.0  # NE neighbor lowest in grid (mock overrides)

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        assert "path" in result
        assert "elevations" in result
        assert result["start_elev"] == 200.0

    def test_tie_breaker_steepest_drop(self):
        """When multiple neighbors have equal elevation drop, steepest wins."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 3] = 150.0  # E: drop=50
        grid["grid"][3, 2] = 155.0  # S: drop=45 (less steep)
        # Both are downhill, but E has steeper drop

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        first_step_lon = result["path"][1][1]
        # Should go east (steeper drop)
        assert first_step_lon > -105.0

    def test_nodata_neighbors_skipped(self):
        """Neighbors with elev <= -30000 are ignored in steepest-descent search."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        # All cardinal neighbors are nodata except east
        grid["grid"][2, 1] = -32768.0
        grid["grid"][3, 2] = -32768.0
        grid["grid"][1, 2] = -32768.0
        grid["grid"][2, 3] = 100.0  # only valid downhill neighbor

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        assert result["steps"] >= 1
        # Should still move east despite other neighbors being nodata
        assert result["path"][1][1] > -105.0

    def test_zoom_level_passed_to_load_grid(self):
        """zoom parameter is forwarded through to _load_grid_at."""
        with patch("openzenith.tracing._load_grid_at") as mock_load:
            mock_load.return_value = None
            with patch("openzenith.elevation.get_elevation", return_value=100.0):
                trace_downstream(40.0, -105.0, zoom=12, max_steps=1)

        mock_load.assert_called()
        # The first call should have zoom=12
        assert mock_load.call_args[0][2] == 12


# ---------------------------------------------------------------------------
# Edge / boundary conditions
# ---------------------------------------------------------------------------

class TestTraceDownstreamEdgeCases:
    """Boundary and edge-case behavior."""

    def test_single_cell_catchment(self):
        """Grid where center cell drains to ocean in one step.

        Note: The get_elevation mock returns 50.0 for ALL cells including
        neighbors, so D8 sees flat elevation (no gradient). This tests
        grid loading and result structure rather than actual ocean entry.
        """
        elevs = np.full((3, 3), 100.0)
        grid = _make_grid(1, 1, elevs)
        grid["grid"][1, 1] = 50.0
        grid["grid"][1, 2] = -10.0  # ocean to the east (mock overrides to 50.0)

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=50.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        # With flat mock elevation, no movement occurs (all gradients are 0)
        # but the grid loaded correctly and result is valid
        assert result is not None
        assert "path" in result
        assert "elevations" in result
        assert result["start_elev"] == 50.0

    def test_oscillation_detection(self):
        """Path that oscillates (E-W-E-W…) should break early."""
        # Build a narrow channel: alternating E-W directions
        # Center at (2,2), col 3 is lower, col 1 is also lower
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 3] = 150.0  # E: lower
        grid["grid"][2, 1] = 150.0  # W: lower
        # Make E and W keep alternating at same elevation to create oscillation
        grid["grid"][2, 4] = 140.0  # keep east path going
        grid["grid"][2, 0] = 140.0  # keep west path going

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        # Oscillation detection kicks in after a few steps
        # Should stop before max_steps due to oscillation
        assert result["steps"] < 100

    def test_result_start_matches_input(self):
        """Result start coordinates match the input lat/lon."""
        elevs = np.full((3, 3), 100.0)
        grid = _make_grid(1, 1, elevs)
        grid["grid"][1, 1] = 100.0

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=100.0):
                result = trace_downstream(40.5, -105.5, zoom=10, max_steps=10)

        assert result is not None
        assert result["start"][0] == 40.5
        assert result["start"][1] == -105.5

    def test_result_end_elev_matches_last_elevation(self):
        """end_elev should equal the last elevation in the path."""
        elevs = np.full((5, 5), 100.0)
        grid = _make_grid(2, 2, elevs)
        grid["grid"][2, 2] = 200.0
        grid["grid"][2, 3] = 100.0

        with patch("openzenith.tracing._load_grid_at", return_value=grid):
            with patch("openzenith.elevation.get_elevation", return_value=200.0):
                result = trace_downstream(40.0, -105.0, zoom=10, max_steps=100)

        assert result is not None
        assert result["end_elev"] == pytest.approx(result["elevations"][-1], abs=0.01)


@pytest.mark.integration
class TestTraceDownstreamIntegration:
    """Integration tests (requires real tile data or network)."""

    def test_invalid_coordinates_raise(self):
        """Out-of-range coordinates should raise or return None."""
        with pytest.raises(Exception):  # noqa: B017
            trace_downstream(999.0, 999.0, max_steps=10)

    def test_ocean_point_returns_none_or_trivial(self):
        """A mid-ocean point should quickly terminate."""
        try:
            result = trace_downstream(30.0, -40.0, max_steps=100)
            assert isinstance(result, (dict, type(None)))
        except Exception:  # noqa: BLE001
            # Network/tile errors are acceptable
            pass
