"""Tests for openzenith.viz visualization helpers."""

import io

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
        dem = np.array(
            [
                [100, 110, 120],
                [105, 115, -32768],
                [100, 110, 120],
            ],
            dtype=np.float32,
        )
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
        assert coords[1] == pytest.approx(40.0)  # lat

    def test_max_vertices_decimation(self):
        """Large grid is decimated to stay under max_vertices."""
        # 100x100 grid would produce 2*99*99 = 19602 triangles
        dem = np.random.rand(100, 100).astype(np.float32) * 1000
        mesh = terrain_to_3d_mesh(dem, max_vertices=100)
        # Should be much smaller than full mesh
        assert len(mesh["features"]) < 1000

    def test_empty_mesh_all_nodata(self):
        """All-NODATA grid produces empty FeatureCollection."""
        dem = np.full((10, 10), -32768.0, dtype=np.float32)
        mesh = terrain_to_3d_mesh(dem)
        assert mesh["type"] == "FeatureCollection"
        assert len(mesh["features"]) == 0


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

    def test_glb_max_vertices_decimation(self):
        """Large grid is decimated to stay under max_vertices."""
        pytest.importorskip("trimesh")
        dem = np.random.rand(100, 100).astype(np.float32) * 1000
        glb = terrain_to_glb(dem, max_vertices=100)
        assert isinstance(glb, bytes)
        assert len(glb) > 0

    def test_glb_empty_mesh(self):
        """All-NODATA grid produces minimal empty mesh."""
        pytest.importorskip("trimesh")
        dem = np.full((10, 10), -32768.0, dtype=np.float32)
        glb = terrain_to_glb(dem)
        assert isinstance(glb, bytes)
        assert len(glb) > 0


def _load_glb(glb_bytes):
    """Decode GLB bytes to a trimesh mesh (trimesh 5.x wraps them in a Scene)."""
    import trimesh

    return trimesh.load(io.BytesIO(glb_bytes), file_type="glb").to_mesh()


class TestTerrainToGLBRegressions:
    """Regression guards for the GLB export path.

    The GLB path shipped untestable (trimesh absent) and broken — RGB/RGBA
    reshape, face dtype cast, vertex indexing, and the trimesh 5.x export API
    all failed at runtime. These decode the output.
    """

    def test_glb_decodes_with_expected_geometry(self):
        pytest.importorskip("trimesh")
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        mesh = _load_glb(terrain_to_glb(dem))
        assert len(mesh.vertices) == 4  # one quad -> 4 vertices
        assert len(mesh.faces) == 2  # one quad -> 2 triangles

    def test_glb_vertex_colors_use_palette(self):
        pytest.importorskip("trimesh")
        dem = np.full((2, 2), 100.0, dtype=np.float32)
        mesh = _load_glb(terrain_to_glb(dem))
        colors = np.asarray(mesh.visual.vertex_colors)
        assert colors.shape[1] in (3, 4)  # trimesh appends alpha
        assert (colors[:, :3] > 0).all()  # 0-255 palette colours, not 0-1 floats

    def test_glb_scale_and_transform_applied(self):
        pytest.importorskip("trimesh")
        dem = np.full((2, 2), 100.0, dtype=np.float32)
        mesh = _load_glb(terrain_to_glb(dem, transform=(40.0, -74.0, 0.001, 0.001), scale=2.0))
        assert mesh.vertices[:, 2].max() == pytest.approx(200.0)  # scale
        assert mesh.vertices[:, 0].min() == pytest.approx(-74.0)  # lon origin

    def test_glb_empty_mesh_decodes_to_zero_geometry(self):
        pytest.importorskip("trimesh")
        dem = np.full((4, 4), -32768.0, dtype=np.float32)
        mesh = _load_glb(terrain_to_glb(dem))
        assert len(mesh.vertices) == 0
        assert len(mesh.faces) == 0

    def test_missing_trimesh_raises_actionable_error(self, monkeypatch):
        pytest.importorskip("trimesh")
        import sys

        monkeypatch.setitem(sys.modules, "trimesh", None)
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        with pytest.raises(ImportError, match="trimesh"):
            terrain_to_glb(dem)


