"""Tests for the uncovered gradient derivatives.

gaussian_curvature, horizontal_curvature, convergence_index,
edge_density, and downslope_index — the five functions the #106
ratchet found untested. Interior-only finiteness assertions match the
Horn-slope NaN boundary convention pinned in test_terrain.py.
"""

import numpy as np
import pytest

from openzenith.terrain.gradients import (
    aspect,
    convergence_index,
    downslope_index,
    edge_density,
    gaussian_curvature,
    horizontal_curvature,
    slope,
)

NODATA = -32768.0


@pytest.fixture
def east_ramp() -> np.ndarray:
    return np.tile((np.arange(10, dtype=np.float32) * 10.0), (10, 1))


class TestGaussianCurvature:
    def test_paraboloid_has_positive_elliptic_curvature(self):
        rows = cols = 10
        y, x = np.mgrid[0:rows, 0:cols]
        par = ((x - 4.5) ** 2 + (y - 4.5) ** 2).astype(np.float32) * 2.0
        k = gaussian_curvature(par)
        assert np.isfinite(k[2:8, 2:8]).all()
        assert k[4, 4] > 0.0

    def test_flat_surface_has_zero_curvature(self):
        k = gaussian_curvature(np.full((8, 8), 5.0, dtype=np.float32))
        assert k[3, 3] == 0.0

    def test_nodata_cells_get_the_nodata_fill(self):
        dem = np.full((8, 8), 50.0, dtype=np.float32)
        dem[0, 0] = NODATA
        k = gaussian_curvature(dem)
        assert k[0, 0] == NODATA


class TestHorizontalCurvature:
    def test_ramp_interior_is_finite_and_zero(self, east_ramp):
        # A pure east-west ramp has aspect 90/270, so sin(2*aspect) ~ 0.
        hc = horizontal_curvature(east_ramp)
        assert np.isfinite(hc[2:8, 1:9]).all()
        assert hc[4, 4] == pytest.approx(0.0, abs=1e-6)

    def test_flat_surface_is_nan(self):
        hc = horizontal_curvature(np.full((8, 8), 50.0, dtype=np.float32))
        assert np.isnan(hc[3, 3])

    def test_nodata_cells_get_the_nodata_fill(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[0, 0] = NODATA
        hc = horizontal_curvature(ramp)
        assert hc[0, 0] == NODATA


class TestConvergenceIndex:
    def test_self_consistent_with_slope_and_aspect(self, east_ramp):
        ci = convergence_index(east_ramp)
        slp = slope(east_ramp)
        asp = aspect(east_ramp)
        expect = np.log(np.tan(np.deg2rad(np.maximum(slp[4, 4], 0.01)))) + np.radians(asp[4, 4])
        assert np.isfinite(ci[2:8, 1:9]).all()
        assert ci[4, 4] == pytest.approx(expect, rel=1e-5)

    def test_nodata_cells_get_the_nodata_fill(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        ci = convergence_index(ramp)
        assert ci[5, 5] == NODATA


class TestEdgeDensity:
    def test_ramp_max_neighbor_difference(self, east_ramp):
        ed = edge_density(east_ramp)
        assert ed[4, 4] == pytest.approx(10.0)
        assert ed[4, 3] == pytest.approx(10.0)

    def test_flat_surface_has_zero_density(self):
        ed = edge_density(np.full((6, 6), 7.0, dtype=np.float32))
        assert ed[3, 3] == 0.0

    def test_nodata_cells_get_the_nodata_fill(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        ed = edge_density(ramp)
        assert ed[5, 5] == NODATA


class TestDownslopeIndex:
    def test_self_consistent_with_slope(self, east_ramp):
        di = downslope_index(east_ramp)
        slp = slope(east_ramp)
        expect = np.log(np.tan(np.deg2rad(max(slp[4, 4], 0.001))))
        assert np.isfinite(di[2:8, 1:9]).all()
        assert di[4, 4] == pytest.approx(expect, rel=1e-5)

    def test_nodata_cells_get_the_nodata_fill(self, east_ramp):
        ramp = east_ramp.copy()
        ramp[5, 5] = NODATA
        di = downslope_index(ramp)
        assert di[5, 5] == NODATA
