"""Tests for openzenith.terrain.profiles.

Covers the elevation-profile path accumulation, the hillslope walk
(pinning its actual downstream-trace behavior), and both flow_length
directions including the nodata skip and cycle-guard branches.
"""

import numpy as np
import pytest

from openzenith.terrain.profiles import flow_length, hillslope_profile, profile

NODATA = -32768.0
CELL_M = 0.001 * 111320.0  # the module's cell-size-in-meters constant


@pytest.fixture
def east_ramp() -> np.ndarray:
    """East-rising ramp: D8 flow points west, exiting at column 0."""
    return np.tile((np.arange(10, dtype=np.float32) * 10.0), (10, 1))


class TestProfile:
    """Elevation profile along a cell path."""

    def test_fewer_than_two_points_returns_empty(self):
        dem = np.zeros((5, 5), dtype=np.float32)
        assert profile(dem, []) == []
        assert profile(dem, [(2, 2)]) == []

    def test_cardinal_step_distance_is_one_cell(self):
        dem = np.zeros((5, 5), dtype=np.float32)
        pts = [(0, 0), (0, 1)]
        out = profile(dem, pts)
        assert len(out) == 2
        assert out[0]["distance_m"] == 0.0
        assert out[1]["distance_m"] == pytest.approx(round(CELL_M, 1))

    def test_diagonal_step_distance(self):
        dem = np.zeros((5, 5), dtype=np.float32)
        out = profile(dem, [(0, 0), (1, 1)])
        assert out[1]["distance_m"] == pytest.approx(round(np.sqrt(2) * CELL_M, 1))

    def test_distances_accumulate_across_segments(self):
        dem = np.arange(25, dtype=np.float32).reshape(5, 5)
        out = profile(dem, [(0, 0), (0, 1), (0, 2)])
        assert out[2]["distance_m"] == pytest.approx(round(2 * CELL_M, 1))
        assert [o["elevation"] for o in out] == [0.0, 1.0, 2.0]
        assert [o["row"] for o in out] == [0, 0, 0]
        assert [o["col"] for o in out] == [0, 1, 2]


class TestHillslopeProfile:
    """Outlet-to-ridge walk (follows each cell's D8 downstream pointer)."""

    def test_walks_downstream_until_the_grid_edge(self, east_ramp):
        # Pinned actual behavior: the walk follows fd[], i.e. downstream.
        out = hillslope_profile(east_ramp, 5, 8)
        assert [p["elevation"] for p in out] == [
            80.0,
            70.0,
            60.0,
            50.0,
            40.0,
            30.0,
            20.0,
            10.0,
            0.0,
        ]
        assert out[1]["distance_m"] == pytest.approx(CELL_M)
        assert out[-1]["distance_m"] == pytest.approx(8 * CELL_M)

    def test_flat_dem_stops_immediately(self):
        out = hillslope_profile(np.full((6, 6), 100.0, dtype=np.float32), 3, 3)
        assert len(out) == 1
        assert out[0] == {"distance_m": 0.0, "elevation": 100.0}

    def test_stops_before_entering_nodata(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[:, 3] = NODATA
        out = hillslope_profile(ramp, 5, 8)
        # Last valid cell is column 4; the nodata cell at column 3 breaks the walk.
        assert out[-1]["elevation"] == 40.0
        assert out[-1]["distance_m"] == pytest.approx(4 * CELL_M)
        assert len(out) == 5


class TestFlowLength:
    """Longest flow path length per cell."""

    def test_downslope_accumulates_to_the_edge(self, east_ramp):
        fl = flow_length(east_ramp)
        assert fl[5, 0] == pytest.approx(0.0)
        assert fl[5, 1] == pytest.approx(CELL_M)
        assert fl[5, 9] == pytest.approx(9 * CELL_M)

    def test_nodata_cells_report_zero_length(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        fl = flow_length(ramp)
        assert fl[5, 5] == 0.0

    def test_downslope_walk_continues_through_downstream_nodata(self, east_ramp):
        # Pinned actual behavior: only the START cell is skipped for nodata;
        # the walk itself does not re-check nodata mid-path.
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        fl = flow_length(ramp)
        assert fl[5, 4] == pytest.approx(4 * CELL_M)

    def test_upslope_matches_downslope_walk_on_a_ramp(self, east_ramp):
        # Pinned actual behavior: the "upslope" branch walks the same fd[]
        # chain from the target cell, so both directions agree here.
        fl_down = flow_length(east_ramp)
        fl_up = flow_length(east_ramp, direction="upslope")
        np.testing.assert_allclose(fl_up, fl_down, rtol=1e-6)

    def test_upslope_starts_at_zero_for_pit_cells(self):
        # A cell with fd == -1 contributes nothing to its own upslope trace.
        pit = np.full((6, 6), 50.0, dtype=np.float32)
        pit[3, 3] = 0.0  # local minimum -> fd -1
        fl_up = flow_length(pit, direction="upslope")
        assert fl_up[3, 3] == 0.0

    def test_upslope_nodata_cells_report_zero_and_are_not_traced(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        fl_up = flow_length(ramp, direction="upslope")
        assert fl_up[5, 5] == 0.0
        # The ramp still traces its full 9-step downstream chain elsewhere.
        assert fl_up[0, 9] == pytest.approx(9 * CELL_M)

    def test_output_shape_and_dtype(self, east_ramp):
        fl = flow_length(east_ramp)
        assert fl.shape == east_ramp.shape
        assert fl.dtype == np.float32
