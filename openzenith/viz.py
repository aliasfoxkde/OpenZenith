"""Visualization helpers for OpenZenith terrain data.

Provides matplotlib-based terrain visualization, 3D mesh export for web
visualization (Three.js), and color-relief image generation.

Usage:
    import openzenith as oz
    from openzenith.viz import plot_terrain, terrain_to_3d_mesh, terrain_to_png

    # Quick matplotlib visualization
    fig, ax = oz.plot_terrain(elevation_grid, transform=transform)
    fig.savefig("terrain.png")

    # 3D mesh for Three.js / web
    mesh = oz.terrain_to_3d_mesh(elevation_grid, transform=transform)
    with open("terrain.json", "w") as f:
        json.dump(mesh, f)

    # Color-relief PNG for MapLibre
    img_bytes = oz.terrain_to_png(elevation_grid, palette="terrain")
"""

from __future__ import annotations

__all__ = [
    "plot_terrain",
    "plot_hillshade",
    "plot_contours",
    "terrain_to_3d_mesh",
    "terrain_to_glb",
    "terrain_to_png",
    "DEFAULT_TERRAIN_PALETTE",
]

import math

import numpy as np

# Default terrain color palette (elevation in meters → RGB)
DEFAULT_TERRAIN_PALETTE: list[tuple[float, tuple[int, int, int]]] = [
    (-32768.0, (0, 0, 0)),       # NODATA
    (-10.0,   (30, 90, 160)),    # Deep ocean
    (0.0,     (50, 130, 200)),   # Shallow ocean
    (1.0,     (80, 160, 100)),   # Beach/marsh
    (50.0,    (60, 140, 60)),    # Lowland forest
    (200.0,   (100, 160, 80)),   # Hills
    (500.0,   (150, 140, 120)),  # Mountains
    (1500.0,  (200, 180, 160)),  # High mountains
    (3000.0,  (240, 240, 250)),  # Alpine/snow
]


# ─── Matplotlib helpers ───────────────────────────────────────────────────────


def plot_terrain(
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    *,
    cmap: str = "terrain",
    vmin: float | None = None,
    vmax: float | None = None,
    interval: float | None = None,
    show: bool = False,
    figsize: tuple[float, float] = (12, 8),
    title: str = "Elevation (m)",
    ax=None,
):
    """Plot a DEM as a filled-colour terrain map with matplotlib.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
            If None, axes are in pixel coordinates.
        cmap: Matplotlib colormap name (default: "terrain").
        vmin: Minimum elevation for colour scale (default: auto).
        vmax: Maximum elevation for colour scale (default: auto).
        interval: If set, overlay contour lines at this interval (metres).
        show: If True, call matplotlib.pyplot.show().
        figsize: Figure size in inches (width, height).
        title: Plot title string.
        ax: Optional existing Axes to draw on.

    Returns:
        (Figure, Axes) tuple.
    """
    try:
        import matplotlib.pyplot as plt
        import matplotlib.colors as mcolors
    except ImportError:
        raise ImportError(
            "matplotlib required. Install with: pip install matplotlib"
        )

    valid = dem != -32768
    masked = np.where(valid, dem, np.nan)

    if transform is not None:
        lat0, lon0, dlat, dlon = transform
        extent: "tuple[float,float,float,float] | None" = (lon0, lon0 + dem.shape[1] * dlon, lat0 - dem.shape[0] * dlat, lat0)
    else:
        extent = None

    fig, ax_ = (plt.subplots(figsize=figsize) if ax is None else (ax.figure, ax))
    ax_.axis("off")
    ax_.set_title(title, fontsize=14)

    vmn = float(np.nanmin(masked)) if vmin is None else vmin
    vmx = float(np.nanmax(masked)) if vmax is None else vmax

    im = ax_.imshow(
        masked,
        cmap=cmap,
        vmin=vmn,
        vmax=vmx,
        extent=extent,
        origin="upper",
        interpolation="bilinear",
    )

    # Colour bar
    cbar = fig.colorbar(im, ax=ax_, shrink=0.6)
    cbar.set_label("Elevation (m)", fontsize=11)

    # Contours
    if interval is not None:
        contours = ax_.contour(
            masked,
            levels=np.arange(math.floor(vmn / interval) * interval, vmx + interval, interval),
            colors="black",
            linewidths=0.4,
            alpha=0.4,
            extent=extent,
        )
        ax_.clabel(contours, inline=True, fontsize=7, fmt="%.0f m")

    if show:
        plt.show()

    return fig, ax_


