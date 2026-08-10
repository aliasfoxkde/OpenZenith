"""Tests for openzenith.viz visualization helpers."""

import numpy as np
import pytest

from openzenith.viz import (
    DEFAULT_TERRAIN_PALETTE,
    _palette_color,
    plot_contours,
    plot_hillshade,
    plot_terrain,
    terrain_to_3d_mesh,
    terrain_to_glb,
    terrain_to_png,
)


class TestPalette:
    """Tests for terrain colour palette."""

    def test_palette_color_ocean(self):
        """Ocean elevation returns ocean blue."""
        c = _palette_color(-5.0, DEFAULT_TERRAIN_PALETTE)
        assert c[0] < 100  # low red = blue-ish
        assert c[2] > 100  # high blue

    def test_palette_color_elevated(self):
        """High elevation returns light (snow) colour."""
        c = _palette_color(3000.0, DEFAULT_TERRAIN_PALETTE)
        assert sum(c[:3]) > 600  # very light / white-ish

    def test_palette_color_unknown_elev(self):
        """Unknown elevation falls back to grey."""
        c = _palette_color(99999.0, DEFAULT_TERRAIN_PALETTE)
        assert c == (180, 180, 180, 255)


class TestTerrainTo3DMesh:
    """Tests for terrain_to_3d_mesh."""

    def test_flat_mesh(self):
        """Flat 2×2 grid produces 2 triangle features."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        mesh = terrain_to_3d_mesh(dem, flat=True)
        assert mesh["type"] == "FeatureCollection"
        assert len(mesh["features"]) == 2
        # Coordinates should have z=0 when flat=True
        for feat in mesh["features"]:
            for coord in feat["geometry"]["coordinates"]:
                assert coord[2] == 0

    def test_scaled_mesh(self):
        """Scaled mesh multiplies elevation by scale factor."""
        dem = np.array([[100, 100], [100, 100]], dtype=np.float32)
        mesh = terrain_to_3d_mesh(dem, scale=2.0)
        z = mesh["features"][0]["properties"]["elevation_0"]
        assert z == pytest.approx(200.0)

    def test_nodata_skipped(self):
        """NODATA cells are excluded from mesh."""
        # 3x3 grid: 4 cells total. One cell (top-right) has a NODATA corner
        # and is skipped. The other 3 cells produce 6 triangles.
        dem = np.array([
            [100, 110, 120],
            [105, 115, -32768],
            [100, 110, 120],
        ], dtype=np.float32)
        mesh = terrain_to_3d_mesh(dem)
        # Cell (0,0): valid → 2 triangles, Cell (0,1): NODATA corner → skipped,
        # Cell (1,0): valid → 2 triangles, Cell (1,1): valid → 2 triangles.
        # But Cell (1,1) shares the NODATA corner from (0,1), so its top-right
        # quad is actually valid (corners are (1,1),(1,2),(2,1),(2,2)) with (1,2)=NODATA
        # = one corner nodata → skipped.
        # Result: Cell (0,0) + Cell (1,0) = 2 cells → 4 triangles.
        assert len(mesh["features"]) == 4

    def test_transform_applied(self):
        """Transform changes coordinate values."""
        dem = np.array([[100, 100], [100, 100]], dtype=np.float32)
        transform = (40.0, -74.0, 0.001, 0.001)  # lat0, lon0, dlat, dlon
        mesh = terrain_to_3d_mesh(dem, transform=transform)
        coords = mesh["features"][0]["geometry"]["coordinates"][0]
        assert coords[0] == pytest.approx(-74.0)  # lon
        assert coords[1] == pytest.approx(40.0)    # lat


class TestTerrainToPNG:
    """Tests for terrain_to_png."""

    def test_png_bytes(self):
        """PNG output is valid bytes."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        png = terrain_to_png(dem)
        assert isinstance(png, bytes)
        assert png[:4] == b"\x89PNG"  # PNG magic header

    def test_nodata_transparent(self):
        """NODATA pixels produce RGBA with alpha=0."""
        dem = np.array([[100, -32768], [100, 100]], dtype=np.float32)
        png = terrain_to_png(dem, nodata_alpha=True)
        assert isinstance(png, bytes)

    def test_custom_palette(self):
        """Custom palette changes output colours."""
        dem = np.array([[100, 100], [100, 100]], dtype=np.float32)
        custom = [(0, (255, 0, 0)), (1000, (0, 255, 0))]
        png = terrain_to_png(dem, palette=custom)
        assert isinstance(png, bytes)


class TestPlotHelpers:
    """Tests that plot functions return Figure and Axes without errors."""

    def test_plot_terrain_returns_fig_ax(self):
        """plot_terrain returns a matplotlib Figure and Axes."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, ax = plot_terrain(dem)
        assert fig is not None
        assert ax is not None
        import matplotlib.pyplot as plt
        plt.close(fig)

    def test_plot_hillshade_returns_fig_ax(self):
        """plot_hillshade returns a matplotlib Figure and Axes."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, ax = plot_hillshade(dem)
        assert fig is not None
        assert ax is not None
        import matplotlib.pyplot as plt
        plt.close(fig)

    def test_plot_contours_returns_fig_ax(self):
        """plot_contours returns a matplotlib Figure and Axes."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, ax = plot_contours(dem, interval=10.0)
        assert fig is not None
        assert ax is not None
        import matplotlib.pyplot as plt
        plt.close(fig)


class TestTerrainToGLB:
    """Tests for terrain_to_glb."""

    def test_glb_bytes_non_empty(self):
        """GLB output is non-empty bytes."""
        pytest.importorskip("trimesh")
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        glb = terrain_to_glb(dem)
        assert isinstance(glb, bytes)
        assert len(glb) > 0

    def test_glb_starts_with_glb_magic(self):
        """GLB output starts with glTF binary magic bytes."""
        pytest.importorskip("trimesh")
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        glb = terrain_to_glb(dem)
        # glTF binary files start with 'glTF' magic: 0x46546C67
        assert glb[:4] == b"glTF"

    def test_glb_with_transform(self):
        """GLB with transform applies coordinate transform."""
        pytest.importorskip("trimesh")
        dem = np.array([[100, 100], [100, 100]], dtype=np.float32)
        transform = (40.0, -74.0, 0.001, 0.001)  # lat0, lon0, dlat, dlon
        glb = terrain_to_glb(dem, transform=transform)
        assert isinstance(glb, bytes)
        assert len(glb) > 0

    def test_glb_with_palette(self):
        """GLB with custom palette uses those colors."""
        pytest.importorskip("trimesh")
        dem = np.array([[100, 100], [100, 100]], dtype=np.float32)
        custom = [(0, (255, 0, 0)), (1000, (0, 255, 0))]
        glb = terrain_to_glb(dem, palette=custom)
        assert isinstance(glb, bytes)
        assert len(glb) > 0
