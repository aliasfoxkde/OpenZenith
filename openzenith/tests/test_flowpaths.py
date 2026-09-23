"""Tests for openzenith.hydrology.flowpaths — distance surface edge paths.

Covers the propagation guards in downslope/upslope flow-path length and the
Dijkstra neighbour loop in cost_distance, using explicit flow-direction grids
so the exact edge topology is known.
"""

import numpy as np

from openzenith.hydrology.flowpaths import (
    cost_distance,
    downslope_distance_to_outlet,
    downslope_flowpath_length,
    max_upslope_flow_length,
    upslope_flowpath_length,
)

NODATA = -32768.0
CELL_M = 0.001 * 111320.0


def _flat_dem(shape, elev=100.0):
    """Flat DEM — every cell has the same elevation."""
    return np.full(shape, elev, dtype=np.float32)


def _south_flow(shape):
    """Every cell flows south; the bottom row is a nodata-direction pit row."""
    flow_dir = np.full(shape, 2, dtype=np.int8)
    flow_dir[-1, :] = -1
    return flow_dir


class TestDownslopeFlowpathLengthEdges:
    """downslope_flowpath_length propagation guards."""

    def test_direction_group_with_no_in_bounds_target_is_skipped(self):
        """A direction group whose targets are all off-grid is simply skipped.

        Regression: the finite-distance filter used to index with the mask it
        was extending (``dist[src_r[valid], src_c[valid]]``), producing a
        ``valid.sum()``-length right-hand side that cannot broadcast against
        the full-length mask — an all-east grid crashed with a broadcast
        ValueError instead of routing.
        """
        dem = _flat_dem((3, 3))
        flow_dir = np.zeros((3, 3), dtype=np.int8)  # everyone flows east, off-grid

        result = downslope_flowpath_length(dem, flow_dir)

        # The east edge drains off-grid immediately; interior cells
        # accumulate one metric step per cell toward the edge. (1, 0) itself
        # sits on the west border, so its 0-distance seed beats propagation.
        assert result[1, 2] == 0.0
        assert result[1, 1] == np.float32(CELL_M)
        assert result[1, 0] == 0.0

    def test_single_valid_target_in_a_group_still_propagates(self):
        """A direction group with one in-bounds target survives (mask len 1).

        With exactly one valid target the boolean mask broadcasts, so the run
        completes and the in-bounds target accumulates its step distance.
        """
        dem = _flat_dem((3, 3))
        flow_dir = np.full((3, 3), -1, dtype=np.int8)
        flow_dir[1, 0] = 0  # east -> (1, 1), in bounds
        flow_dir[1, 2] = 0  # east -> (1, 3), OUT of bounds (same group)
        flow_dir[1, 1] = 2  # south -> (2, 1)

        result = downslope_flowpath_length(dem, flow_dir)

        assert result.dtype == np.float32
        assert result[1, 1] == np.float32(CELL_M)
        # Border and pit cells are seeded with zero distance.
        assert result[0, 0] == 0.0
        assert result[2, 2] == 0.0

    def test_distance_accumulates_downstream_of_the_seeds(self):
        """Distances accumulate downstream from the zero-distance seeds.

        Border cells and pit cells are seeded at 0 and each relaxation writes
        ``source + step`` into its downstream target, so values grow with the
        flow direction away from the nearest seed. Because *every* border cell
        is a seed, the surface measures distance to the nearest border or pit
        rather than to a single watershed outlet.
        """
        dem = _flat_dem((5, 5))
        result = downslope_flowpath_length(dem, _south_flow((5, 5)))

        assert result[0, 2] == 0.0  # grid border seed
        assert result[1, 2] == np.float32(CELL_M)
        assert result[2, 2] == np.float32(2 * CELL_M)
        assert result[3, 2] == np.float32(3 * CELL_M)
        assert result[4, 2] == 0.0  # pit row, also a border → re-seeded at 0

    def test_flow_cycle_never_reaches_an_outlet(self):
        """A two-cell flow cycle has no downstream outlet and stays NaN."""
        dem = _flat_dem((5, 5))
        flow_dir = np.full((5, 5), -1, dtype=np.int8)
        flow_dir[2, 2] = 0  # E -> (2, 3)
        flow_dir[2, 3] = 4  # W -> (2, 2): a cycle

        result = downslope_flowpath_length(dem, flow_dir)

        assert np.isnan(result[2, 2])
        assert np.isnan(result[2, 3])
        # Border cells drain off-grid immediately.
        assert result[0, 0] == 0.0

    def test_interior_distance_accumulates_along_the_path(self):
        """A pit row bounded by higher ground accumulates from the top edge.

        With a raised rim the only seeds are the top border, so the interior
        counts cell widths downstream from it instead of draining to a border
        on all four sides.
        """
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        dem[4, :] = 50.0  # raised-rim outlet row
        flow_dir = np.full((5, 5), 2, dtype=np.int8)  # everyone flows south
        flow_dir[4, :] = -1  # pit row

        result = downslope_flowpath_length(dem, flow_dir)

        assert result[0, 2] == 0.0
        assert result[1, 2] == np.float32(CELL_M)
        assert result[2, 2] == np.float32(2 * CELL_M)
        assert result[3, 2] == np.float32(3 * CELL_M)
        assert result[4, 2] == 0.0

    def test_flow_dir_is_computed_when_omitted(self):
        """Omitting flow_dir derives it from the DEM."""
        dem = np.zeros((6, 6), dtype=np.float32)
        for r in range(6):
            dem[r, :] = (6 - r) * 10.0  # slopes south

        result = downslope_flowpath_length(dem)

        assert result.shape == dem.shape
        assert result.dtype == np.float32
        # Both borders are seeds; the interior accumulates downstream of them.
        assert result[0, 2] == 0.0
        assert result[5, 2] == 0.0
        assert result[1, 2] == np.float32(CELL_M)
        assert result[4, 2] == np.float32(4 * CELL_M)


