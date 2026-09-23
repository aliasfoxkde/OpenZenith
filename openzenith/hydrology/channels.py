"""Channel geometry and stream-corridor metrics.

Cross-sections and cross-section areas, stream gradients, average
distributary slope, elevation above stream, and depth to water table.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .constants import D8_DC, D8_DISTANCE, D8_DR


def cross_section(
    dem: np.ndarray,
    stream_row: int,
    stream_col: int,
    flow_dir: np.ndarray,
    half_width: int = 10,
    nodata: float = -32768.0,
) -> dict:
    """Extract a cross-section perpendicular to a stream at a given point.

    Returns the elevation profile across the channel perpendicular to the
    flow direction at the specified stream cell. Useful for computing
    channel geometry, hydraulic radius, and flood stage modeling.

    Args:
        dem: 2D elevation grid
        stream_row: Row index of the stream point
        stream_col: Column index of the stream point
        flow_dir: D8 flow direction grid
        half_width: Half-width of the cross-section in cells
        nodata: NODATA value

    Returns:
        Dict with keys: 'distances_m', 'elevations', 'width_m', 'max_depth_m',
        'cross_section_area_m2', 'hydraulic_radius_m'

    """
    rows, cols = dem.shape
    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0

    # Get flow direction at the stream point
    fd = flow_dir[stream_row, stream_col]
    if fd < 0 or fd >= 8:
        fd = 0

    # Perpendicular direction (rotate 90 degrees)
    perp_dir = (fd + 2) % 8
    perp_dr = D8_DR[perp_dir]
    perp_dc = D8_DC[perp_dir]

    # Collect elevation profile
    distances = []
    elevations = []
    center_elev = dem[stream_row, stream_col]

    for i in range(-half_width, half_width + 1):
        r = stream_row + perp_dr * i
        c = stream_col + perp_dc * i
        if 0 <= r < rows and 0 <= c < cols:
            elev = dem[r, c]
            if elev > nodata:
                dist_m = i * D8_DISTANCE[perp_dir] * cell_m
                distances.append(dist_m)
                elevations.append(elev)

    if len(elevations) < 3:
        return {
            "distances_m": distances,
            "elevations": elevations,
            "width_m": 0.0,
            "max_depth_m": 0.0,
            "cross_section_area_m2": 0.0,
            "hydraulic_radius_m": 0.0,
        }

    # Find channel banks (where slope is steepest on each side)
    bank_left_idx = 0
    bank_right_idx = len(elevations) - 1
    center_idx = half_width if len(elevations) > half_width else len(elevations) // 2

    # Simple bank detection: first significant elevation drop from center
    center_elev_val = elevations[center_idx] if center_idx < len(elevations) else center_elev
    bank_threshold = 2.0  # meters of drop to identify bank

    for i in range(center_idx - 1, -1, -1):
        if center_elev_val - elevations[i] > bank_threshold:
            bank_left_idx = i + 1
            break

    for i in range(center_idx + 1, len(elevations)):
        if elevations[i] - center_elev_val < -bank_threshold:
            bank_right_idx = i - 1
            break

    # Compute geometry
    bank_left_elev = elevations[bank_left_idx] if bank_left_idx < len(elevations) else center_elev
    bank_right_elev = (
        elevations[bank_right_idx] if bank_right_idx < len(elevations) else center_elev
    )
    bank_elev = min(bank_left_elev, bank_right_elev)

    # Width
    width_m = abs(bank_right_idx - bank_left_idx) * cell_m

    # Max depth below bank
    max_depth = max(0.0, bank_elev - center_elev)

    # Cross-section area (trapezoidal approximation below bank level).
    # Depths are clipped per-cell below; clamping the elevations themselves
    # up to bank level would zero every term (bank_elev - e <= 0 always).
    active_elevs = elevations[bank_left_idx : bank_right_idx + 1]
    if len(active_elevs) >= 2:
        avg_depth = sum(max(0, bank_elev - e) for e in active_elevs) / len(active_elevs)
        cross_section_area = avg_depth * width_m
    else:
        cross_section_area = 0.0

    # Hydraulic radius = area / wetted perimeter
    # Wetted perimeter = width + 2 * mean depth
    if width_m > 0:
        mean_depth = cross_section_area / width_m if cross_section_area > 0 else 0
        wetted_perim = width_m + 2 * mean_depth
        hydraulic_radius = cross_section_area / wetted_perim if wetted_perim > 0 else 0
    else:
        hydraulic_radius = 0.0

    return {
        "distances_m": distances,
        "elevations": elevations,
        "width_m": round(width_m, 2),
        "max_depth_m": round(max_depth, 2),
        "cross_section_area_m2": round(cross_section_area, 2),
        "hydraulic_radius_m": round(hydraulic_radius, 2),
        "bank_elevation_m": round(bank_elev, 2),
        "channel_center_elevation_m": round(center_elev, 2),
    }


def cross_section_area(
    dem: np.ndarray,
    profile: list[tuple[float, float]],
    nodata: float = -32768.0,
) -> list[float]:
    """Compute cross-sectional areas along an elevation profile.

    For each point in the profile, computes the area above the minimum
    elevation between consecutive profile points.

    Args:
        dem: 2D elevation grid
        profile: List of (distance, elevation) tuples
        nodata: NODATA value

    Returns:
        List of cross-sectional areas (m²) at each profile point

    """
    if len(profile) < 2:
        return []

    areas = []
    for i in range(len(profile)):
        if i == 0:
            areas.append(0.0)
            continue
        e_min = min(profile[i - 1][1], profile[i][1])
        e_max = max(profile[i - 1][1], profile[i][1])
        dx = abs(profile[i][0] - profile[i - 1][0])
        # Approximate trapezoidal area
        area = (e_max - e_min) * dx
        areas.append(area)
    return areas


def stream_gradients(
    dem: np.ndarray,
    streams: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute gradient (slope) along stream cells.

    For each stream cell, computes slope between adjacent stream cells.

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster
        nodata: NODATA value

    Returns:
        2D float32 array of stream gradients (m/m)

    """
    from scipy import ndimage

    labeled, n = ndimage.label(streams)
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    cell_m = 0.001 * 111320.0

    for link_id in range(1, n + 1):
        mask = labeled == link_id
        coords = np.argwhere(mask)
        if len(coords) < 2:
            continue
        # Sort by position along the link (by row+col as proxy)
        sorted_idx = np.argsort(coords[:, 0] + coords[:, 1])
        sorted_coords = coords[sorted_idx]

        for i in range(len(sorted_coords) - 1):
            r1, c1 = sorted_coords[i]
            r2, c2 = sorted_coords[i + 1]
            dist = np.sqrt((r2 - r1) ** 2 + (c2 - c1) ** 2) * cell_m
            if dist > 0:
                result[r1, c1] = abs(dem[r1, c1] - dem[r2, c2]) / dist

    return result.astype(np.float32)