class TestPlotTerrainAdvanced:
    """Advanced tests for plot_terrain."""

    def test_plot_with_custom_cmap(self):
        """Custom colormap is used."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, _ax = plot_terrain(dem, cmap="viridis")
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_vmin_vmax(self):
        """Custom vmin/vmax are applied."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, _ax = plot_terrain(dem, vmin=50, vmax=200)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_interval_contours(self):
        """Contour interval is applied."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, _ax = plot_terrain(dem, interval=10.0)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_transform(self):
        """Transform changes axes extent."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        transform = (40.0, -74.0, 0.001, 0.001)
        fig, _ax = plot_terrain(dem, transform=transform)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_existing_ax(self):
        """Existing axes is used instead of creating new."""
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots()
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        _fig2, ax2 = plot_terrain(dem, ax=ax)
        assert ax2 is ax
        plt.close(fig)


class TestPlotHillshadeAdvanced:
    """Advanced tests for plot_hillshade."""

    def test_plot_with_transform(self):
        """Transform changes axes extent."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        transform = (40.0, -74.0, 0.001, 0.001)
        fig, _ax = plot_hillshade(dem, transform=transform)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_existing_ax(self):
        """Existing axes is used."""
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots()
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        _fig2, ax2 = plot_hillshade(dem, ax=ax)
        assert ax2 is ax
        plt.close(fig)


class TestPlotContoursAdvanced:
    """Advanced tests for plot_contours."""

    def test_plot_with_transform(self):
        """Transform changes axes extent."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        transform = (40.0, -74.0, 0.001, 0.001)
        fig, _ax = plot_contours(dem, interval=10.0, transform=transform)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_custom_min_max_elev(self):
        """Custom min_elev/max_elev are applied."""
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fig, _ax = plot_contours(dem, interval=10.0, min_elev=50, max_elev=200)
        assert fig is not None
        import matplotlib.pyplot as plt

        plt.close(fig)

    def test_plot_with_existing_ax(self):
        """Existing axes is used."""
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots()
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        _fig2, ax2 = plot_contours(dem, interval=10.0, ax=ax)
        assert ax2 is ax
        plt.close(fig)


class TestPlotMissingMatplotlib:
    """The ImportError guards fire when matplotlib.pyplot is unimportable."""

    @pytest.mark.parametrize(
        ("fn", "kwargs"),
        [
            (plot_terrain, {}),
            (plot_hillshade, {}),
            (plot_contours, {"interval": 10.0}),
        ],
    )
    def test_missing_matplotlib_raises_actionable_error(self, monkeypatch, fn, kwargs):
        import sys

        monkeypatch.setitem(sys.modules, "matplotlib.pyplot", None)
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        with pytest.raises(ImportError, match="matplotlib"):
            fn(dem, **kwargs)


class TestPlotShow:
    """show=True delegates to matplotlib.pyplot.show."""

    @pytest.mark.parametrize(
        ("fn", "kwargs"),
        [
            (plot_terrain, {}),
            (plot_hillshade, {}),
            (plot_contours, {"interval": 10.0}),
        ],
    )
    def test_show_true_calls_plt_show(self, monkeypatch, fn, kwargs):
        import matplotlib.pyplot as plt

        calls = []
        monkeypatch.setattr(plt, "show", lambda: calls.append(1))
        dem = np.array([[100, 110], [105, 115]], dtype=np.float32)
        fn(dem, show=True, **kwargs)
        assert calls == [1]


class TestTerrainToPngRGB:
    """nodata_alpha=False renders an RGB image with black NODATA pixels."""

    def test_rgb_mode_with_black_nodata(self):
        from PIL import Image

        dem = np.array([[100, -32768], [100, 100]], dtype=np.float32)
        png = terrain_to_png(dem, nodata_alpha=False)
        img = Image.open(io.BytesIO(png))
        assert img.mode == "RGB"
        px = img.load()
        assert px[0, 0] != (0, 0, 0)  # valid cell keeps its palette colour
        assert px[1, 0] == (0, 0, 0)  # NODATA cell is flattened to black
