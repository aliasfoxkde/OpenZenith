"""Rust↔Python parity: the ``openzenith_core`` CLI against the SDK hydrology.

The same fixed 16×16 DEM is pushed through both implementations and the results
are compared cell for cell. The suite began with two documented divergences
(sub-sentinel neighbour handling, and the iterative accumulation sweep); both
were SDK defects and both engines have since been unified — the former
divergence tests now pin the parity itself, so any drift on either side turns
into failures instead of silent divergence.

Every test here executes the Rust binary and is skipped when it has not been
built (``cargo build --release`` inside ``core/``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
import pytest

from openzenith.hydrology.flow import (
    d8_flow_direction,
    flow_accumulation,
    flow_accumulation_fast,
)
from openzenith.hydrology.streams import stream_order

if TYPE_CHECKING:
    from pathlib import Path
    from types import ModuleType

NODATA = -32768.0
#: Accumulation threshold low enough for the network to include real confluences.
STREAM_THRESHOLD = 3


def parity_dem() -> np.ndarray:
    """Build the fixed parity DEM: tilt + hill + ridge + pit + one nodata corner.

    The four ingredients force different routing behaviour in different
    quadrants, so the comparison cannot pass by accident:

    * a SE tilt (24 m per row, 9 m per column) gives every cell a default
      downhill direction, so the largest catchment ends at the south-east low
      ground rather than at a corner;
    * a cone centred on (4, 4) is the grid's summit (683 m) but still drains SE,
      because the tilt outruns the cone's own gradient there;
    * a raised column at c=11 is a divide: the cell immediately west of it
      drains away west, while the column itself escapes east past a near-tie —
      a 95 m cardinal drop against a 130 m diagonal drop divided by √2
      (≈91.9), the kind of comparison that would expose any f32/f64 drift
      between the two slope loops;
    * a carved cell at (11, 4) is an interior pit with no outflow;
    * (0, 15) is the single nodata cell.

    Values are integers in ``[-32768, 683]``, so they are exact in ``float32``:
    the Python side computes slopes in float64 and the Rust side in f32, and the
    two can only disagree where a slope tie is decided by rounding. No tie here
    can be: cardinal and diagonal slopes differ by ``|a - b/√2|`` for small
    integers ``a``, ``b``, and the closest call on this grid is ≈0.3 slope units
    — orders of magnitude above the f32 ulp at these magnitudes.
    """
    rows = np.arange(16).reshape(-1, 1)
    cols = np.arange(16).reshape(1, -1)

    dem = (15 - rows) * 24.0 + (15 - cols) * 9.0
    dem = dem + np.maximum(320.0 - 26.0 * (np.abs(rows - 4) + np.abs(cols - 4)), 0.0)
    dem = dem + np.where(cols == 11, 60.0, 0.0)
    dem[11, 4] -= 95.0
    dem[0, 15] = NODATA
    return dem.astype(np.float32)


@pytest.fixture
def grids(core_cli: Path, oz_core: ModuleType) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(DEM, Python D8 grid, Rust D8 grid) for the parity DEM.

    Requesting ``core_cli`` is what makes every test using this fixture skip,
    rather than error, where the Rust binary has not been built.
    """
    dem = parity_dem()
    rust_fd = np.array(oz_core.d8_flow_direction(dem.tolist()), dtype=np.int8)
    return dem, d8_flow_direction(dem), rust_fd


def test_d8_flow_direction_parity(grids: tuple[np.ndarray, np.ndarray, np.ndarray]):
    """D8 directions agree cell for cell, including the nodata corner and pits.

    The nodata corner is -1 on both sides: Python excludes it through the valid
    mask, Rust through ``elev <= nodata``. Both also agree that a cell with no
    lower neighbour — the carved pit and the flat hill top — is -1.
    """
    _, py_fd, rs_fd = grids

    assert np.array_equal(py_fd, rs_fd)
    # The fixture really does exercise the interesting cases.
    assert rs_fd[0, 15] == -1, "nodata corner"
    assert rs_fd[11, 4] == -1, "carved pit"
    assert (rs_fd >= -1).all() and (rs_fd <= 7).all(), "direction codes stay in range"


