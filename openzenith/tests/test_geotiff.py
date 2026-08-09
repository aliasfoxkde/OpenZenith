"""Tests for openzenith.geotiff."""

import tempfile
import numpy as np
import pytest

from openzenith.geotiff import (
    export_geotiff,
    export_cog,
    grid_to_gtiff_metadata,
)


class TestGridToGtiffMetadata:
    """Tests for grid_to_gtiff_metadata."""

    def test_basic_metadata(self):
        """Returns required keys with correct values."""
        meta = grid_to_gtiff_metadata(100, 200)
        assert meta["width"] == 200
        assert meta["height"] == 100
        assert meta["nodata"] == -32768.0
        assert meta["crs"] == "EPSG:4326"
        assert len(meta["geotransform"]) == 6

    def test_transform_overrides(self):
        """transform tuple overrides origin_lat/lon/cell_size."""
        meta = grid_to_gtiff_metadata(100, 200, transform=(40.0, -74.0, 0.001, 0.001))
        gt = meta["geotransform"]
        assert gt[0] == -74.0   # lon_min
        assert gt[3] == 40.0    # lat_max

    def test_custom_nodata(self):
        """Custom nodata value is stored."""
        meta = grid_to_gtiff_metadata(100, 200, nodata=-9999.0)
        assert meta["nodata"] == -9999.0


class TestExportGeotiff:
    """Tests for export_geotiff."""

    def test_int16_output(self):
        """GeoTIFF is int16 with nodata embedded."""
        dem = np.array([[100, 110], [105, -32768]], dtype=np.int16)
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path = export_geotiff(dem, f.name)
            import rasterio
            with rasterio.open(path) as src:
                assert src.dtypes[0] == "int16"
                assert src.nodata == -32768.0
                data = src.read(1)
                assert data[0, 0] == 100
                assert data[1, 1] == -32768  # nodata preserved

    def test_float_to_int16_conversion(self):
        """Float32 grid is converted to int16 on export."""
        dem = np.array([[8848.0, 5000.0], [1000.5, -10.3]], dtype=np.float32)
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path = export_geotiff(dem, f.name)
            import rasterio
            with rasterio.open(path) as src:
                assert src.dtypes[0] == "int16"
                data = src.read(1)
                assert data[0, 0] == 8848

    def test_transform(self):
        """GeoTIFF has correct geotransform for EPSG:4326."""
        dem = np.full((100, 200), 1000, dtype=np.int16)
        transform = (40.0, -74.0, 0.001, 0.001)  # lat_max, lon_min, dlat, dlon
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path = export_geotiff(dem, f.name, transform=transform)
            import rasterio
            with rasterio.open(path) as src:
                # Bounds
                assert src.bounds.left == pytest.approx(-74.0)
                assert src.bounds.top == pytest.approx(40.0)
                # CRS
                assert src.crs is not None
                assert "4326" in str(src.crs)

    def test_nodata_pixel_conversion(self):
        """NaN values are converted to nodata on export."""
        dem = np.array([[100.0, np.nan], [200.0, 300.0]], dtype=np.float32)
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path = export_geotiff(dem, f.name)
            import rasterio
            with rasterio.open(path) as src:
                data = src.read(1)
                assert data[0, 1] == -32768  # NaN → nodata

    def test_custom_crs(self):
        """Custom CRS is stored in the output."""
        dem = np.full((10, 10), 100, dtype=np.int16)
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path = export_geotiff(dem, f.name, crs="EPSG:3857")
            import rasterio
            with rasterio.open(path) as src:
                assert "3857" in str(src.crs)


class TestExportCog:
    """Tests for export_cog."""

    def test_cog_has_overviews(self):
        """COG has overview levels."""
        dem = np.full((1024, 1024), 500, dtype=np.int16)
        with tempfile.NamedTemporaryFile(suffix="_cog.tif", delete=False) as f:
            path = export_cog(dem, f.name, overview_levels=[2, 4, 8])
            import rasterio
            with rasterio.open(path) as src:
                ovrs = src.overviews(1)
                assert len(ovrs) >= 3

    def test_cog_zstd_compression(self):
        """COG with zstd compression produces smaller output than uncompressed."""
        dem = np.full((256, 256), 1000, dtype=np.int16)
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path_zstd = export_cog(dem, f.name, compress="zstd")
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path_raw = export_geotiff(dem, f.name, compress="none")
        size_zstd = os.path.getsize(path_zstd)
        size_raw = os.path.getsize(path_raw)
        assert size_zstd < size_raw, "zstd should compress better than none"
