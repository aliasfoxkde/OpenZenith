"""Tests for openzenith.converter (GeoTIFF to OZT1 converter)."""

import json
import os
import struct
import tempfile

import numpy as np
import pytest
from numpy.testing import assert_array_equal

from openzenith.tile_format import (
    COMP_ZSTD,
    COMP_ZSTD_PREDICT,
    decode,
)


class TestConvertTile:
    """Test the convert_tile function with synthetic GeoTIFF inputs."""

    def _write_synthetic_geotiff(self, path, shape=(256, 256), min_e=0, max_e=2000, seed=42):
        """Write a minimal GeoTIFF file with synthetic elevation data."""
        try:
            import rasterio
        except ImportError:
            pytest.skip("rasterio not available")

        rng = np.random.RandomState(seed)
        arr = rng.randint(min_e, max_e + 1, size=shape).astype(np.int16)
        # Add some nodata
        mask = rng.random(shape) < 0.02
        arr[mask] = -32768

        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=shape[0],
            width=shape[1],
            count=1,
            dtype=np.int16,
            nodata=-32768,
            crs="EPSG:4326",
            transform=rasterio.transform.from_bounds(0, 1, 1, 0, shape[1], shape[0]),
        ) as dst:
            dst.write(arr, 1)
        return arr

    def test_convert_creates_output_file(self):
        """convert_tile should create .ozt1 output file."""
        try:
            from openzenith.converter import convert_tile
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            src = os.path.join(tmpdir, "N00E000.tif")
            arr = self._write_synthetic_geotiff(src)
            result = convert_tile(src, tmpdir, compression=COMP_ZSTD_PREDICT, zstd_level=3)

            assert os.path.exists(os.path.join(tmpdir, "N00E000.ozt1"))
            assert result["verified"] is True
            assert result["source_bytes"] > 0
            assert result["output_bytes"] > 0
            assert result["reduction_pct"] > 0

    def test_convert_roundtrip(self):
        """Converted tile should decode to original data."""
        try:
            from openzenith.converter import convert_tile
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            src = os.path.join(tmpdir, "N00E000.tif")
            original = self._write_synthetic_geotiff(src, seed=99)
            convert_tile(src, tmpdir, compression=COMP_ZSTD_PREDICT, zstd_level=3)

            with open(os.path.join(tmpdir, "N00E000.ozt1"), "rb") as f:
                encoded = f.read()
            decoded, _ = decode(encoded)
            assert_array_equal(original, decoded)

    def test_convert_metadata(self):
        """Conversion result should have expected metadata fields."""
        try:
            from openzenith.converter import convert_tile
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            src = os.path.join(tmpdir, "N40W074.tif")
            self._write_synthetic_geotiff(src, min_e=-50, max_e=500)
            result = convert_tile(src, tmpdir, zstd_level=5)

            assert "source" in result
            assert "output" in result
            assert "reduction_pct" in result
            assert "compression_ratio" in result
            assert "shape" in result
            assert "bounds" in result
            assert "terrain_type" in result
            assert "elevation_range" in result
            assert result["shape"] == [256, 256]
            assert result["zstd_level"] == 5


class TestConvertDirectory:
    """Test the convert_directory function."""

    def test_convert_multiple_files(self):
        """convert_directory should process multiple tiles."""
        try:
            from openzenith.converter import convert_directory
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as src_dir:
            with tempfile.TemporaryDirectory() as dst_dir:
                # Create 3 synthetic tiles
                for i, name in enumerate(["N00E000.tif", "N01E000.tif", "N02E000.tif"]):
                    path = os.path.join(src_dir, name)
                    try:
                        self._write_synthetic_geotiff(path, seed=i * 10)
                    except Exception:
                        pytest.skip("rasterio not available")

                results = convert_directory(src_dir, dst_dir, max_tiles=3, zstd_level=3)

                assert len(results) == 3
                assert all("error" not in r for r in results)
                assert os.path.exists(os.path.join(dst_dir, "N00E000.ozt1"))
                assert os.path.exists(os.path.join(dst_dir, "N01E000.ozt1"))
                assert os.path.exists(os.path.join(dst_dir, "N02E000.ozt1"))

    def test_convert_with_manifest(self):
        """convert_directory should create a manifest.json."""
        try:
            from openzenith.converter import convert_directory
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as src_dir:
            with tempfile.TemporaryDirectory() as dst_dir:
                path = os.path.join(src_dir, "N00E000.tif")
                try:
                    self._write_synthetic_geotiff(path)
                except Exception:
                    pytest.skip("rasterio not available")

                convert_directory(src_dir, dst_dir, zstd_level=3)

                manifest_path = os.path.join(dst_dir, "manifest.json")
                assert os.path.exists(manifest_path)
                with open(manifest_path) as f:
                    manifest = json.load(f)
                assert manifest["tiles_converted"] == 1
                assert "total_reduction_pct" in manifest


class TestConverterEdgeCases:
    """Test converter edge cases."""

    def _write_synthetic_geotiff(self, path, shape=(256, 256), min_e=0, max_e=2000, seed=42):
        """Write a minimal GeoTIFF file with synthetic elevation data."""
        try:
            import rasterio
        except ImportError:
            pytest.skip("rasterio not available")

        rng = np.random.RandomState(seed)
        arr = rng.randint(min_e, max_e + 1, size=shape).astype(np.int16)
        mask = rng.random(shape) < 0.02
        arr[mask] = -32768

        with rasterio.open(
            path, "w", driver="GTiff", height=shape[0], width=shape[1],
            count=1, dtype=np.int16, nodata=-32768, crs="EPSG:4326",
            transform=rasterio.transform.from_bounds(0, 1, 1, 0, shape[1], shape[0]),
        ) as dst:
            dst.write(arr, 1)
        return arr

    def test_convert_quantized(self):
        """Quantized conversion should produce smaller output."""
        try:
            from openzenith.converter import convert_tile
        except ImportError:
            pytest.skip("converter module not available")

        with tempfile.TemporaryDirectory() as tmpdir:
            src = os.path.join(tmpdir, "N00E000.tif")
            self._write_synthetic_geotiff(src, min_e=0, max_e=3000)

            result_lossless = convert_tile(src, tmpdir, quantize_bits=None, zstd_level=3)
            result_q8 = convert_tile(src, tmpdir, quantize_bits=8, zstd_level=3)

            # 8-bit should be smaller than lossless
            assert result_q8["output_bytes"] < result_lossless["output_bytes"]
            # 8-bit should have some RMSE
            assert result_q8["rmse"] > 0