def test_flow_accumulation_parity(
    oz_core: ModuleType, grids: tuple[np.ndarray, np.ndarray, np.ndarray]
):
    """Rust accumulation equals the SDK's topological sort exactly.

    ``flow_accumulation_fast`` is the SDK's recommended entry point and prefers
    ``_flow_accumulation_toposort``, which the Rust ``flow_accumulation``
    documents itself as matching. Both are Kahn's algorithm with the same
    off-grid clipping, so the comparison is exact integer equality, not a
    tolerance.
    """
    _, py_fd, rs_fd = grids
    expected = flow_accumulation_fast(py_fd)

    rust_accum = np.array(oz_core.flow_accumulation(rs_fd.tolist()), dtype=np.int32)

    assert np.array_equal(rust_accum, expected)
    # The outlet with the largest catchment, and the pit, are where the fixture
    # says they are — this is what makes the comparison a real one.
    assert int(rust_accum[15, 10]) == int(expected[15, 10]) == 80, "largest catchment"
    outlet = np.unravel_index(int(rust_accum.argmax()), rust_accum.shape)
    assert outlet == (15, 10), "the south-east low ground is the main outlet"
    assert int(rust_accum[11, 4]) == 12, "the carved pit collects its own hillslope"
    assert int(rust_accum.sum()) == int(expected.sum())


def test_stream_order_parity(
    oz_core: ModuleType, grids: tuple[np.ndarray, np.ndarray, np.ndarray]
):
    """Strahler orders agree exactly across a network with order-3 confluences.

    Both sides start every stream cell at 1 and propagate the Strahler rule to a
    fixed point (max inflow, +1 when two or more inflows carry that order), so
    the outputs are equal as integers even though the dtypes differ (int32 in
    the SDK, u8 out of the CLI).
    """
    _, py_fd, rs_fd = grids
    streams = flow_accumulation_fast(py_fd) >= STREAM_THRESHOLD

    rust_order = np.array(
        oz_core.stream_order(streams.astype(np.int8).tolist(), rs_fd.tolist()), dtype=np.int32
    )
    python_order = stream_order(streams, py_fd)

    assert np.array_equal(rust_order, python_order)
    assert python_order.max() >= 2, "fixture must include real confluences to be a real test"


def test_gradient_round_trip_parity(
    oz_core: ModuleType, grids: tuple[np.ndarray, np.ndarray, np.ndarray]
):
    """The Rust gradient codec round-trips the parity DEM bit for bit.

    The fixture's nodata corner at (0, 15) is the exact shape that used to
    expose the predictor defect: with sentinel ingredients fed into the
    3-neighbour gradient uncorrected, the 15 cells below it decoded to garbage
    ((1, 15): expected 336, got -25). The predictor now excludes sentinel
    ingredients and reconstruct re-derives the same fallback, so the whole
    grid — sentinel corner included — must come back exactly.
    """
    dem, _, _ = grids

    residuals = oz_core.gradient_predict(dem.tolist())
    assert residuals[0][15] == int(NODATA), "sentinel passes through verbatim"

    reconstructed = np.array(oz_core.gradient_reconstruct(residuals), dtype=np.float32)
    assert np.array_equal(reconstructed, dem)


# ── Former divergences, now closed ─────────────────────────────────────────────
# Both sides of each former divergence were SDK defects (documented by the
# parity work and fixed 2026-10-07): d8_flow_direction now treats at-or-below-
# sentinel neighbours as void like the Rust core, and flow_accumulation runs
# the same topological engine as the CLI. These tests pin the closures.


def test_parity_below_nodata_cells(core_cli: Path, oz_core: ModuleType):
    """A cell *below* the sentinel is void on both sides.

    Python's ``d8_flow_direction`` used to test neighbours with ``!= nodata``,
    so an elevation under the sentinel survived as terrain and — being 40 000
    metres deep — won every slope contest. It now applies the Rust core's
    ``<=`` convention: at-or-below-sentinel neighbours are refused and the
    reachable cells pit out identically.
    """
    dem = [[10.0, 5.0, -40000.0], [7.0, 6.0, -40000.0]]

    python_fd = d8_flow_direction(np.array(dem, dtype=np.float32))
    rust_fd = np.array(oz_core.d8_flow_direction(dem), dtype=np.int8)

    assert python_fd.tolist() == [[0, -1, -1], [7, 6, -1]], "sub-sentinel cell is void"
    assert np.array_equal(python_fd, rust_fd), "Python matches the Rust convention"


def test_parity_accumulation(oz_core: ModuleType, grids: tuple[np.ndarray, np.ndarray, np.ndarray]):
    """``flow_accumulation`` and the Rust CLI agree exactly.

    The SDK's original iterative sweep let each cell hand its total downstream
    at most once, in direction-major rather than topological order — on this
    16×16 fixture it under-counted 156 of 256 cells. It now runs the same
    Kahn's algorithm as the CLI; every engine name (flow_accumulation,
    flow_accumulation_fast, Rust CLI) must produce identical grids.
    """
    _, py_fd, rs_fd = grids

    rust_accum = np.array(oz_core.flow_accumulation(rs_fd.tolist()), dtype=np.int32)
    accum = flow_accumulation(py_fd)
    fast = flow_accumulation_fast(py_fd)

    assert np.array_equal(rust_accum, accum), "Rust matches flow_accumulation"
    assert np.array_equal(accum, fast), "both SDK engines agree"
