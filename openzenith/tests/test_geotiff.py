"""Tests for openzenith.geotiff."""

import sys
import tempfile
import warnings
from pathlib import Path

import numpy as np
import pytest

from openzenith.geotiff import (
    export_cog,
    export_geotiff,
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
        """Transform tuple overrides origin_lat/lon/cell_size."""
        meta = grid_to_gtiff_metadata(100, 200, transform=(40.0, -74.0, 0.001, 0.001))
        gt = meta["geotransform"]
        assert gt[0] == -74.0  # lon_min
        assert gt[3] == 40.0  # lat_max

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
        warnings.filterwarnings("ignore", message="invalid value encountered in cast")
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

        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path_zstd = export_cog(dem, f.name, compress="zstd")
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
            path_raw = export_geotiff(dem, f.name, compress="none")
        size_zstd = Path(path_zstd).stat().st_size
        size_raw = Path(path_raw).stat().st_size
        assert size_zstd < size_raw, "zstd should compress better than none"

    def test_empty_overview_levels_violates_cog_contract(self):
        """A COG without overviews is not a COG, so export must refuse."""
        dem = np.full((16, 16), 500, dtype=np.int16)
        with (
            tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f,
            pytest.raises(RuntimeError, match="No overviews built"),
        ):
            export_cog(dem, f.name, overview_levels=[])
        # The tile itself was written before the COG check rejected it
        assert Path(f.name).stat().st_size > 0


class TestExportGeotiffDtypeOverride:
    """The explicit ``dtype`` branch bypasses the float clipping path."""

    def test_dtype_override_writes_int16(self, tmp_path: Path):
        dem = np.array([[100.5, 200.0], [300.0, 400.0]], dtype=np.float32)
        path = export_geotiff(dem, tmp_path / "dtype.tif", dtype="int16")
        import rasterio

        with rasterio.open(path) as src:
            assert src.dtypes[0] == "int16"
            # astype() truncates instead of rounding, unlike the default path
            assert src.read(1)[0, 0] == 100

    def test_dtype_override_clips_out_of_range_values(self, tmp_path: Path):
        """A dtype override clips to the target range like the default path.

        Regression: the override path used a bare ``astype(dtype)``, so
        40000 m wrapped to -25536 instead of clipping to 32767.
        """
        dem = np.array([[40000.0, 100.0]], dtype=np.float32)
        path = export_geotiff(dem, tmp_path / "clip.tif", dtype="int16")
        import rasterio

        with rasterio.open(path) as src:
            assert src.read(1)[0, 0] == 32767
            assert src.read(1)[0, 1] == 100


class TestExportGeotiffFallbacks:
    """Behaviour when rasterio is not installed."""

    @staticmethod
    def _without_rasterio(monkeypatch):
        """Make ``import rasterio`` raise ImportError inside the module."""
        monkeypatch.setitem(sys.modules, "rasterio", None)

    def test_plain_tiff_fallback_without_rasterio(self, tmp_path: Path, monkeypatch):
        """The fallback writes an un-georeferenced signed TIFF via Pillow."""
        from PIL import Image

        # Includes a negative elevation: Pillow's "I;16" mode is UNSIGNED and
        # used to wrap it (-100 -> 65436), so the fallback writes signed
        # 32-bit "I" mode instead.
        dem = np.array([[100, 200], [3000, -100]], dtype=np.int16)
        self._without_rasterio(monkeypatch)
        path = export_geotiff(dem, tmp_path / "plain.tif")
        assert path == tmp_path / "plain.tif"

        img = Image.open(path)
        assert img.mode == "I"
        np.testing.assert_array_equal(np.array(img), dem.astype(np.int32))

    def test_fallback_drops_georeferencing(self, tmp_path: Path, monkeypatch):
        """The fallback output carries no CRS or transform (best-effort only)."""
        import rasterio

        dem = np.full((8, 8), 250, dtype=np.int16)
        self._without_rasterio(monkeypatch)
        path = export_geotiff(dem, tmp_path / "plain.tif", transform=(40.0, -74.0, 0.001, 0.001))
        with pytest.warns(rasterio.errors.NotGeoreferencedWarning):
            src = rasterio.open(path)
        with src:
            assert src.crs is None
            assert src.read(1)[0, 0] == 250

    def test_cog_export_requires_rasterio(self, tmp_path: Path, monkeypatch):
        """COG export has no fallback: it raises with an install hint."""
        dem = np.full((8, 8), 100, dtype=np.int16)
        self._without_rasterio(monkeypatch)
        with pytest.raises(ImportError, match="rasterio required for COG export"):
            export_cog(dem, tmp_path / "cog.tif")
