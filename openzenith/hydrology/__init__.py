"""OpenZenith Hydrology — D8 flow routing, streams, watersheds, and indices.

This package replaces the former single-module ``openzenith.hydrology``. The
public surface is unchanged: every name importable from the old module is
re-exported here (private helpers included), and both
``openzenith.hydrology.X`` and ``from openzenith.hydrology import X`` resolve
exactly as before.

Submodules:
- ``constants``: D8 direction encoding shared by every flow-routing routine
- ``depressions``: filling, breaching, and burning depressions
- ``flow``: D8 flow direction and flow accumulation
- ``streams``: stream order, links, reaches, and link classes
- ``watersheds``: watershed, basin, and sub-basin delineation
- ``flowpaths``: flow-path distances and least-cost paths
- ``indices``: wetness and erosion indices
- ``channels``: channel geometry and stream-corridor metrics
- ``inundation``: flood inundation and depression water storage

Usage:
    from openzenith.hydrology import d8_flow_direction, flow_accumulation, extract_streams

    # Load elevation grid
    grid = load_elevation_grid(lat, lon, zoom)

    # Compute flow directions
    flow_dir = d8_flow_direction(grid)

    # Compute accumulation
    accum = flow_accumulation(flow_dir)

    # Extract streams (areas > 100 pixels)
    streams = extract_streams(accum, threshold=100)
"""

from .channels import (
    average_distributary_slope,
    cross_section,
    cross_section_area,
    depth_to_water,
    elevation_above_stream,
    stream_gradients,
)
from .constants import (
    D8_DC,
    D8_DISTANCE,
    D8_DR,
)
from .depressions import (
    breach_bridges,
    breach_depressions,
    breach_least_cost_path,
    fill_burn,
    fill_depressions,
)
from .flow import (
    _flow_accumulation_toposort as _flow_accumulation_toposort,
)
from .flow import (
    d8_flow_direction,
    extract_streams,
    flow_accumulation,
    flow_accumulation_fast,
    flow_accumulation_max,
)
from .flowpaths import (
    cost_distance,
    downslope_distance_to_outlet,
    downslope_flowpath_length,
    max_upslope_flow_length,
    upslope_flowpath_length,
)
from .indices import (
    ls_factor,
    slope_area_ratio,
    stream_power_index,
    twi,
)
from .inundation import (
    depression_depth_stats,
    flood_inundation,
    inundation_depth,
)
from .streams import (
    _label_streams as _label_streams,
)
from .streams import (
    stream_link_class,
    stream_link_identifier,
    stream_order,
    stream_reach_identifier,
)
from .watersheds import (
    _trace_basin as _trace_basin,
)
from .watersheds import (
    _trace_watershed as _trace_watershed,
)
from .watersheds import (
    basin_id,
    delineate_watershed,
    gage_watershed,
    snap_pour_point,
    stream_basins,
    sub_basins,
    watershed,
)

__all__ = [
    "D8_DC",
    "D8_DISTANCE",
    "D8_DR",
    "average_distributary_slope",
    "basin_id",
    "breach_bridges",
    "breach_depressions",
    "breach_least_cost_path",
    "cost_distance",
    "cross_section",
    "cross_section_area",
    "d8_flow_direction",
    "delineate_watershed",
    "depression_depth_stats",
    "depth_to_water",
    "downslope_distance_to_outlet",
    "downslope_flowpath_length",
    "elevation_above_stream",
    "extract_streams",
    "fill_burn",
    "fill_depressions",
    "flood_inundation",
    "flow_accumulation",
    "flow_accumulation_fast",
    "flow_accumulation_max",
    "gage_watershed",
    "inundation_depth",
    "ls_factor",
    "max_upslope_flow_length",
    "slope_area_ratio",
    "snap_pour_point",
    "stream_basins",
    "stream_gradients",
    "stream_link_class",
    "stream_link_identifier",
    "stream_order",
    "stream_power_index",
    "stream_reach_identifier",
    "sub_basins",
    "twi",
    "upslope_flowpath_length",
    "watershed",
]
