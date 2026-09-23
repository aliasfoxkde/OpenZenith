"""Tests for openzenith.terrain.profiles.

Covers the elevation-profile path accumulation, the hillslope walk
(pinning its actual downstream-trace behavior), and both flow_length
directions including the nodata skip and cycle-guard branches.

The D8 pointer guards (off-grid break, cycle break) are also exercised by
substituting a hand-built flow-direction grid: real ``d8_flow_direction``
output can never trigger them (see ``TestD8PointerGuards`` for the
executable proof), so the guard lines are only reachable through a
synthetic fd grid.
"""

import numpy as np
import pytest

from openzenith.hydrology import d8_flow_direction
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

    def test_stops_when_the_walk_enters_a_below_nodata_cell(self):
        # A cell *below* the sentinel is still a legal flow target for D8
        # (hydrology/flow.py tests validity with `!= nodata`), so the walk
        # steps into it and only the module's own `<= nodata` check stops it.
        # This is the mid-walk nodata break; the adjacent-nodata case above is
        # cut short earlier, by the pit (fd == -1) break.
        dem = np.tile((np.arange(6, dtype=np.float32) * 10.0), (6, 1))
        dem[:, 2] = NODATA - 7228.0  # -39996: valid to D8, invalid to the walk
        out = hillslope_profile(dem, 3, 5)
        assert [p["elevation"] for p in out] == [50.0, 40.0, 30.0]
        assert out[-1]["distance_m"] == pytest.approx(2 * CELL_M)

    def test_d8_deliberately_treats_below_sentinel_values_as_valid_data(self):
        # Contract pin for the documented predicate divergence: terrain/
        # profiles.py cuts its walks at `dem <= nodata` while hydrology/flow.py
        # tests validity with `!= nodata`. At the default sentinel the two
        # agree exactly; they only diverge for values *below* the caller's
        # sentinel — there D8 keeps the cell as real terrain (a pit that
        # captures flow) while the profile walk refuses to enter it. Both are
        # deliberate: the `<=` predicate protects profile walks from voids,
        # and harmonizing flow.py would silently change every downslope
        # product (accumulation, watersheds, channels) and break Rust-core
        # parity. Any change here must be a conscious cross-module decision.
        dem = np.full((3, 3), 100.0, dtype=np.float32)
        dem[1, 1] = NODATA - 1.0  # below the sentinel: the divergence zone
        fd = d8_flow_direction(dem)  # default nodata=-32768

        # The below-sentinel cell is valid terrain — neighbours drain INTO it:
        assert fd[0, 1] == 2  # north neighbour flows south into the pit
        assert fd[1, 0] == 0  # west neighbour flows east into the pit
        assert fd[0, 0] == 1  # NW corner flows southeast into the pit
        assert fd[1, 1] == -1  # the cell itself is a pit, not a void

        # The profiles predicate would have called the same cell void, so the
        # divergence is observable and pinned on both sides.
        assert dem[1, 1] <= NODATA


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

    def test_upslope_measures_distance_to_the_ridge_on_a_monotone_ramp(self, east_ramp):
        # Regression: the "upslope" branch used to walk the same fd[] chain
        # as the downslope branch, so both directions returned identical
        # values. True upslope length walks the INVERTED graph: on this
        # west-draining ramp every cell receives everything to its east.
        fl_up = flow_length(east_ramp, direction="upslope")
        for c in range(10):
            assert fl_up[5, c] == pytest.approx((9 - c) * CELL_M)
        # Mirror property on a monotone ramp: upslope + downslope == total.
        fl_down = flow_length(east_ramp, direction="downslope")
        np.testing.assert_allclose(
            fl_up + fl_down, np.full((10, 10), 9 * CELL_M, dtype=np.float32), rtol=1e-6
        )

    def test_upslope_of_a_pit_reaches_its_inflow(self):
        # The pit's own fd is -1, but upslope length is about who drains
        # INTO the cell: its eight flat neighbours each step down into it,
        # so the longest headwater path ending at the pit is one diagonal.
        pit = np.full((6, 6), 50.0, dtype=np.float32)
        pit[3, 3] = 0.0  # local minimum
        fl_up = flow_length(pit, direction="upslope")
        assert fl_up[3, 3] == pytest.approx(np.sqrt(2) * CELL_M)
        # A flat corner nothing drains into stays at zero.
        assert fl_up[0, 0] == 0.0

    def test_upslope_nodata_cells_report_zero_and_dam_the_chain(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        fl_up = flow_length(ramp, direction="upslope")
        assert fl_up[5, 5] == 0.0  # nodata target: never traced
        # The nodata cell dams row 5: nothing drains into (5, 4) any more
        # (its only supplier was the void to its east), and cells east of
        # the void became flat pits feeding nobody.
        assert fl_up[5, 4] == 0.0
        # Row 0 is unaffected: its full chain still drains to the west edge.
        assert fl_up[0, 0] == pytest.approx(9 * CELL_M)

    def test_output_shape_and_dtype(self, east_ramp):
        fl = flow_length(east_ramp)
        assert fl.shape == east_ramp.shape
        assert fl.dtype == np.float32


def _use_flow_direction(monkeypatch, fd):
    """Substitute a hand-built flow-direction grid for the real D8 pass.

    Both ``hillslope_profile`` and ``flow_length`` import
    ``d8_flow_direction`` inside the call, so patching the attribute on
    ``openzenith.hydrology`` is picked up on the next call.
    """

    def fake(dem, nodata=NODATA):
        return fd

    monkeypatch.setattr("openzenith.hydrology.d8_flow_direction", fake)


class TestD8PointerGuards:
    """Defensive breaks on flow pointers that real D8 output cannot produce.

    ``d8_flow_direction`` pads the DEM with the nodata value and only accepts
    a neighbor that is in-grid *and* non-nodata with a strictly positive slope
    (openzenith/hydrology/flow.py), so its pointers always land inside the
    grid and always descend — hence never revisit a cell. The
    ``TestD8GuardsUnreachableWithRealD8`` suite pins that property, and the
    tests here drive the same guard lines with synthetic fd grids.
    """

    @pytest.fixture
    def flat(self) -> np.ndarray:
        """All-valid DEM: the fd grid alone decides where the walk goes."""
        return np.full((3, 3), 100.0, dtype=np.float32)

    def test_hillslope_walk_breaks_when_d8_points_off_the_grid(self, flat, monkeypatch):
        # Outlet at the east edge whose pointer exits the grid to the east:
        # the walk must stop instead of indexing out of bounds.
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[1, 2] = 0  # E, from the last column
        _use_flow_direction(monkeypatch, fd)

        out = hillslope_profile(flat, 1, 2)
        assert out == [{"distance_m": 0.0, "elevation": 100.0}]

    def test_hillslope_walk_breaks_mid_path_when_d8_points_off_the_grid(self, flat, monkeypatch):
        # Two eastward steps, the second of which leaves the grid: the guard
        # keeps the two samples already collected and stops there.
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[1, 1] = 0
        fd[1, 2] = 0
        _use_flow_direction(monkeypatch, fd)

        out = hillslope_profile(flat, 1, 1)
        assert [p["elevation"] for p in out] == [100.0, 100.0]
        assert out[-1]["distance_m"] == pytest.approx(CELL_M)

    def test_downslope_flow_length_breaks_when_d8_points_off_the_grid(self, flat, monkeypatch):
        # The edge cell's own walk breaks immediately (length 0) and the cell
        # feeding it keeps the single step it managed.
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[1, 1] = 0  # E, in-grid
        fd[1, 2] = 0  # E, off-grid
        _use_flow_direction(monkeypatch, fd)

        fl = flow_length(flat, direction="downslope")
        assert fl[1, 1] == pytest.approx(CELL_M)
        assert fl[1, 2] == 0.0

    def test_downslope_flow_length_breaks_on_a_flow_cycle(self, monkeypatch):
        # A two-cell loop with one cell feeding it: without the visited-set
        # break this walk would never terminate.
        dem = np.full((3, 3), 100.0, dtype=np.float32)
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[1, 1] = 2  # S
        fd[2, 1] = 6  # N  -> the cycle
        fd[1, 0] = 1  # SE -> tail draining into the cycle
        _use_flow_direction(monkeypatch, fd)

        fl = flow_length(dem, direction="downslope")
        assert fl[1, 1] == pytest.approx(2 * CELL_M)
        assert fl[2, 1] == pytest.approx(2 * CELL_M)
        assert fl[1, 0] == pytest.approx((np.sqrt(2) + 2) * CELL_M)

    def test_upslope_takes_the_longest_branch_at_a_fan_in(self, flat, monkeypatch):
        # Two upstream branches drain into the junction at (1, 1): a 2-step
        # branch via (1, 0) and a 1-step branch from (1, 2). The inverted
        # walk must return the LONGEST headwater path, not the first found.
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[0, 0] = 2  # S -> (1, 0)
        fd[1, 0] = 0  # E -> (1, 1)
        fd[1, 2] = 4  # W -> (1, 1)
        _use_flow_direction(monkeypatch, fd)

        fl = flow_length(flat, direction="upslope")
        assert fl[1, 1] == pytest.approx(2 * CELL_M)
        assert fl[1, 0] == pytest.approx(CELL_M)
        assert fl[1, 2] == pytest.approx(0.0)

    def test_upslope_walk_survives_a_synthetic_flow_cycle(self, flat, monkeypatch):
        # A two-cell fd loop: the inverted walk must terminate (on_path
        # guard) instead of chasing (1,1) -> (2,1) -> (1,1) forever.
        fd = np.full((3, 3), -1, dtype=np.int8)
        fd[1, 1] = 2  # S -> (2, 1)
        fd[2, 1] = 6  # N -> (1, 1)  — the cycle
        _use_flow_direction(monkeypatch, fd)

        fl = flow_length(flat, direction="upslope")
        assert fl[1, 1] == pytest.approx(CELL_M)
        assert fl[2, 1] == pytest.approx(CELL_M)


class TestD8GuardsUnreachableWithRealD8:
    """Executable form of the unreachability proof for the guards above."""

    DR = (0, 1, 1, 1, 0, -1, -1, -1)
    DC = (1, 1, 0, -1, -1, -1, 0, 1)

    def test_real_d8_pointers_stay_in_grid_and_acyclic(self):
        # Across randomized DEMs (with nodata holes and flat/terraced areas)
        # every D8 pointer must land inside the grid and the pointer graph
        # must be acyclic — exactly the two conditions the guarded breaks
        # exist to survive.
        rng = np.random.default_rng(20260923)
        rows, cols = 10, 10
        for _ in range(15):
            dem = rng.uniform(0.0, 500.0, size=(rows, cols)).astype(np.float32)
            dem = np.where(rng.random((rows, cols)) < 0.15, NODATA, dem)
            dem[rng.integers(0, rows), rng.integers(0, cols)] = 0.0  # force a pit

            fd = d8_flow_direction(dem, NODATA)
            assert fd.shape == (rows, cols)
            for r in range(rows):
                for c in range(cols):
                    d = int(fd[r, c])
                    if d == -1:
                        continue
                    assert 0 <= r + self.DR[d] < rows
                    assert 0 <= c + self.DC[d] < cols

            # No pointer may lead back to an already-visited cell.
            for r in range(rows):
                for c in range(cols):
                    seen = set()
                    cr, cc = r, c
                    while int(fd[cr, cc]) != -1:
                        assert (cr, cc) not in seen
                        seen.add((cr, cc))
                        d = int(fd[cr, cc])
                        cr, cc = cr + self.DR[d], cc + self.DC[d]
