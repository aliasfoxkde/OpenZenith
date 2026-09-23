"""Tests for openzenith.terrain.viewshed — visibility and directional exposure."""

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


class TestViewshedEdges:
    def test_observer_on_nodata_sees_only_itself(self):
        # The observer cell is pre-marked visible before the nodata check
        # short-circuits, so the result is the single-cell grid.
        dem = _plateau()
        dem[4, 4] = NODATA
        vs = viewshed(dem, observer_row=4, observer_col=4)
        assert vs.dtype == np.bool_
        assert vs.sum() == 1
        assert vs[4, 4]

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