def average_distributary_slope(
    dem: np.ndarray,
    streams: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute average slope along each distributary channel.

    For each stream cell, computes the slope between upstream and downstream
    endpoints of the stream link.

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster
        nodata: NODATA value

    Returns:
        2D float32 array of average slopes per stream cell (m/m)

    """
    from scipy import ndimage

    labeled, n = ndimage.label(streams)
    result = np.full(dem.shape, np.nan, dtype=np.float32)
    cell_m = 0.001 * 111320.0

    for link_id in range(1, n + 1):
        mask = labeled == link_id
        coords = np.argwhere(mask)
        if len(coords) < 2:
            continue
        # Find upstream and downstream endpoints
        sorted_idx = np.argsort(coords[:, 0] + coords[:, 1])
        sorted_coords = coords[sorted_idx]

        # Headwater = first coord, outlet = last
        r_head, c_head = sorted_coords[0]
        r_out, c_out = sorted_coords[-1]
        elev_diff = dem[r_head, c_head] - dem[r_out, c_out]
        # Approximate stream length
        n_cells = len(coords)
        length = n_cells * cell_m
        if length > 0:
            avg_slope = elev_diff / length
            for r, c in zip(*np.where(mask), strict=False):
                result[r, c] = avg_slope

    result[~streams] = nodata
    return result.astype(np.float32)


def elevation_above_stream(
    dem: np.ndarray,
    streams: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute elevation above the nearest stream cell.

    Positive = cell is above the nearest stream.
    Negative = cell is below the nearest stream (unlikely, indicates DEM issue).

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster
        nodata: NODATA value

    Returns:
        2D float32 array of elevation differences (meters)

    """
    from scipy.ndimage import distance_transform_edt

    valid = dem > nodata
    if not streams.any():
        return np.full(dem.shape, nodata, dtype=np.float32)

    # Distance from every cell TO the nearest stream, plus the index of that
    # stream cell. (distance_transform_edt measures each True cell's distance
    # to the nearest False cell, so the mask must be ~streams; passing the
    # streams raster itself measures stream cells outward and leaves every
    # other cell at 0.)
    _, (ir, ic) = distance_transform_edt(~streams, return_indices=True)
    nearest_stream_elev = dem[ir, ic].astype(np.float32)

    result = np.where(valid, dem.astype(np.float32) - nearest_stream_elev, np.float32(nodata))
    return result.astype(np.float32)


def depth_to_water(
    dem: np.ndarray,
    streams: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute depth to water table from terrain surface.

    Estimates water table depth from elevation using known stream elevations
    as reference points.

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster
        nodata: NODATA value

    Returns:
        2D float32 array of water table depth (meters below surface)

    """
    from scipy.ndimage import distance_transform_edt

    valid = dem > nodata
    if not streams.any():
        return np.full(dem.shape, nodata, dtype=np.float32)

    # Water table is assumed to sit at the elevation of the nearest stream
    # cell; depth to water is the surface minus that reference elevation.
    _, (ir, ic) = distance_transform_edt(~streams, return_indices=True)
    nearest_stream_elev = dem[ir, ic].astype(np.float32)

    result = np.where(valid, dem.astype(np.float32) - nearest_stream_elev, np.float32(nodata))
    return result.astype(np.float32)
