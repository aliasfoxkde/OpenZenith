"""Tests for OpenZenith Python SDK — terrain module."""

import math
import numpy as np
import pytest

from openzenith.terrain import slope, slope_fast, aspect, hillshade, viewshed, profile, tpi, roughness, curvature, tri


def make_slope_dem(rows=10, cols=10):
    """Uniform slope: increases 10m per cell from top-left to bottom-right."""
    dem = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            dem[r, c] = (r + c) * 10.0
    return dem


class TestSlope:
    def test_flat_surface(self):
        """Flat surface should have 0° slope."""
        dem = np.ones((5, 5), dtype=np.float32) * 100.0
        s = slope_fast(dem, cell_size_deg=0.001)
        assert np.nanmax(s) < 1.0, "Flat surface should have near-zero slope"

    def test_steep_slope(self):
        """Slope should increase with elevation gradient."""
        dem = np.zeros((10, 10), dtype=np.float32)
        for r in range(10):
            dem[r, :] = r * 100.0  # 100m rise per cell
        s = slope_fast(dem, cell_size_deg=0.001)
        center = s[5, 5]
        assert not np.isnan(center)
        # 100m rise over ~111m horizontal = ~42°
        assert 30 < center < 50, f"Expected steep slope, got {center:.1f}°"

    def test_nodata_handling(self):
        """NODATA cells should get NaN slope."""
        dem = make_slope_dem()
        dem[0, 0] = -32768.0
        s = slope_fast(dem, cell_size_deg=0.001)
        assert np.isnan(s[0, 0])

    def test_fast_matches_horn(self):
        """slope_fast should be close to slope() for smooth surfaces."""
        dem = make_slope_dem(20, 20)
        s_slow = slope(dem, cell_size_deg=0.001)
        s_fast = slope_fast(dem, cell_size_deg=0.001)
        diff = np.abs(s_slow - s_fast)
        valid = ~np.isnan(diff) & (diff > 0)
        if valid.any():
            # Should be within ~5° on smooth terrain
            assert np.percentile(diff[valid], 90) < 5, "Fast slope should approximate Horn's method"


class TestAspect:
    def test_north_facing(self):
        """Slope going south (higher to south) faces north (downhill = north = 0°)."""
        dem = np.zeros((10, 10), dtype=np.float32)
        for r in range(10):
            dem[r, :] = r * 100.0
        a = aspect(dem, cell_size_deg=0.001)
        center = a[5, 5]
        assert not np.isnan(center)
        assert center < 30 or center > 330, f"Expected ~0° (north), got {center:.1f}°"

    def test_east_facing(self):
        """Slope going east (higher to east) faces west (downhill = west = 270°)."""
        dem = np.zeros((10, 10), dtype=np.float32)
        for c in range(10):
            dem[:, c] = c * 100.0
        a = aspect(dem, cell_size_deg=0.001)
        center = a[5, 5]
        assert not np.isnan(center)
        assert 240 < center < 300, f"Expected ~270° (west), got {center:.1f}°"

    def test_flat_nan(self):
        """Flat area should give NaN aspect."""
        dem = np.ones((5, 5), dtype=np.float32) * 100.0
        a = aspect(dem, cell_size_deg=0.001)
        assert np.isnan(a[2, 2])


class TestHillshade:
    def test_output_range(self):
        """Hillshade should be 0-255 uint8."""
        dem = make_slope_dem(20, 20)
        hs = hillshade(dem, azimuth=315, altitude=45, cell_size_deg=0.001)
        assert hs.dtype == np.uint8
        assert hs.min() >= 0
        assert hs.max() <= 255

    def test_different_azimuths(self):
        """Different light directions should produce different results."""
        dem = make_slope_dem(20, 20)
        hs_nw = hillshade(dem, azimuth=315, altitude=45, cell_size_deg=0.001)
        hs_se = hillshade(dem, azimuth=135, altitude=45, cell_size_deg=0.001)
        # Should differ in at least some cells
        diff = np.sum(hs_nw != hs_se)
        assert diff > 0, "Different azimuths should produce different shading"

    def test_nodata_zero(self):
        """NODATA cells should be 0 in hillshade."""
        dem = make_slope_dem(10, 10)
        dem[5, 5] = -32768.0
        hs = hillshade(dem, azimuth=315, altitude=45, cell_size_deg=0.001)
        assert hs[5, 5] == 0


class TestViewshed:
    def test_observer_visible(self):
        """Observer position should always be visible."""
        dem = make_slope_dem(10, 10)
        vs = viewshed(dem, observer_row=5, observer_col=5, cell_size_deg=0.001)
        assert vs[5, 5]

    def test_flat_all_visible(self):
        """On a flat surface, all cells should be visible."""
        dem = np.ones((10, 10), dtype=np.float32) * 100.0
        vs = viewshed(dem, observer_row=5, observer_col=5, observer_height=2.0, cell_size_deg=0.001)
        assert vs.all()

    def test_behind_ridge(self):
        """Cells behind a ridge should not be visible."""
        dem = np.ones((20, 20), dtype=np.float32) * 100.0
        # Add a ridge in the middle
        for r in range(8, 12):
            for c in range(20):
                dem[r, c] = 200.0
        # Observer at north edge
        vs = viewshed(dem, observer_row=0, observer_col=10, observer_height=2.0, cell_size_deg=0.001)
        # Cells behind the ridge should be hidden
        assert not vs[15, 10], "Cell behind ridge should not be visible"

    def test_max_distance(self):
        """max_distance_cells should limit the viewshed."""
        dem = np.ones((20, 20), dtype=np.float32) * 100.0
        vs = viewshed(dem, observer_row=10, observer_col=10, max_distance_cells=3, cell_size_deg=0.001)
        # Only cells within 3 cell distances should be visible
        for r in range(20):
            for c in range(20):
                dist = math.sqrt((r - 10) ** 2 + (c - 10) ** 2)
                if dist > 4.5:  # With some tolerance for diagonal
                    assert not vs[r, c], f"Cell ({r},{c}) at dist {dist:.1f} should not be visible"


