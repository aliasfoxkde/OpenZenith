"""Tests for openzenith.terrain.viewshed — visibility and directional exposure."""

import sys
import types
from unittest import mock

import numpy as np

from openzenith.terrain.viewshed import (
    directional_relief,
    fetch_analysis,
    horizon_angle,
    max_elevation_from_direction,
    viewshed,
    visibility_index,
)

NODATA = -32768.0


def _plateau(rows: int = 10, cols: int = 10, elev: float = 100.0) -> np.ndarray:
    return np.full((rows, cols), elev, dtype=np.float32)


def _fake_numba() -> types.ModuleType:
    """Return a numba stand-in whose @jit is the identity.

    numba is an optional accelerator (not installed in this environment); the
    stub lets the tests execute the real ``_viewshed_core`` kernel body instead
    of silently falling back to the vectorized NumPy path.
    """
    module = types.ModuleType("numba")
    module.jit = lambda **_kwargs: lambda fn: fn
    module.prange = range
    return module


def _run_with_numba(dem, *args, **kwargs) -> np.ndarray:
    with mock.patch.dict(sys.modules, {"numba": _fake_numba()}):
        return viewshed(dem, *args, **kwargs)


class TestViewshedEdges:
    def test_observer_on_nodata_sees_nothing(self):
        # A NODATA observer has no eye level; both backends return an empty
        # grid (the NumPy path used to pre-mark the observer visible before
        # its nodata short-circuit, diverging from the kernel).
        dem = _plateau()
        dem[4, 4] = NODATA
        vs = viewshed(dem, observer_row=4, observer_col=4)
        assert vs.dtype == np.bool_
        assert vs.sum() == 0
        assert not vs[4, 4]

    def test_all_other_cells_nodata_early_return(self):
        dem = _plateau()
        dem[dem == 100.0] = NODATA
        dem[4, 4] = 100.0  # lone valid observer cell
        vs = viewshed(dem, observer_row=4, observer_col=4)
        # The observer's own cell is the only visible one.
        assert vs.sum() == 1

    def test_flat_plateau_everything_visible(self):
        dem = _plateau()
        vs = viewshed(dem, observer_row=4, observer_col=4)
        assert vs.all()

    def test_ridge_blocks_behind_it(self):
        dem = _plateau(12, 12)
        dem[6, :] = 500.0  # east-west ridge south of the observer
        vs = viewshed(dem, observer_row=2, observer_col=6)
        # Cells on the far side of the ridge are occluded.
        assert not vs[10, 6]
        # The ridge crest itself is visible.
        assert vs[6, 6]

    def test_max_distance_limits_visibility(self):
        dem = _plateau()
        vs = viewshed(dem, observer_row=4, observer_col=4, max_distance_cells=2)
        rr, cc = np.mgrid[0:10, 0:10]
        far = np.sqrt((rr - 4) ** 2 + (cc - 4) ** 2) > 2
        assert not vs[far].any()
        assert vs[4, 4]


class TestVisibilityIndex:
    def test_counts_overlap_of_two_observers(self):
        dem = _plateau()
        count = visibility_index(dem, [(2, 2), (7, 7)])
        assert count.dtype == np.int16
        # Flat terrain: every cell sees both observers.
        assert (count == 2).all()

    def test_custom_observer_heights_and_out_of_range(self):
        dem = _plateau()
        count = visibility_index(
            dem,
            [(2, 2), (20, 20)],  # second observer is off-grid and ignored
            observer_heights=[10.0, 5.0],
        )
        assert (count == 1).all()


