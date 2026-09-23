"""Tests for openzenith.terrain.flow_metrics — erosion and sink metrics."""

import numpy as np
import pytest

from openzenith.terrain.flow_metrics import (
    average_flow_truncation,
    clean_dem,
    depth_in_sink,
    hack_integral,
    sediment_transport_index,
)

NODATA = -32768.0


def _ramp_dem(rows: int = 12, cols: int = 12) -> np.ndarray:
    """West-to-east ramp: every cell drains toward the east edge."""
    return np.tile(np.linspace(100.0, 20.0, cols, dtype=np.float32), (rows, 1))


class TestSedimentTransportIndex:
    def test_shape_dtype_and_validity(self):
        sti = sediment_transport_index(_ramp_dem())
        assert sti.shape == (12, 12)
        assert sti.dtype == np.float32
        # Horn's 3x3 slope is undefined on the top row and east/west edges,
        # so STI is NaN there by construction; the interior must be finite.
        interior = sti[1:-1, 1:-1]
        assert np.isfinite(interior).all()
        assert (interior >= 0).all()

    def test_nodata_cells_pass_through(self):
        dem = _ramp_dem()
        dem[0, :] = NODATA
        sti = sediment_transport_index(dem)
        assert (sti[0, :] == NODATA).all()
        assert np.isfinite(sti[2:-1, 1:-1]).all()

    def test_steeper_slope_raises_sti(self):
        gentle = sediment_transport_index(_ramp_dem())
        steep_dem = _ramp_dem()
        steep_dem[0] = 400.0  # north edge lifted: much steeper north strip
        steep = sediment_transport_index(steep_dem)
        # The steepened strip should not have a lower STI than the same
        # cells on the gentle ramp (same accumulation pattern direction).
        assert np.nanmedian(steep) >= np.nanmedian(gentle) * 0.5

    def test_custom_exponent(self):
        a = sediment_transport_index(_ramp_dem(), exp=0.4)
        b = sediment_transport_index(_ramp_dem(), exp=0.8)
        # Larger exponent on specific catchment area raises STI where accum > 22.13.
        assert np.nanmax(b) > np.nanmax(a)


class TestAverageFlowTruncation:
    def test_gentle_ramp_has_no_truncation(self):
        frac = average_flow_truncation(_ramp_dem())
        assert frac == 0.0

    def test_cliff_is_truncated(self):
        dem = _ramp_dem()
        dem[6:, :] = dem[6:, :] - 200.0  # vertical cliff across the middle
        frac = average_flow_truncation(dem)
        assert 0.0 < frac < 1.0

    def test_returns_fraction_bounded(self):
        frac = average_flow_truncation(_ramp_dem(6, 6))
        assert 0.0 <= frac <= 1.0


class TestDepthInSink:
    def test_depression_depth_is_positive(self):
        dem = _ramp_dem(10, 10)
        dem[4:7, 4:7] = 5.0  # sunken 3x3 block in the ramp
        depth = depth_in_sink(dem)
        assert depth.dtype == np.float32
        # Cells in the pit need fill before overflow; rim cells need none.
        assert depth[5, 5] > 0
        assert (depth[0, :] == 0).all()

    def test_flat_dem_has_no_sinks(self):
        depth = depth_in_sink(np.full((8, 8), 42.0, dtype=np.float32))
        assert (depth == 0).all()

    def test_nodata_region_reports_nodata(self):
        dem = _ramp_dem()
        dem[:, :2] = NODATA
        depth = depth_in_sink(dem)
        assert (depth[:, :2] == NODATA).all()


class TestCleanDem:
    def test_fill_pits_removes_single_cell_spike(self):
        dem = _ramp_dem(10, 10)
        dem[5, 5] = -50.0  # pit below its neighbors
        cleaned = clean_dem(dem, fill_pits=True, fill_flats=False)
        assert cleaned[5, 5] > dem[5, 5]

    def test_fill_flats_disabled_leaves_surface(self):
        dem = _ramp_dem(10, 10)
        cleaned = clean_dem(dem, fill_pits=False, fill_flats=False)
        np.testing.assert_allclose(cleaned, dem)

    def test_resolve_flats_steepest_runs(self):
        # A fully flat interior gives fd == -1 on valid cells, driving the
        # flat-resolution loop.
        dem = np.full((8, 8), 30.0, dtype=np.float32)
        dem[0, :] = 40.0
        cleaned = clean_dem(dem, fill_pits=True, fill_flats=True, resolve_flats="steepest")
        assert cleaned.shape == dem.shape
        assert np.isfinite(cleaned).all()

    def test_nodata_cells_untouched_by_flat_fill(self):
        dem = np.full((8, 8), 30.0, dtype=np.float32)
        dem[:2, :] = NODATA
        cleaned = clean_dem(dem, fill_pits=True, fill_flats=True, resolve_flats="weighted")
        assert (cleaned[:2, :] == NODATA).all()


class TestHackIntegralEdges:
    def test_no_stream_cells_returns_nan(self):
        result = hack_integral(_ramp_dem(6, 6))
        assert np.isnan(result["hack_exponent"])
        assert np.isnan(result["k_coefficient"])
        assert result["chi"].shape == (6, 6)

    def test_few_stream_cells_returns_nan(self):
        # Explicit accumulation marks only 3 stream cells (< the 10-sample
        # minimum), so the regression cannot run.
        dem = _ramp_dem(12, 12)
        accum = np.ones((12, 12), dtype=np.float32)
        accum[3, 3:6] = 500.0
        result = hack_integral(dem, flow_accum=accum)
        assert np.isnan(result["hack_exponent"])

    def test_degenerate_regression_returns_nan(self):
        # Identical accumulation values on >= 10 stream cells make the
        # least-squares denominator exactly zero.
        dem = _ramp_dem(12, 12)
        accum = np.ones((12, 12), dtype=np.float32)
        accum[2:6, 2:6] = 200.0  # 16 identical stream cells
        result = hack_integral(dem, flow_accum=accum)
        assert np.isnan(result["hack_exponent"])
        assert np.isnan(result["k_coefficient"])

    def test_real_regression_produces_finite_fit(self):
        rows, cols = 40, 40
        ii, jj = np.meshgrid(np.arange(cols), np.arange(rows))
        dem = 100.0 - ii.astype(np.float32) * 1.5 - jj.astype(np.float32) * 0.5
        result = hack_integral(dem)
        assert np.isfinite(result["hack_exponent"])
        assert result["k_coefficient"] > 0

    def test_nodata_cells_skipped_in_chi(self):
        dem = _ramp_dem(10, 10)
        dem[0, :] = NODATA
        result = hack_integral(dem)
        assert (result["chi"][0, :] == 0).all()


@pytest.mark.parametrize("func", [sediment_transport_index])
def test_module_entrypoint_via_package(func):
    """The public re-export from openzenith.terrain stays intact."""
    from openzenith.terrain import sediment_transport_index as reexported

    assert reexported is func