def plot_hillshade(
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    *,
    figsize: tuple[float, float] = (12, 8),
    show: bool = False,
    ax=None,
    **kwargs,
):
    """Plot a DEM shaded with a hillshade overlay.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
        figsize: Figure size in inches.
        show: If True, call matplotlib.pyplot.show().
        ax: Optional existing Axes.
        **kwargs: Passed to terrain.hillshade().

    Returns:
        (Figure, Axes) tuple.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        raise ImportError("matplotlib required.")

    from openzenith.terrain import hillshade

    # Compute cell size from transform or default
    if transform is not None:
        _, _, dlat, dlon = transform
        cell_size = (abs(dlat) + abs(dlon)) / 2
    else:
        cell_size = 0.001  # degrees

    hs = hillshade(dem, cell_size_deg=cell_size)
    masked_hs = np.where(dem != -32768, hs, np.nan)

    fig, ax_ = (plt.subplots(figsize=figsize) if ax is None else (ax.figure, ax))
    ax_.axis("off")
    ax_.set_title("Hillshade", fontsize=14)

    if transform is not None:
        lat0, lon0, dlat, dlon = transform
        extent: "tuple[float,float,float,float] | None" = (lon0, lon0 + dem.shape[1] * dlon, lat0 - dem.shape[0] * dlat, lat0)
    else:
        extent = None

    ax_.imshow(masked_hs, cmap="gray", extent=extent, origin="upper", interpolation="bilinear")

    if show:
        plt.show()

    return fig, ax_


def plot_contours(
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    *,
    interval: float = 50.0,
    min_elev: float | None = None,
    max_elev: float | None = None,
    decimals: int = 1,
    figsize: tuple[float, float] = (12, 8),
    show: bool = False,
    ax=None,
):
    """Plot elevation contour lines over a terrain base.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
        interval: Contour interval in metres (default: 50).
        min_elev: Minimum contour level (default: 10th percentile).
        max_elev: Maximum contour level (default: 90th percentile).
        decimals: Decimal places for elevation labels.
        figsize: Figure size in inches.
        show: If True, call matplotlib.pyplot.show().
        ax: Optional existing Axes.

    Returns:
        (Figure, Axes) tuple.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        raise ImportError("matplotlib required.")

    valid = dem != -32768
    masked = np.where(valid, dem, np.nan)

    vmn = min_elev if min_elev is not None else float(np.nanpercentile(masked, 10))
    vmx = max_elev if max_elev is not None else float(np.nanpercentile(masked, 90))
    start = int(math.floor(vmn / interval)) * interval
    levels = np.arange(start, vmx + interval, interval)

    fig, ax_ = (plt.subplots(figsize=figsize) if ax is None else (ax.figure, ax))
    ax_.axis("off")
    ax_.set_title(f"Contours (interval={interval}m)", fontsize=14)

    if transform is not None:
        lat0, lon0, dlat, dlon = transform
        extent: "tuple[float,float,float,float] | None" = (lon0, lon0 + dem.shape[1] * dlon, lat0 - dem.shape[0] * dlat, lat0)
    else:
        extent = None

    # Base terrain in green
    ax_.imshow(masked, cmap="Greens", extent=extent, origin="upper", vmin=vmn, vmax=vmx)

    contours = ax_.contour(
        masked,
        levels=levels,
        colors="black",
        linewidths=0.5,
        alpha=0.7,
        extent=extent,
    )
    ax_.clabel(contours, inline=True, fontsize=7, fmt="%.0f m")

    if show:
        plt.show()

    return fig, ax_


# ─── 3D mesh export ───────────────────────────────────────────────────────────


