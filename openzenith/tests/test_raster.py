"""Tests for openzenith.terrain.raster — raster algebra and band statistics."""

import numpy as np
import pytest

from openzenith.terrain.raster import (
    dem_clip,
    dem_mask,
    dem_reclassify,
    dem_where,
    image_autocorrelation,
    image_correlation,
    integer_division,
    modulo,
    normalized_difference,
)

NODATA = -32768.0


class TestNormalizedDifference:
    def test_basic_range(self):
        a = np.array([[200.0, 100.0], [50.0, 10.0]])
        b = np.array([[100.0, 100.0], [50.0, 30.0]])
        result = normalized_difference(a, b)
        assert result[0, 0] == pytest.approx((200 - 100) / 300, abs=1e-6)
        assert result[1, 1] == pytest.approx((10 - 30) / 40, abs=1e-6)
        assert result.max() <= 1.0 and result.min() >= -1.0

    def test_identical_inputs_are_zero(self):
        a = np.array([[5.0, 7.0]])
        result = normalized_difference(a, a)
        assert np.allclose(result, 0.0)

    def test_nodata_cells_propagate(self):
        a = np.array([[100.0, NODATA]])
        b = np.array([[100.0, 100.0]])
        result = normalized_difference(a, b, nodata=NODATA)
        assert result[0, 0] == pytest.approx(0.0)
        assert result[0, 1] == NODATA


class TestIntegerDivision:
    def test_floor_semantics(self):
        a = np.array([[7.0, -7.0]])
        b = np.array([[2.0, 2.0]])
        result = integer_division(a, b, nodata=NODATA)
        assert result[0, 0] == 3  # floor(3.5)
        assert result[0, 1] == -4  # floor(-3.5)

    def test_zero_denominator_is_nodata(self):
        a = np.array([[10.0, 10.0]])
        b = np.array([[0.0, 2.0]])
        result = integer_division(a, b, nodata=-1)
        assert result[0, 0] == -1
        assert result[0, 1] == 5

    def test_nodata_numerator(self):
        a = np.array([[NODATA]])
        b = np.array([[2.0]])
        result = integer_division(a, b, nodata=NODATA)
        assert result[0, 0] == NODATA


class TestModulo:
    def test_remainder(self):
        a = np.array([[10.0, 7.25]])
        result = modulo(a, 3.0)
        assert result[0, 0] == pytest.approx(1.0)
        assert result[0, 1] == pytest.approx(1.25)

    def test_nodata_cells(self):
        a = np.array([[NODATA, 9.0]])
        result = modulo(a, 4.0, nodata=NODATA)
        assert result[0, 0] == NODATA
        assert result[0, 1] == pytest.approx(1.0)


class TestImageCorrelation:
    def test_global_perfect_positive(self):
        a = np.array([[1.0, 2.0], [3.0, 4.0]])
        b = a * 2.0
        corr = image_correlation(a, b, kernel_size=0)
        assert corr == pytest.approx(1.0)

    def test_global_perfect_negative(self):
        a = np.array([[1.0, 2.0], [3.0, 4.0]])
        b = -a
        corr = image_correlation(a, b, kernel_size=0)
        assert corr == pytest.approx(-1.0)

    def test_all_nodata_is_nan(self):
        a = np.full((4, 4), NODATA)
        b = np.full((4, 4), 1.0)
        assert np.isnan(image_correlation(a, b, kernel_size=0, nodata=NODATA))

    def test_local_window_shape_and_range(self):
        rng = np.random.default_rng(42)
        a = rng.uniform(0, 100, (16, 16))
        b = a * 0.5 + rng.normal(0, 1, (16, 16))
        result = image_correlation(a, b, kernel_size=3, nodata=NODATA)
        assert result.shape == (16, 16)
        valid = result[~np.isnan(result)]
        assert np.all(valid >= -1.001) and np.all(valid <= 1.001)