class TestUpslopeFlowpathLength:
    """upslope_flowpath_length — distance from each cell up to its ridge."""

    def test_distances_accumulate_downstream_from_ridge_seeds(self):
        """Ridges seed 0 and distances accumulate along the flow path.

        Regression: propagation used to update a source cell from its
        *target*, so no distance ever left the ridge seeds and every
        non-ridge cell came back NaN. Values now travel downstream from the
        in-degree-0 ridges, giving each cell its flow-path distance up to
        the nearest ridge.
        """
        dem = np.zeros((6, 6), dtype=np.float32)
        for r in range(6):
            dem[r, :] = (6 - r) * 10.0

        result = upslope_flowpath_length(dem)

        assert result.shape == dem.shape
        # Row 0 is the ridge line; each row below accumulates one step.
        assert result[0, 0] == 0.0
        assert result[0, 5] == 0.0
        assert result[3, 3] == np.float32(3 * CELL_M)
        assert result[5, 5] == np.float32(5 * CELL_M)

    def test_explicit_flow_dir_matches_derived(self):
        """Passing a precomputed flow direction gives the same seeding."""
        dem = np.zeros((5, 5), dtype=np.float32)
        for r in range(5):
            dem[r, :] = (5 - r) * 10.0
        from openzenith.hydrology.flow import d8_flow_direction

        derived = upslope_flowpath_length(dem)
        explicit = upslope_flowpath_length(dem, d8_flow_direction(dem))

        np.testing.assert_array_equal(derived, explicit)


class TestCostDistanceEdges:
    """cost_distance neighbour loop guards."""

    def test_nodata_neighbours_are_never_entered(self):
        """A nodata cell adjacent to the outlet blocks direct traversal."""
        dem = np.zeros((5, 5), dtype=np.float32)
        for r in range(5):
            dem[r, :] = r * 10.0  # north-south relief so every step costs
        dem[2, 2] = NODATA  # nodata hole east of the outlet

        result = cost_distance(dem, [(2, 1)])

        assert result.dtype == np.float32
        assert result[2, 1] == 0.0
        assert result[2, 2] == NODATA  # the hole itself
        # Cells beyond the hole are still reachable, but only around it.
        assert result[2, 3] > 0.0
        assert np.isfinite(result[2, 3])

    def test_unreachable_cells_are_reported_as_nodata(self):
        """Out-of-bounds outlets leave the whole grid at the nodata value."""
        dem = _flat_dem((4, 4))
        result = cost_distance(dem, [(-1, 0), (99, 99)])

        assert result.shape == (4, 4)
        np.testing.assert_array_equal(result, np.full((4, 4), NODATA, dtype=np.float32))

    def test_nodata_outlet_cell_is_ignored(self):
        """An outlet sitting on nodata is dropped from the seed set."""
        dem = _flat_dem((4, 4))
        dem[1, 1] = NODATA
        result = cost_distance(dem, [(1, 1)])

        assert result[1, 1] == NODATA
        assert result[0, 0] == NODATA  # never seeded → unreachable

    def test_distance_cost_function_is_metric(self):
        """cost_function='distance' returns the accumulated metric distance."""
        dem = _flat_dem((5, 5))
        cell_m = 0.001 * 111320.0

        result = cost_distance(dem, [(0, 0)], cost_function="distance")

        assert result[0, 0] == 0.0
        assert result[2, 2] == np.float32(2 * np.sqrt(2) * cell_m)
        assert result[0, 4] == np.float32(4 * cell_m)

    def test_slope_cost_function_grows_with_relief(self):
        """cost_function='slope' weights each step by the elevation change."""
        dem = np.zeros((5, 5), dtype=np.float32)
        for r in range(5):
            dem[r, :] = r * 10.0

        flat = cost_distance(_flat_dem((5, 5)), [(0, 0)], cost_function="slope")
        relief = cost_distance(dem, [(0, 0)], cost_function="slope")

        assert relief[4, 4] > flat[4, 4]
        assert relief[0, 4] == flat[0, 4]  # no elevation change along row 0


class TestFlowpathDelegatingHelpers:
    """max_upslope_flow_length / downslope_distance_to_outlet delegate terrain.flow_length."""

    def test_max_upslope_flow_length_matches_flow_length(self):
        """The wrapper returns the upslope flow-length surface."""
        from openzenith.terrain import flow_length

        dem = np.zeros((6, 6), dtype=np.float32)
        for r in range(6):
            dem[r, :] = (6 - r) * 10.0

        np.testing.assert_array_equal(
            max_upslope_flow_length(dem), flow_length(dem, direction="upslope")
        )

    def test_downslope_distance_to_outlet_matches_flow_length(self):
        """The wrapper returns the downslope flow-length surface."""
        from openzenith.terrain import flow_length

        dem = np.zeros((6, 6), dtype=np.float32)
        for r in range(6):
            dem[r, :] = (6 - r) * 10.0

        np.testing.assert_array_equal(
            downslope_distance_to_outlet(dem), flow_length(dem, direction="downslope")
        )