def terrain_to_3d_mesh(
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    *,
    scale: float = 1.0,
    flat: bool = False,
    max_vertices: int = 100_000,
) -> dict:
    """Convert a DEM to a 3D mesh suitable for Three.js or Mapbox.

    The output is a GeoJSON-like FeatureCollection with elevation baked into Z.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
        scale: Vertical exaggeration factor (default: 1.0).
        flat: If True, output a flat 2D mesh (z=0), suitable for draped imagery.
        max_vertices: Maximum vertices; grid is decimated if exceeded.

    Returns:
        GeoJSON FeatureCollection dict with mesh geometry and properties.
    """
    rows, cols = dem.shape
    valid = dem != -32768

    # Decimate if needed
    step = 1
    if rows * cols > max_vertices:
        step = int(math.ceil(math.sqrt((rows * cols) / max_vertices)))

    if transform is not None:
        lat0, lon0, dlat, dlon = transform
    else:
        lat0, lon0, dlat, dlon = 0.0, 0.0, 0.001, 0.001

    features = []

    # Build quads (two triangles each) with subsampling
    for r in range(0, rows - 1, step):
        for c in range(0, cols - 1, step):
            # Cell corners
            pts = [
                (lat0 + r * dlat, lon0 + c * dlon, dem[r, c]),
                (lat0 + r * dlat, lon0 + (c + 1) * dlon, dem[r, c + 1]),
                (lat0 + (r + 1) * dlat, lon0 + c * dlon, dem[r + 1, c]),
                (lat0 + (r + 1) * dlat, lon0 + (c + 1) * dlon, dem[r + 1, c + 1]),
            ]

            # Skip if any corner is NODATA
            if any(p[2] == -32768 for p in pts):
                continue

            z = [p[2] * scale for p in pts]
            coords = [[p[1], p[0], 0 if flat else p[2] * scale] for p in pts]

            # Triangle 1: 0, 1, 2
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Triangle",
                    "coordinates": [coords[0], coords[1], coords[2]],
                },
                "properties": {
                    "elevation_0": z[0],
                    "elevation_1": z[1],
                    "elevation_2": z[2],
                },
            })

            # Triangle 2: 1, 3, 2
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Triangle",
                    "coordinates": [coords[1], coords[3], coords[2]],
                },
                "properties": {
                    "elevation_0": z[1],
                    "elevation_1": z[3],
                    "elevation_2": z[2],
                },
            })

    return {"type": "FeatureCollection", "features": features}


def terrain_to_glb(
    dem: np.ndarray,
    transform: tuple[float, float, float, float] | None = None,
    *,
    scale: float = 1.0,
    max_vertices: int = 100_000,
    palette: list[tuple[float, tuple[int, int, int]]] | None = None,
) -> bytes:
    """Convert a DEM to a binary GLTF/GLB mesh for Three.js.

    Uses numpy-stl to build a triangulated mesh and encodes as GLB.
    Colour is applied per-vertex using a terrain palette.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        transform: (origin_lat, origin_lon, cell_size_lat, cell_size_lon).
        scale: Vertical exaggeration factor.
        max_vertices: Maximum vertices; grid is decimated if exceeded.
        palette: List of (elevation, RGB) colour stops.

    Returns:
        Raw GLB bytes suitable for loading into Three.js GLTFLoader.

    Requires: numpy-stl, trimesh
        pip install numpy-stl trimesh
    """
    try:
        import numpy as np
        import trimesh
    except ImportError:
        raise ImportError("numpy-stl and trimesh required. pip install numpy-stl trimesh")

    rows, cols = dem.shape

    step = 1
    if rows * cols > max_vertices:
        step = int(math.ceil(math.sqrt((rows * cols) / max_vertices)))

    if transform is not None:
        lat0, lon0, dlat, dlon = transform
    else:
        lat0, lon0, dlat, dlon = 0.0, 0.0, 0.001, 0.001

    # Pre-compute RGBA colour for every grid cell using vectorized palette lookup
    pal = palette or DEFAULT_TERRAIN_PALETTE
    stop_elevs = np.array([p[0] for p in pal], dtype=np.float64)
    stop_colors = np.array([p[1] for p in pal], dtype=np.uint8)

    dem_f = dem.astype(np.float64)
    flat = dem_f.ravel()
    indices = np.searchsorted(stop_elevs, flat, side="right") - 1
    indices = np.clip(indices, 0, len(pal) - 2)
    e0 = stop_elevs[indices]
    e1 = stop_elevs[indices + 1]
    diff_e = e1 - e0
    t = np.where(diff_e != 0, (flat - e0) / diff_e, 0.0)
    c0 = stop_colors[indices].astype(np.float64)
    c1 = stop_colors[indices + 1].astype(np.float64)
    rgba_flat = np.round(c0 + t[:, np.newaxis] * (c1 - c0)).astype(np.uint8)
    rgba = rgba_flat.reshape(rows, cols, 4)  # (rows, cols, 4) RGBA

    vertices: list = []
    colors: list = []
    indices: list = []
    v_idx: int = 0

    for r in range(0, rows - 1, step):
        for c in range(0, cols - 1, step):
            if dem[r, c] == -32768 or dem[r, c + 1] == -32768 or dem[r + 1, c] == -32768 or dem[r + 1, c + 1] == -32768:
                continue

            # Vertex 0: (lat, lon, alt) → lon, lat, alt for trimesh
            vlon = lon0 + c * dlon
            vlat = lat0 + r * dlat
            vertices.extend([
                [vlon, vlat, dem[r, c] * scale],
                [vlon + dlon, vlat, dem[r, c + 1] * scale],
                [vlon, vlat + dlat, dem[r + 1, c] * scale],
                [vlon + dlon, vlat + dlat, dem[r + 1, c + 1] * scale],
            ])

            # Look up pre-computed per-cell RGBA colours
            colors.extend([
                rgba[r, c].tolist(),
                rgba[r, c + 1].tolist(),
                rgba[r + 1, c].tolist(),
                rgba[r + 1, c + 1].tolist(),
            ])

            indices.append([v_idx, v_idx + 1, v_idx + 2])
            indices.append([v_idx + 1, v_idx + 3, v_idx + 2])
            v_idx += 4

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.asarray(indices, dtype=np.uint32),
        vertex_colors=np.asarray(colors, dtype=np.float32),
    )
    return mesh.to_glb()