class TestHorizonAngle:
    def test_flat_horizon_is_zero(self):
        angles = horizon_angle(_plateau(8, 8), azimuth=0, max_distance=5)
        assert angles.dtype == np.float32
        assert (angles == 0).all()

    def test_mountain_west_gives_positive_angle(self):
        # This implementation traces azimuth 0 due west (udc = -cos(az)).
        dem = _plateau(8, 8)
        dem[:, 0] = 900.0  # tall wall on the west edge
        angles = horizon_angle(dem, azimuth=0, max_distance=7)  # look west
        assert (angles[:, 1:] > 0).all()

    def test_nodata_reports_nodata(self):
        dem = _plateau()
        dem[0, :] = NODATA
        angles = horizon_angle(dem, azimuth=0, max_distance=3)
        assert (angles[0, :] == NODATA).all()

    def test_nodata_barrier_shields_the_horizon(self):
        # Azimuth 0 traces west; a NODATA cell due west of the origin ends the
        # search, so a tall peak hidden behind the gap must not raise the angle.
        dem = _plateau(6, 6)
        dem[:, 2] = NODATA  # gap in the data between the origin and the peak
        dem[:, 0] = 900.0  # tall wall west of the gap
        angles = horizon_angle(dem, azimuth=0, max_distance=5)
        # Columns 3-4 look west and stop at the gap: flat horizon.
        assert (angles[:, 3:5] == 0).all()
        # Same terrain without the gap does see the wall.
        open_dem = _plateau(6, 6)
        open_dem[:, 0] = 900.0
        assert (horizon_angle(open_dem, azimuth=0, max_distance=5)[:, 3:5] > 0).all()


class TestDirectionalRelief:
    def test_open_toward_lower_ground_is_fully_visible(self):
        # Azimuth 90 traces north (dr = -sin(az)); build a ramp that RISES
        # northward so looking north always sees lower ground behind.
        dem = np.tile(np.linspace(100.0, 200.0, 10, dtype=np.float32).reshape(-1, 1), (1, 10))
        relief = directional_relief(dem, azimuth=90, max_distance=9)
        assert relief.dtype == np.float32
        assert (relief[1:, :] == 1.0).all()

    def test_wall_blocks_direction(self):
        dem = _plateau(8, 8)
        dem[:, 7] = 900.0  # wall on the east edge
        relief = directional_relief(dem, azimuth=90, max_distance=7)
        # Interior cells look at a mix of flat ground and the wall.
        assert (relief[:, :7] < 1.0).all()
        assert (relief[:, :7] >= 0.0).all()

    def test_nodata_reports_nodata(self):
        dem = _plateau()
        dem[3, :] = NODATA
        relief = directional_relief(dem, azimuth=0, max_distance=3)
        assert (relief[3, :] == NODATA).all()


class TestFetchAnalysis:
    def test_flat_terrain_stops_immediately(self):
        # Fetch stops at the first cell at or above the origin (>=), so a
        # flat plateau reports the minimum fetch everywhere.
        fetch = fetch_analysis(_plateau(8, 8), wind_direction=0, max_distance=20)
        assert (fetch == 1.0).all()

    def test_downhill_fetch_runs_to_boundary(self):
        # Azimuth 0 traces west; an eastward-rising ramp means the upwind
        # (westward) path is continuously downhill until the grid edge.
        dem = np.tile(100.0 + 10.0 * np.arange(8, dtype=np.float32), (8, 1))
        fetch = fetch_analysis(dem, wind_direction=0, max_distance=20)
        np.testing.assert_allclose(fetch[0, :], np.arange(1, 9, dtype=np.float32))

    def test_wall_stops_fetch(self):
        dem = np.tile(100.0 + 10.0 * np.arange(8, dtype=np.float32), (8, 1))
        dem[:, 0] = 900.0  # wall on the western (upwind) edge
        fetch = fetch_analysis(dem, wind_direction=0, max_distance=20)
        assert (fetch[:, 1] == 1.0).all()  # wall is the immediate west cell
        assert (fetch[:, 3] == 3.0).all()  # hit the wall after 3 downhill cells

    def test_nodata_reports_nodata(self):
        dem = _plateau()
        dem[:, 0] = NODATA
        fetch = fetch_analysis(dem, wind_direction=270, max_distance=10)
        assert (fetch[:, 0] == NODATA).all()

    def test_nodata_upwind_stops_the_trace(self):
        # Azimuth 0 traces west along an eastward-rising ramp, so the upwind
        # path is downhill all the way to the edge. A NODATA cell truncates the
        # run at the gap instead of the grid boundary.
        dem = np.tile(100.0 + 10.0 * np.arange(8, dtype=np.float32), (8, 1))
        dem[:, 3] = NODATA
        fetch = fetch_analysis(dem, wind_direction=0, max_distance=20)
        # Column 7 runs into the gap after 4 downhill cells (not the 8-cell edge run).
        assert fetch[0, 7] == 4.0
        assert fetch[0, 4] == 1.0
        # The gap itself is reported as NODATA, not as a fetch distance.
        assert (fetch[:, 3] == NODATA).all()