class TestProfile:
    def test_flat_profile(self):
        """Profile along flat terrain should have constant elevation."""
        dem = np.ones((10, 10), dtype=np.float32) * 100.0
        points = [(0, 0), (0, 5), (0, 9)]
        p = profile(dem, points, cell_size_deg=0.001)
        assert len(p) == 3
        assert all(pt["elevation"] == 100.0 for pt in p)
        assert p[0]["distance_m"] == 0.0
        assert p[-1]["distance_m"] > p[0]["distance_m"]

    def test_increasing_profile(self):
        """Profile along a slope should have increasing distances."""
        dem = make_slope_dem(10, 10)
        points = [(0, 0), (5, 0), (9, 0)]
        p = profile(dem, points, cell_size_deg=0.001)
        assert len(p) == 3
        assert p[0]["distance_m"] < p[1]["distance_m"] < p[2]["distance_m"]

    def test_single_point(self):
        """Profile with single point should return empty."""
        dem = np.ones((5, 5), dtype=np.float32)
        assert profile(dem, [(2, 2)], cell_size_deg=0.001) == []


class TestTPI:
    """Tests for Topographic Position Index."""

    def test_flat_dem_zero_tpi(self):
        """Flat terrain should have TPI ≈ 0 everywhere."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = tpi(dem)
        assert np.allclose(result[1:-1, 1:-1], 0.0, atol=1e-6)

    def test_peak_positive(self):
        """A peak should have positive TPI at center."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        dem[10, 10] = 200.0
        result = tpi(dem)
        assert result[10, 10] > 50  # peak is much higher than neighbors

    def test_valley_negative(self):
        """A depression should have negative TPI at center."""
        dem = np.full((20, 20), 200.0, dtype=np.float32)
        dem[10, 10] = 100.0
        result = tpi(dem)
        assert result[10, 10] < -50  # valley is much lower than neighbors

    def test_output_shape(self):
        """Output should match input shape."""
        dem = np.random.rand(50, 50).astype(np.float32) * 500 + 100
        result = tpi(dem)
        assert result.shape == (50, 50)


class TestRoughness:
    """Tests for Terrain Roughness Index."""

    def test_flat_dem_zero_roughness(self):
        """Flat terrain should have zero roughness."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = roughness(dem)
        assert np.allclose(result[1:-1, 1:-1], 0.0, atol=1e-6)

    def test_rough_terrain_higher(self):
        """Random terrain should have non-zero roughness."""
        np.random.seed(42)
        dem = np.random.rand(50, 50).astype(np.float32) * 500 + 100
        result = roughness(dem)
        inner = result[1:-1, 1:-1]
        assert np.nanmean(inner) > 0

    def test_steep_gradient(self):
        """Uniform slope should have consistent roughness."""
        dem = np.zeros((20, 20), dtype=np.float32)
        for i in range(20):
            dem[i, :] = i * 10.0
        result = roughness(dem)
        inner = result[1:-1, 1:-1]
        # Uniform slope: roughness should be constant
        std = np.nanstd(inner)
        assert std < 1.0  # nearly uniform


class TestCurvature:
    """Tests for Mean Curvature."""

    def test_flat_dem_zero_curvature(self):
        """Flat terrain should have near-zero curvature."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = curvature(dem)
        assert np.allclose(result[1:-1, 1:-1], 0.0, atol=1e-6)

    def test_output_shape(self):
        """Output should match input shape."""
        dem = np.random.rand(30, 30).astype(np.float32) * 500 + 100
        result = curvature(dem)
        assert result.shape == (30, 30)


class TestTRI:
    """Tests for Terrain Ruggedness Index."""

    def test_flat_dem_zero_tri(self):
        """Flat terrain should have TRI ≈ 0."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = tri(dem)
        assert np.allclose(result[1:-1, 1:-1], 0.0, atol=1e-6)

    def test_peak_high_tri(self):
        """A peak should have high TRI at center."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        dem[10, 10] = 200.0
        result = tri(dem)
        assert result[10, 10] > 40

    def test_output_shape(self):
        """Output should match input shape."""
        dem = np.random.rand(40, 40).astype(np.float32) * 500 + 100
        result = tri(dem)
        assert result.shape == (40, 40)

    def test_tri_positive(self):
        """TRI should always be non-negative."""
        dem = np.random.rand(30, 30).astype(np.float32) * 500 + 100
        result = tri(dem)
        inner = result[1:-1, 1:-1]
        assert np.all(inner[~np.isnan(inner)] >= 0)
