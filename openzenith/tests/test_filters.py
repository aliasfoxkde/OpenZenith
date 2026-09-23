"""Tests for openzenith.terrain.filters.

Targets the functions the #106 ratchet found untested: adaptive_filter,
morphological opening/closing, sieve (including the diagonal-merge
branch that the 8-neighbour scan fix made reachable), and the
feature_preserving_smooth window walk (whose pad bug these tests
regression-guard).
"""

import numpy as np
import pytest

from openzenith.terrain.filters import (
    adaptive_filter,
    closing,
    feature_preserving_smooth,
    opening,
    sieve,
)

NODATA = -32768.0


class TestAdaptiveFilter:
    def test_constant_input_is_preserved_not_nanned(self):
        # Zero-variance terrain gives k = 0 (guarded against 0/0), so a
        # constant DEM passes through unchanged instead of becoming NaN.
        out = adaptive_filter(np.full((9, 9), 50.0, dtype=np.float32))
        assert (out == 50.0).all()

    def test_reduces_noise_on_varying_terrain(self):
        rng = np.random.default_rng(42)
        noisy = 50.0 + rng.normal(0, 5, (15, 15)).astype(np.float32)
        out = adaptive_filter(noisy)
        assert np.isfinite(out).all()
        assert out.std() < noisy.std()

    def test_nodata_cells_get_the_nodata_fill(self):
        rng = np.random.default_rng(7)
        dem = 50.0 + rng.normal(0, 3, (12, 12)).astype(np.float32)
        dem[0, 0] = NODATA
        out = adaptive_filter(dem)
        assert out[0, 0] == NODATA


class TestMorphological:
    def test_opening_removes_a_single_cell_peak(self):
        dem = np.full((7, 7), 100.0, dtype=np.float32)
        dem[3, 3] = 500.0
        out = opening(dem)
        assert out[3, 3] == 100.0
        assert out[0, 0] == 100.0

    def test_closing_fills_a_single_cell_pit(self):
        dem = np.full((7, 7), 100.0, dtype=np.float32)
        dem[3, 3] = 0.0
        out = closing(dem)
        assert out[3, 3] == 100.0
        assert out[0, 0] == 100.0

    def test_nodata_cells_get_the_nodata_fill(self):
        dem = np.full((7, 7), 100.0, dtype=np.float32)
        dem[3, 3] = NODATA
        assert opening(dem)[3, 3] == NODATA
        assert closing(dem)[3, 3] == NODATA


class TestSieve:
    def test_small_feature_merges_with_diagonal_neighbour(self):
        # Single-cell feature at (0,0); its only valid neighbours are
        # diagonal, so the 8-neighbour scan is what makes the merge happen.
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        dem[0, 0] = 999.0
        dem[0, 1] = NODATA
        dem[1, 0] = NODATA
        out = sieve(dem, min_size=2)
        assert out[0, 0] == 100.0

    def test_large_features_are_untouched(self):
        dem = np.full((6, 6), 100.0, dtype=np.float32)
        dem[0, 0] = 999.0
        dem[0, 1] = NODATA
        dem[1, 0] = NODATA
        out = sieve(dem, min_size=2)
        assert out[4, 4] == 100.0

    def test_nodata_cells_are_never_modified(self):
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        dem[0, 0] = NODATA
        dem[0, 1] = NODATA
        dem[1, 0] = NODATA
        out = sieve(dem, min_size=2)
        assert out[0, 0] == NODATA


class TestFeaturePreservingSmooth:
    def test_smoothing_a_full_window_no_longer_crashes(self):
        # Regression: the pad was one cell short, so any window reaching the
        # last row/column raised IndexError. Keep the grid big enough that
        # the window reaches the bottom-right corner.
        dem = np.full((12, 12), 100.0, dtype=np.float32)
        dem[6, 6] = 220.0
        out = feature_preserving_smooth(dem, filter_size=5, max_diff=2.0)
        assert out.dtype == np.float32
        assert out[6, 6] < 220.0
        assert out[0, 0] == pytest.approx(100.0)

    def test_isolated_window_point_uses_infinite_range_weight(self):
        # A window point whose own 3×3 holds <2 valid cells gets an inf
        # range, zero weight — the walk must still terminate correctly.
        dem = np.full((7, 7), NODATA, dtype=np.float32)
        dem[3, 3] = 100.0
        dem[2, 2] = 100.0
        out = feature_preserving_smooth(dem, filter_size=3, max_diff=1e9)
        assert out[3, 3] == pytest.approx(100.0)
        assert out[0, 0] == NODATA

    def test_nodata_cells_pass_through_unchanged(self):
        dem = np.full((8, 8), 100.0, dtype=np.float32)
        dem[0, 0] = NODATA
        out = feature_preserving_smooth(dem, filter_size=3, max_diff=2.0)
        assert out[0, 0] == NODATA

    def test_single_valid_cell_freezes_and_empty_windows_skip(self):
        # With one valid cell, its window point's own 3x3 holds <2 valid
        # cells -> infinite range -> zero weight -> the value passes through.
        # Windows containing no valid cells at all are skipped entirely, so
        # every NODATA cell stays NODATA.
        dem = np.full((5, 5), NODATA, dtype=np.float32)
        dem[0, 0] = 100.0
        out = feature_preserving_smooth(dem, filter_size=3, max_diff=1e9)
        assert out[0, 0] == 100.0
        assert out[1, 1] == NODATA
        assert out[2, 2] == NODATA