class TestMaxElevationFromDirection:
    def test_finds_peak_in_direction(self):
        # Azimuth 0 looks east (dc = +cos(az)); put the peak on the east edge.
        dem = _plateau(8, 8)
        dem[4, 7] = 777.0
        result = max_elevation_from_direction(dem, azimuth=0, max_distance=7)
        assert result.dtype == np.float32
        assert (result[4, :] == 777.0).all()
        # Rows without the peak report their own elevation.
        assert (result[0, :] == 100.0).all()

    def test_nodata_reports_nodata(self):
        dem = _plateau()
        dem[5, :] = NODATA
        result = max_elevation_from_direction(dem, azimuth=0, max_distance=4)
        assert (result[5, :] == NODATA).all()


class TestViewshedNumbaKernel:
    """The optional Numba kernel, executed through a pure-Python @jit stub.

    numba is an optional dependency; without it ``viewshed`` silently uses the
    vectorized NumPy path. These tests install a stub whose ``jit`` decorator is
    the identity, which runs the real kernel body so its occlusion, nodata and
    max-distance logic is exercised instead of being skipped.
    """

    def test_flat_plateau_matches_numpy_fallback(self):
        dem = _plateau(12, 12)
        jitted = _run_with_numba(dem, 4, 4)
        fallback = viewshed(dem, 4, 4)  # no numba installed -> NumPy path
        assert jitted.dtype == np.bool_
        assert np.array_equal(jitted, fallback)
        assert jitted.all()

    def test_ridge_blocks_behind_it(self):
        dem = _plateau(12, 12)
        dem[6, :] = 500.0
        vs = _run_with_numba(dem, 2, 6)
        assert not vs[10, 6]  # far side of the ridge is occluded
        assert vs[6, 6]  # the crest itself is visible
        assert vs[:6, :].all()  # everything above the ridge is open

    def test_max_distance_cells_matches_numpy_fallback(self):
        dem = _plateau(12, 12)
        jitted = _run_with_numba(dem, 4, 4, max_distance_cells=3)
        fallback = viewshed(dem, 4, 4, max_distance_cells=3)
        assert np.array_equal(jitted, fallback)
        rr, cc = np.mgrid[0:12, 0:12]
        assert not jitted[np.sqrt((rr - 4) ** 2 + (cc - 4) ** 2) > 3].any()

    def test_nodata_cells_are_never_visible(self):
        dem = _plateau(12, 12)
        dem[3:5, 3:6] = NODATA
        vs = _run_with_numba(dem, 8, 8, max_distance_cells=30)
        assert not vs[3:5, 3:6].any()
        assert vs.sum() > 0  # the surrounding valid terrain is still reachable

    def test_observer_on_nodata_is_empty_in_both_backends(self):
        dem = _plateau()
        dem[4, 4] = NODATA
        vs = _run_with_numba(dem, 4, 4)
        assert not vs.any()
        # The NumPy fallback now short-circuits before marking the observer,
        # so both backends agree on the empty result.
        assert viewshed(dem, 4, 4).sum() == 0

    def test_degenerate_cell_size_stays_valid(self):
        # A cell size this small pushes every interpolated sample below the
        # 1e-6 m horizontal-distance floor; the kernel must skip those samples
        # instead of dividing by ~0 and emitting inf/NaN slopes.
        dem = _plateau(8, 8)
        vs = _run_with_numba(dem, 3, 3, cell_size_deg=1e-12)
        assert vs.dtype == np.bool_
        assert vs.shape == dem.shape
        assert vs[3, 3]