def _palette_color(
    elevation: float,
    palette: list[tuple[float, tuple[int, int, int]]] | None = None,
) -> tuple[int, int, int, int]:
    """Look up RGBA colour for an elevation value from a palette."""
    pal = palette or DEFAULT_TERRAIN_PALETTE
    for i in range(len(pal) - 1):
        e0, c0 = pal[i]
        e1, c1 = pal[i + 1]
        if e0 <= elevation <= e1:
            t = (elevation - e0) / (e1 - e0) if e1 != e0 else 0.0
            r = int(c0[0] + t * (c1[0] - c0[0]))
            g = int(c0[1] + t * (c1[1] - c0[1]))
            b = int(c0[2] + t * (c1[2] - c0[2]))
            return (r, g, b, 255)
    return (180, 180, 180, 255)  # default grey


# ─── Colour-relief PNG ────────────────────────────────────────────────────────


def terrain_to_png(
    dem: np.ndarray,
    *,
    palette: list[tuple[float, tuple[int, int, int]]] | None = None,
    nodata_alpha: bool = True,
) -> bytes:
    """Render a DEM as a colour-relief PNG (RGB or RGBA).

    Uses bilinear interpolation between palette elevation stops.

    Args:
        dem: 2D elevation array (meters, NODATA=-32768).
        palette: List of (elevation, (R, G, B)) colour stops.
            Defaults to DEFAULT_TERRAIN_PALETTE.
        nodata_alpha: If True, NODATA pixels are transparent (alpha=0).

    Returns:
        Raw PNG bytes.
    """
    pal = palette or DEFAULT_TERRAIN_PALETTE
    stop_elevs = np.array([p[0] for p in pal], dtype=np.float64)
    stop_colors = np.array([p[1] for p in pal], dtype=np.uint8)

    dem_f = dem.astype(np.float64)
    nodata_mask = dem_f == -32768

    # Flatten for 1D vectorized operations
    flat = dem_f.ravel()
    indices = np.searchsorted(stop_elevs, flat, side="right") - 1
    indices = np.clip(indices, 0, len(pal) - 2)

    e0 = stop_elevs[indices]
    e1 = stop_elevs[indices + 1]
    diff_e = e1 - e0
    t = np.where(diff_e != 0, (flat - e0) / diff_e, 0.0)

    c0 = stop_colors[indices].astype(np.float64)
    c1 = stop_colors[indices + 1].astype(np.float64)
    rgb_flat = np.round(c0 + t[:, np.newaxis] * (c1 - c0)).astype(np.uint8)
    rgb = rgb_flat.reshape(*dem.shape, 3)

    if nodata_alpha:
        alpha = np.where(nodata_mask, np.uint8(0), np.uint8(255))
        rgba = np.dstack([rgb, alpha])
        import PIL.Image
        img = PIL.Image.fromarray(rgba, mode="RGBA")
    else:
        rgb = np.where(nodata_mask[:, :, np.newaxis], np.uint8(0), rgb)
        import PIL.Image
        img = PIL.Image.fromarray(rgb, mode="RGB")

    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
