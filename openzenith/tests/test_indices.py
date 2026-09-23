"""Tests for openzenith.terrain.indices — elevation and classification indices."""

import numpy as np

from openzenith.terrain.indices import (
    annual_heinardh,
    curvature_classification,
    edge_contamination_check,
    elevation_relief_ratio,
    greater_than_height,
    hypsometry,
    mstp,
    pct_above_thresh,
    pct_below_thresh,
    relative_elevation,
    slope_leq,
)

NODATA = -32768.0


def _ramp(rows: int = 8, cols: int = 8) -> np.ndarray:
    return np.tile(np.linspace(100.0, 180.0, cols, dtype=np.float32), (rows, 1))


class TestMstp:
    def test_multiscale_topographic_position_shape(self):
        result = mstp(_ramp())
        assert result.shape == (8, 8)
        assert result.min() >= -1

    def test_nodata_cells_excluded(self):
        dem = _ramp()
        dem[0, :] = NODATA
        result = mstp(dem)
        assert (result[0, :] == -1).all()

    def test_gentle_ramp_classifies_mid_slopes(self):
        result = mstp(_ramp())
        interior = result[3, 1:-1]
        # Ramp interior cells sit between peaks and valleys: mid-slope (2)
        # or the >0.5-TPI fallbacks; never unclassified.
        assert (interior != -1).all()


class TestCurvatureClassification:
    def test_outputs_valid_classes(self):
        dem = _ramp()
        dem[3:5, 3:5] = 60.0  # local pit to provoke concavity
        result = curvature_classification(dem)
        assert result.shape == dem.shape
        assert set(np.unique(result)).issubset({-1, 0, 1, 2, 3, 4})

    def test_nodata_excluded(self):
        dem = _ramp()
        dem[2, :] = NODATA
        result = curvature_classification(dem)
        assert (result[2, :] == -1).all()


class TestHypsometryAndRelative:
    def test_hypsometry_bounds(self):
        h = hypsometry(_ramp())
        assert h.min() >= 0.0
        assert h.max() <= 1.0
        assert np.isfinite(h).all()

    def test_hypsometry_flat_dem_returns_half(self):
        h = hypsometry(np.full((5, 5), 42.0, dtype=np.float32))
        assert (h == 0.5).all()

    def test_relative_elevation_bounds(self):
        r = relative_elevation(_ramp())
        assert r.dtype == np.float32
        assert r.min() == 0.0  # lowest cell
        assert r.max() == 1.0  # highest cell

    def test_relative_elevation_nodata(self):
        dem = _ramp()
        dem[:, -1] = NODATA
        r = relative_elevation(dem)
        assert (r[:, -1] == NODATA).all()
        assert np.isfinite(r[:, :-1]).all()

    def test_flat_dem_relative_is_nan_zero_range(self):
        # e_range == 0 leaves the NaN-initialized grid untouched (no valid
        # relative elevation exists on a featureless plane).
        r = relative_elevation(np.full((4, 4), 7.0, dtype=np.float32))
        assert np.isnan(r).all()


class TestElevationReliefRatio:
    def test_bounds_and_outlet_reference(self):
        ratio = elevation_relief_ratio(_ramp())
        assert ratio.dtype == np.float32
        assert ratio.min() >= 0.0
        assert ratio.max() <= 1.0

    def test_all_nodata_returns_nodata_grid(self):
        dem = np.full((4, 4), NODATA, dtype=np.float32)
        ratio = elevation_relief_ratio(dem)
        assert (ratio == NODATA).all()


class TestThresholdHelpers:
    def test_slope_leq_flags_flat_cells(self):
        # Horn slope is NaN at the grid border, and NaN <= 5 is False, so
        # only the interior is flagged on a flat plateau.
        flat = slope_leq(np.full((5, 5), 10.0, dtype=np.float32))
        assert flat.dtype == np.uint8
        assert (flat[1:-1, 1:-1] == 1).all()
        assert (flat[0, :] == 0).all()

    def test_slope_leq_nodata_zeroed(self):
        dem = np.full((5, 5), 10.0, dtype=np.float32)
        dem[0, :] = NODATA
        result = slope_leq(dem)
        assert (result[0, :] == 0).all()

    def test_greater_than_height(self):
        dem = _ramp()
        above = greater_than_height(dem, height=140.0)
        assert above.dtype == np.uint8
        assert ((above == 1) == (dem > 140.0)).all()

    def test_greater_than_height_nodata_never_above(self):
        dem = _ramp()
        dem[0, :] = 500.0  # high but nodata
        dem[0, :] = NODATA
        assert (greater_than_height(dem, height=0.0)[0, :] == 0).all()

    def test_pct_above_and_below_sum_to_one(self):
        dem = _ramp()
        above = pct_above_thresh(dem, 140.0)
        below = pct_below_thresh(dem, 140.0)
        assert 0.0 <= above <= 1.0
        assert abs((above + below) - 1.0) < 1e-6

    def test_pct_guards_return_zero_without_valid_cells(self):
        dem = np.full((3, 3), NODATA, dtype=np.float32)
        assert pct_above_thresh(dem, 0.0) == 0.0
        assert pct_below_thresh(dem, 0.0) == 0.0


class TestEdgeContamination:
    def test_clean_grid_has_no_contamination(self):
        result = edge_contamination_check(_ramp())
        assert result.dtype == np.uint8
        assert (result == 0).all()

    def test_nodata_neighbor_marks_contaminated(self):
        dem = _ramp()
        dem[4, 4] = NODATA
        result = edge_contamination_check(dem)
        assert result[4, 4] == 0  # nodata cell itself is skipped
        for r, c in [(3, 3), (3, 4), (5, 5)]:
            assert result[r, c] == 1  # 8-neighbors of the hole
        assert result[0, 0] == 0  # far corner unaffected

    def test_boundary_cells_not_contaminated_by_grid_edge(self):
        # The grid border is not nodata; only actual nodata cells contaminate.
        result = edge_contamination_check(_ramp())
        assert result[0, 0] == 0


class TestAnnualHeinardh:
    def test_combines_relative_elevation_with_slope(self):
        h = annual_heinardh(_ramp())
        assert h.shape == (8, 8)
        assert np.isfinite(h[1:-1, 1:-1]).all()
