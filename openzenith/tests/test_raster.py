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
    def test_output_shape_and_nodata(self):
        dem = np.array([[10.0, 20.0], [30.0, NODATA]])
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        assert result.shape == (2, 2)
        # Valid cells are assigned (currently 0.0); nodata cells propagate.
        assert result[0, 0] == 0.0
        assert result[1, 1] == NODATA

    def test_uniform_grid_has_zero_variance(self):
        dem = np.full((8, 8), 50.0)
        result = image_autocorrelation(dem, kernel_size=3, nodata=NODATA)
        # var == 0 → the (valid & var>0) branch never fires; cells stay NaN.
        assert np.all(np.isnan(result))


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
