"""Tests for openzenith.converter (GeoTIFF to OZT1 converter)."""

import json

import numpy as np
import pytest
from numpy.testing import assert_array_equal

from openzenith.tile_format import (
    COMP_ZSTD_PREDICT,
    decode,
)

# Smaller tiles keep the encode/decode loops fast without changing behaviour.
TILE_SHAPE = (64, 64)


def _write_synthetic_geotiff(path, shape=TILE_SHAPE, min_e=0, max_e=2000, seed=42):
    """Write a minimal GeoTIFF file with synthetic elevation data."""
    rasterio = pytest.importorskip("rasterio")

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


class TestConvertTile:
    """Test the convert_tile function with synthetic GeoTIFF inputs."""

    def test_convert_creates_output_file(self, tmp_path):
        """convert_tile should create .ozt1 output file."""
        from openzenith.converter import convert_tile

        src = tmp_path / "N00E000.tif"
        _write_synthetic_geotiff(src)
        result = convert_tile(src, tmp_path, compression=COMP_ZSTD_PREDICT, zstd_level=3)

        assert (tmp_path / "N00E000.ozt1").exists()
        assert result["verified"] is True
        assert result["rmse"] == 0.0
        assert result["source_bytes"] > 0
        assert result["output_bytes"] > 0
        assert result["reduction_pct"] > 0

    def test_convert_roundtrip(self, tmp_path):
        """Converted tile should decode to original data."""
        from openzenith.converter import convert_tile

        src = tmp_path / "N00E000.tif"
        original = _write_synthetic_geotiff(src, seed=99)
        convert_tile(src, tmp_path, compression=COMP_ZSTD_PREDICT, zstd_level=3)

        with (tmp_path / "N00E000.ozt1").open("rb") as f:
            encoded = f.read()
        decoded, _ = decode(encoded)
        assert_array_equal(original, decoded)

    def test_convert_metadata(self, tmp_path):
        """Conversion result should have expected metadata fields."""
        from openzenith.converter import convert_tile

        src = tmp_path / "N40W074.tif"
        _write_synthetic_geotiff(src, min_e=-50, max_e=500)
        result = convert_tile(src, tmp_path, zstd_level=5)

        assert "source" in result
        assert "output" in result
        assert "reduction_pct" in result
        assert "compression_ratio" in result
        assert "shape" in result
        assert "bounds" in result
        assert "terrain_type" in result
        assert "elevation_range" in result
        assert result["shape"] == list(TILE_SHAPE)
        assert result["zstd_level"] == 5
        # Bounds parsed from the SRTM filename
        assert result["bounds"] == {
            "lat_min": 40,
            "lon_min": -75,
            "lat_max": 41,
            "lon_max": -74,
        }

    def test_convert_without_verify_skips_roundtrip(self, tmp_path):
        """verify=False leaves verified False and reports the raw mode."""
        from openzenith.converter import convert_tile

        src = tmp_path / "N00E000.tif"
        _write_synthetic_geotiff(src)
        result = convert_tile(src, tmp_path, zstd_level=3, verify=False)

        assert result["verified"] is False
        assert result["rmse"] == 0.0
        assert str(COMP_ZSTD_PREDICT) in result["compression"]

    def test_convert_quantized_reports_rmse(self, tmp_path):
        """Quantized conversion reports a nonzero RMSE and stays verified."""
        from openzenith.converter import convert_tile

        src = tmp_path / "N00E000.tif"
        _write_synthetic_geotiff(src, min_e=0, max_e=3000)
        result = convert_tile(src, tmp_path, quantize_bits=8, zstd_level=3)

        assert result["verified"] is True
        assert result["rmse"] > 0
        assert result["quantize_bits"] == 8

    def test_lossless_mismatch_sets_rmse_and_warns(self, tmp_path, monkeypatch):
        """A lossless round-trip mismatch is surfaced, not hidden."""
        import openzenith.converter as converter_mod

        src = tmp_path / "N00E000.tif"
        original = _write_synthetic_geotiff(src, seed=7)

        def corrupt_decode(encoded):
            # Flip one value so array_equal fails and RMSE reports the delta
            decoded = original.copy()
            decoded[0, 0] = decoded[0, 0] + 25
            return decoded, {"compression_name": "zstd-predict"}

        monkeypatch.setattr(converter_mod, "decode", corrupt_decode)
        result = converter_mod.convert_tile(src, tmp_path, zstd_level=3)

        assert result["verified"] is False
        assert result["rmse"] == 25.0


class TestConvertDirectory:
    """Test the convert_directory function."""

    def test_convert_multiple_files(self, tmp_path):
        """convert_directory should process multiple tiles."""
        from openzenith.converter import convert_directory

        src_dir = tmp_path / "src"
        dst_dir = tmp_path / "dst"
        src_dir.mkdir()
        for i, name in enumerate(["N00E000.tif", "N01E000.tif", "N02E000.tif"]):
            _write_synthetic_geotiff(src_dir / name, seed=i * 10)

        results = convert_directory(src_dir, dst_dir, zstd_level=3)

        assert len(results) == 3
        assert all("error" not in r for r in results)
        for name in ("N00E000.ozt1", "N01E000.ozt1", "N02E000.ozt1"):
            assert (dst_dir / name).exists()

    def test_corrupt_tile_recorded_as_error(self, tmp_path):
        """An unreadable source is caught and reported, not fatal."""
        from openzenith.converter import convert_directory

        src_dir = tmp_path / "src"
        dst_dir = tmp_path / "dst"
        src_dir.mkdir()
        _write_synthetic_geotiff(src_dir / "N00E000.tif")
        (src_dir / "N01E000.tif").write_bytes(b"not a tiff at all")

        results = convert_directory(src_dir, dst_dir, zstd_level=3)

        assert len(results) == 2
        by_source = {r["source"]: r for r in results}
        assert "error" not in by_source["N00E000.tif"]
        assert "error" in by_source["N01E000.tif"]

    def test_pattern_and_max_tiles_filter(self, tmp_path):
        """Glob pattern and max_tiles both narrow the converted set."""
        from openzenith.converter import convert_directory

        src_dir = tmp_path / "src"
        dst_dir = tmp_path / "dst"
        src_dir.mkdir()
        for name in ("N00E000.tif", "N01E000.tif", "S02W010.tif"):
            _write_synthetic_geotiff(src_dir / name)

        patterned = convert_directory(src_dir, dst_dir, pattern="N0*E000*", zstd_level=3)
        assert {r["source"] for r in patterned} == {"N00E000.tif", "N01E000.tif"}

        limited = convert_directory(src_dir, dst_dir, max_tiles=1, zstd_level=3)
        assert [r["source"] for r in limited] == ["N00E000.tif"]

    def test_manifest_contents(self, tmp_path):
        """convert_directory should create a manifest.json with totals."""
        from openzenith.converter import convert_directory

        src_dir = tmp_path / "src"
        dst_dir = tmp_path / "dst"
        src_dir.mkdir()
        _write_synthetic_geotiff(src_dir / "N00E000.tif")

        convert_directory(src_dir, dst_dir, zstd_level=3)

        manifest_path = dst_dir / "manifest.json"
        assert manifest_path.exists()
        with manifest_path.open() as f:
            manifest = json.load(f)
        assert manifest["tiles_converted"] == 1
        assert manifest["total_source_bytes"] > 0
        assert manifest["total_output_bytes"] > 0
        assert "total_reduction_pct" in manifest
        assert manifest["results"][0]["source"] == "N00E000.tif"
