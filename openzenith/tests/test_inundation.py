"""Tests for openzenith.hydrology.inundation — flooding and depression storage.

Fixtures are hand-built grids: a flat 100 m terrace holding a single pit, so
the water level that separates "pit floods" from "pit pools" is derivable by
hand (the pit fills to its 100 m spill elevation first).
"""

import sys

import numpy as np
import pytest

from openzenith.hydrology.inundation import (
    depression_depth_stats,
    flood_inundation,
    inundation_depth,
)

NODATA = -32768.0
CELL_AREA_M2 = 111.32**2


def _pit_dem() -> np.ndarray:
    """Build a 100 m terrace with a 60 m pit at (4, 4) and a NODATA corner."""
    dem = np.full((8, 8), 100.0, dtype=np.float32)
    dem[4, 4] = 60.0
    dem[0, 0] = NODATA
    return dem


class TestFloodInundation:
    """flood_inundation extent at a given water level."""

    def test_pit_pools_instead_of_flooding_when_depressions_are_filled(self):
        """A filled pit sits at its spill elevation, so sub-spill water is dry."""
        dem = _pit_dem()
        result = flood_inundation(dem, water_level=80.0, fill_depressions_first=True)
        assert not result.any()
        assert result.dtype == np.bool_

    def test_pit_floods_without_depression_fill(self):
        """Skipping the fill leaves the pit at 60 m, so 80 m water floods it."""
        dem = _pit_dem()
        result = flood_inundation(dem, water_level=80.0, fill_depressions_first=False)
        assert result[4, 4]
        assert result.sum() == 1

    def test_water_above_the_spill_elevation_floods_the_terrace(self):
        """Water above the 100 m rim floods every valid cell, NODATA aside."""
        dem = _pit_dem()
        result = flood_inundation(dem, water_level=120.0, fill_depressions_first=True)
        assert result.sum() == 63
        assert not result[0, 0]

    def test_nodata_cells_are_never_inundated(self):
        """A NODATA cell below the water line stays dry."""
        dem = np.full((4, 4), 50.0, dtype=np.float32)
        dem[1, 1] = NODATA
        result = flood_inundation(dem, water_level=200.0, fill_depressions_first=False)
        assert result.sum() == 15
        assert not result[1, 1]


class TestInundationDepth:
    """inundation_depth above each cell."""

    def test_depth_is_positive_in_an_unfilled_pit(self):
        """With the fill skipped, the pit holds water_level - 60 m of water."""
        dem = _pit_dem()
        result = inundation_depth(dem, water_level=80.0, fill_depressions_first=False)
        assert result.dtype == np.float32
        assert result[4, 4] == pytest.approx(20.0)
        assert result[0, 3] == 0.0  # terrace is above the water line

    def test_depth_clamps_to_zero_above_the_water_line(self):
        """Cells above the water surface report 0 m, never a negative depth."""
        dem = _pit_dem()
        result = inundation_depth(dem, water_level=80.0, fill_depressions_first=True)
        assert (result[~np.isnan(result)] == 0.0).all()
        assert np.isnan(result[0, 0])

    def test_nodata_cells_report_nan_depth(self):
        """NODATA cells are excluded from the depth grid."""
        dem = _pit_dem()
        result = inundation_depth(dem, water_level=120.0, fill_depressions_first=False)
        assert np.isnan(result[0, 0])
        assert result[1, 1] == pytest.approx(20.0)


class TestDepressionDepthStats:
    """depression_depth_stats per labelled depression."""

    def test_requires_scipy(self, monkeypatch):
        """The scipy import is guarded with an actionable ImportError."""
        monkeypatch.setitem(sys.modules, "scipy", None)
        with pytest.raises(ImportError, match="requires scipy"):
            depression_depth_stats(_pit_dem())

    def test_returns_empty_when_nothing_is_labelled(self, monkeypatch):
        """Zero labelled components short-circuits to an empty list.

        The guard is only reachable by stubbing the labeller: a DEM that fills
        anywhere always labels at least one component.
        """

        def no_labels(mask):
            return np.zeros(mask.shape, dtype=np.int32), 0

        monkeypatch.setattr("scipy.ndimage.label", no_labels)
        assert depression_depth_stats(_pit_dem()) == []

    def test_flat_terrain_has_no_depressions(self):
        """Terrain that fills nowhere yields no depression entries."""
        flat = np.full((6, 6), 100.0, dtype=np.float32)
        assert depression_depth_stats(flat) == []

    def test_reports_depth_volume_area_and_spill_for_a_single_pit(self):
        """One 60 m pit in a 100 m terrace reports its storage terms."""
        result = depression_depth_stats(_pit_dem())

        assert len(result) == 1
        entry = result[0]
        assert entry["row"] == 4
        assert entry["col"] == 4
        assert entry["cell_count"] == 1
        assert entry["area_m2"] == pytest.approx(CELL_AREA_M2, abs=0.01)
        assert entry["spill_elev_m"] == pytest.approx(100.0)
        # Water depth after filling is (filled - dem) per cell: 100 - 60 here.
        assert entry["depth_m"] == pytest.approx(40.0)
        assert entry["volume_m3"] == pytest.approx(40.0 * CELL_AREA_M2, rel=1e-6)

    def test_two_depressions_are_both_reported(self):
        """Separate pits are labelled separately, deepest first."""
        dem = np.full((12, 12), 100.0, dtype=np.float32)
        dem[2:5, 2:5] = 60.0  # 40 m deep bowl, 9 cells
        dem[8:11, 8:11] = 20.0  # 80 m deep bowl, 9 cells

        result = depression_depth_stats(dem)

        assert len(result) == 2
        assert {entry["cell_count"] for entry in result} == {9}
        assert {entry["depth_m"] for entry in result} == {40.0, 80.0}
        # Docstring promises "deepest first" — the reverse sort now honours it.
        assert result[0]["depth_m"] == 80.0
        assert result[1]["depth_m"] == 40.0
