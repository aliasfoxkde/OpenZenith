"""OpenZenith Terrain Analysis — slope, aspect, hillshade, viewshed, and derivatives.

This package replaces the former single-module ``openzenith.terrain``. The
public surface is unchanged: every name importable from the old module is
re-exported here (private helpers included), and both
``openzenith.terrain.X`` and ``from openzenith.terrain import X`` resolve
exactly as before.

Submodules:
- ``gradients``: slope, aspect, and curvature derivatives
- ``filters``: focal statistics, morphological operations, and DEM filters
- ``shading``: analytical hillshading and color relief
- ``viewshed``: line of sight, visibility, and directional exposure
- ``profiles``: elevation and flow-path profiles
- ``indices``: composite terrain indices and classifications
- ``flow_metrics``: terrain metrics coupled to flow routing
- ``raster``: raster algebra and image statistics

Usage:
    from openzenith.terrain import slope, aspect, hillshade

    grid = load_elevation_grid(39.0, -106.0, 10)
    slope_deg = slope(grid, cell_size_deg=grid["cell_size_deg"])
    aspect_deg = aspect(grid, cell_size_deg=grid["cell_size_deg"])
    shade = hillshade(grid, azimuth=315, altitude=45)
"""

from .filters import (
    adaptive_filter,
    closing,
    clump,
    elevation_percentile,
    feature_preserving_smooth,
    highland,
    majority_filter,
    max_filter,
    mean_filter,
    median_filter,
    min_filter,
    opening,
    remove_off_terrain,
    roughness,
    sieve,
    tpi,
    tri,
)
from .flow_metrics import (
    average_flow_truncation,
    clean_dem,
    depth_in_sink,
    drainage_density,
    flow_width,
    hack_integral,
    sediment_transport_index,
    slope_area_ratio,
    specific_catchment_area,
)
from .gradients import (
    aspect,
    aspect_slope,
    convergence_index,
    curvature,
    downslope_index,
    edge_density,
    gaussian_curvature,
    horizontal_curvature,
    planform_curvature,
    profile_curvature,
    slope,
    slope_fast,
    tangent_curvature,
    total_curvature,
)
from .indices import (
    annual_heinardh,
    curvature_classification,
    dev_from_mean_plane,
    diff_from_mean,
    edge_contamination_check,
    elevation_relief_ratio,
    greater_than_height,
    hypsometry,
    landform_classification,
    mstp,
    pct_above_thresh,
    pct_below_thresh,
    relative_elevation,
    slope_leq,
)
from .profiles import (
    _upslope_flow_length as _upslope_flow_length,
)
from .profiles import (
    flow_length,
    hillslope_profile,
    profile,
)
from .raster import (
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
from .shading import (
    color_relief,
    hillshade,
    hillshade_diff,
    multi_hillshade,
)
from .viewshed import (
    _viewshed_numba as _viewshed_numba,
)
from .viewshed import (
    _viewshed_numpy as _viewshed_numpy,
)
from .viewshed import (
    directional_relief,
    fetch_analysis,
    horizon_angle,
    max_elevation_from_direction,
    sky_view_factor,
    viewshed,
    visibility_index,
)

__all__ = [
    "adaptive_filter",
    "annual_heinardh",
    "aspect",
    "aspect_slope",
    "average_flow_truncation",
    "clean_dem",
    "closing",
    "clump",
    "color_relief",
    "convergence_index",
    "curvature",
    "curvature_classification",
    "dem_clip",
    "dem_mask",
    "dem_reclassify",
    "dem_where",
    "depth_in_sink",
    "dev_from_mean_plane",
    "diff_from_mean",
    "directional_relief",
    "downslope_index",
    "drainage_density",
    "edge_contamination_check",
    "edge_density",
    "elevation_percentile",
    "elevation_relief_ratio",
    "feature_preserving_smooth",
    "fetch_analysis",
    "flow_length",
    "flow_width",
    "gaussian_curvature",
    "greater_than_height",
    "hack_integral",
    "highland",
    "hillshade",
    "hillshade_diff",
    "hillslope_profile",
    "horizon_angle",
    "horizontal_curvature",
    "hypsometry",
    "image_autocorrelation",
    "image_correlation",
    "integer_division",
    "landform_classification",
    "majority_filter",
    "max_elevation_from_direction",
    "max_filter",
    "mean_filter",
    "median_filter",
    "min_filter",
    "modulo",
    "mstp",
    "multi_hillshade",
    "normalized_difference",
    "opening",
    "pct_above_thresh",
    "pct_below_thresh",
    "planform_curvature",
    "profile",
    "profile_curvature",
    "relative_elevation",
    "remove_off_terrain",
    "roughness",
    "sediment_transport_index",
    "sieve",
    "sky_view_factor",
    "slope",
    "slope_area_ratio",
    "slope_fast",
    "slope_leq",
    "specific_catchment_area",
    "tangent_curvature",
    "total_curvature",
    "tpi",
    "tri",
    "viewshed",
    "visibility_index",
]