class TestImageAutocorrelation:
    def test_all_nodata_is_nan(self):
        dem = np.full((4, 4), NODATA)
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result.shape == (4, 4)
        assert np.all(np.isnan(result))

    def test_uniform_grid_has_zero_variance(self):
        dem = np.full((8, 8), 50.0)
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        # var == 0 → I is undefined everywhere; cells stay NaN.
        assert np.all(np.isnan(result))

    def test_nodata_cells_propagate(self):
        dem = np.array([[100.0, 200.0], [300.0, NODATA]])
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result[1, 1] == NODATA
        # Valid cells get real values (hand-computed below), never the
        # pre-implementation silent 0.0.
        assert not np.allclose(result[:2, :1], 0.0)

    def test_hand_computed_2x2_with_nodata(self):
        # dem = [[10, 20], [30, nodata]]: mean 20, var 200/3, z = [-10, 0, 10].
        # The 3x3 window covers the whole grid (edges padded with 0), so every
        # window sum is 0 and each valid cell has 2 valid neighbours:
        #   I(0,0) = (-10 / (200/3)) * ((0 - -10) / 2) = -0.15 * 5   = -0.75
        #   I(0,1) = (   0 / (200/3)) * ((0 -   0) / 2) = 0
        #   I(1,0) = (  10 / (200/3)) * ((0 -  10) / 2) = 0.15 * -5  = -0.75
        # The nodata cell contributes nothing to any neighbourhood (this is
        # what pins the "exclude invalid cells" semantics).
        dem = np.array([[10.0, 20.0], [30.0, NODATA]])
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result[0, 0] == pytest.approx(-0.75, abs=1e-6)
        assert result[0, 1] == pytest.approx(0.0, abs=1e-6)
        assert result[1, 0] == pytest.approx(-0.75, abs=1e-6)
        assert result[1, 1] == NODATA

    def test_isolated_spike_is_negative(self):
        # A single high cell in a low background: the spike disagrees with its
        # neighbourhood → negative local I (the edge/spike signature).
        dem = np.full((7, 7), 100.0)
        dem[3, 3] = 500.0
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result[3, 3] < 0.0

    def test_background_cells_are_positive(self):
        # Same grid, far corner: the cell and all its neighbours sit in the
        # uniform low cluster → positive local I (the cluster signature).
        dem = np.full((7, 7), 100.0)
        dem[3, 3] = 500.0
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result[0, 0] > 0.0

    def test_clustered_block_centers_are_positive(self):
        # A 3x3 high block in a low field: block-interior and deep-background
        # cells agree with their neighbourhoods → positive I on both.
        dem = np.full((9, 9), 100.0)
        dem[3:6, 3:6] = 500.0
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result[4, 4] > 0.0  # block center
        assert result[0, 0] > 0.0  # deep background
        # The ring of low cells directly against the block edge disagrees
        # with part of their neighbourhood → a different response than the
        # deep background.
        assert result[2, 4] != pytest.approx(result[0, 0], abs=1e-6)

    def test_kernel_size_changes_neighbourhood(self):
        # A larger window changes the neighbour means even on a smooth ramp —
        # pin that the parameter actually reaches the computation.
        ramp = np.tile(np.linspace(0.0, 90.0, 10), (10, 1))
        small = image_autocorrelation(ramp, kernel_size=3, nodata=NODATA)
        large = image_autocorrelation(ramp, kernel_size=5, nodata=NODATA)
        assert not np.allclose(small, large)


class TestDemWhereClipMaskReclassify:
    def test_where_selects_by_condition(self):
        cond = np.array([[True, False]])
        result = dem_where(cond, 1.0, 0.0)
        assert result.tolist() == [[1.0, 0.0]]

    def test_clip_preserves_nodata(self):
        dem = np.array([[-100.0, 50.0, 999.0]])
        result = dem_clip(dem, 0.0, 100.0, nodata=NODATA)
        assert result[0, 0] == 0.0
        assert result[0, 1] == 50.0
        assert result[0, 2] == 100.0

    def test_mask_sets_masked_cells(self):
        dem = np.array([[1.0, 2.0]])
        result = dem_mask(dem, np.array([[False, True]]), mask_value=-1.0)
        assert result[0, 0] == 1.0
        assert result[0, 1] == -1.0

    def test_reclassify_classes_and_nodata(self):
        dem = np.array([[50.0, 200.0, 2000.0, NODATA]])
        result = dem_reclassify(dem, [100.0, 500.0], [1.0, 2.0], nodata=NODATA)
        assert result[0, 0] == 1.0  # < 100
        assert result[0, 1] == 2.0  # 100..500
        assert result[0, 2] == 2.0  # above last threshold
        # Nodata cells are excluded from every class and stay NaN (the
        # nodata argument gates exclusion; it is not written to the output).
        assert np.isnan(result[0, 3])
