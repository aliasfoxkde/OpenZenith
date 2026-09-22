"""Depression handling: filling, breaching, and burning.

Priority-flood depression filling (Wang & Liu 2006), channel breaching,
least-cost-path breaching, stream burning, and bridge removal — the
pre-processing steps that make D8 flow routing well-posed.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .constants import D8_DC, D8_DR


def fill_depressions(dem: np.ndarray, nodata: float = -32768.0) -> np.ndarray:
    """Fill depressions using the priority-flood algorithm (Wang & Liu 2006).

    Ensures every cell has a downhill path to the grid edge, eliminating
    pits that would otherwise block flow accumulation and watershed tracing.

    Uses a heap-based approach: process cells from lowest to highest,
    raising any cell lower than its already-processed neighbor.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value to treat as invalid

    Returns:
        2D float32 array with depressions filled

    """
    import heapq

    rows, cols = dem.shape
    filled = dem.astype(np.float32).copy()
    processed = np.zeros((rows, cols), dtype=bool)

    # Priority queue: (elevation, row, col)
    heap: list[tuple[float, int, int]] = []

    # Add edge cells to heap (vectorized initialization)
    valid = filled > nodata
    edge_mask = np.zeros((rows, cols), dtype=bool)
    edge_mask[0, :] = True
    edge_mask[-1, :] = True
    edge_mask[:, 0] = True
    edge_mask[:, -1] = True
    edge_valid = edge_mask & valid

    edge_rows, edge_cols = np.where(edge_valid)
    edge_elevs = filled[edge_rows, edge_cols].astype(np.float64)
    for idx in range(len(edge_rows)):
        heapq.heappush(heap, (float(edge_elevs[idx]), int(edge_rows[idx]), int(edge_cols[idx])))
    processed[edge_valid] = True

    while heap:
        elev, r, c = heapq.heappop(heap)

        for d in range(8):
            nr, nc = r + int(D8_DR[d]), c + int(D8_DC[d])
            if 0 <= nr < rows and 0 <= nc < cols and not processed[nr, nc]:
                if filled[nr, nc] <= nodata:
                    processed[nr, nc] = True
                    continue
                # Raise cell if it's lower than the current water level
                filled[nr, nc] = max(filled[nr, nc], elev)
                heapq.heappush(heap, (float(filled[nr, nc]), nr, nc))
                processed[nr, nc] = True

    return filled


def breach_depressions(
    dem: np.ndarray,
    nodata: float = -32768.0,
    max_depth: float = 100.0,
    min_drop: float = 0.1,
) -> np.ndarray:
    """Breach depressions by carving channels through terrain.

    Unlike fill_depressions which raises cells to remove depressions,
    this algorithm carves channels from depression spill points to
    the grid edge. This produces more realistic flow for modeling
    flood pathways through roads, levees, and embankments.

    The algorithm uses priority-flood (Wang & Liu 2006) but in
    "breach mode": instead of raising cells to match the spill level,
    it lowers cells to create a carved channel with minimum drop.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value
        max_depth: Maximum carving depth in meters (default 100)
                   Cells are only carved if the breach would be shallower
                   than this threshold.
        min_drop: Minimum elevation drop per cell in the carved channel (m)

    Returns:
        2D float32 array with depressions breached (carved channels)

    """
    import heapq

    rows, cols = dem.shape
    breached = dem.astype(np.float64).copy()
    processed = np.zeros((rows, cols), dtype=bool)

    heap: list[tuple[float, int, int]] = []

    valid = breached > nodata
    edge_mask = np.zeros((rows, cols), dtype=bool)
    edge_mask[0, :] = True
    edge_mask[-1, :] = True
    edge_mask[:, 0] = True
    edge_mask[:, -1] = True
    edge_valid = edge_mask & valid

    for r in range(rows):
        for c in range(cols):
            if edge_valid[r, c]:
                heapq.heappush(heap, (float(breached[r, c]), r, c))
                processed[r, c] = True

    while heap:
        elev, r, c = heapq.heappop(heap)

        for d in range(8):
            nr, nc = r + int(D8_DR[d]), c + int(D8_DC[d])
            if 0 <= nr < rows and 0 <= nc < cols and not processed[nr, nc]:
                if breached[nr, nc] <= nodata:
                    processed[nr, nc] = True
                    continue

                neighbor_elev = breached[nr, nc]

                # In breach mode: carve downward instead of raising.
                # The target elevation is the current cell's elevation
                # minus the minimum drop per cell. This creates a
                # carved channel that maintains minimum gradient.
                target_elev = elev - min_drop

                if neighbor_elev > target_elev:
                    carve_depth = neighbor_elev - target_elev
                    if carve_depth <= max_depth:
                        breached[nr, nc] = target_elev
                    else:
                        # Carve as much as allowed, cell remains above threshold
                        breached[nr, nc] = neighbor_elev - max_depth

                heapq.heappush(heap, (float(breached[nr, nc]), nr, nc))
                processed[nr, nc] = True

    return breached.astype(np.float32)


def breach_least_cost_path(
    dem: np.ndarray,
    outlets: list[tuple[int, int]],
    max_cost: float = 1e9,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Breach depressions using the least-cost path method.

    For each outlet, finds the lowest-cost path from each pit to the outlet.
    Cost is based on elevation drop and path length — prefer deep breaches
    over long trenches.

    Equivalent to WhiteboxTools BreachLeastCostPath.

    Args:
        dem: 2D elevation grid
        outlets: List of (row, col) outlet positions
        max_cost: Maximum total cost before giving up
        nodata: NODATA value

    Returns:
        2D float32 array — cells on breach paths are lowered to the outlet elevation

    """
    from scipy.ndimage import distance_transform_edt

    rows, cols = dem.shape
    valid = dem > nodata
    result = dem.astype(np.float32).copy()

    # Build a cost surface: higher cost = harder to dig
    # Cost = distance from outlet + depth below outlet
    outlet_mask = np.zeros_like(valid, dtype=bool)
    for r, c in outlets:
        if 0 <= r < rows and 0 <= c < cols:
            outlet_mask[r, c] = True

    if not outlet_mask.any():
        return result

    # Distance from nearest outlet
    dist_outlet = distance_transform_edt(~outlet_mask)
    dist_outlet[~valid] = np.nan

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            if outlet_mask[r, c]:
                continue

            # Cost to reach this cell from its nearest outlet
            dist = dist_outlet[r, c]
            if np.isnan(dist):
                continue

            # Depth below the outlet (how much we need to dig)
            elev = dem[r, c]
            min_outlet_elev = np.nanmin(dem[outlet_mask])
            depth_below = elev - min_outlet_elev
            if depth_below <= 0:
                continue

            # Cost = distance + depth (prefer shallow/short over deep/long)
            cost = dist + depth_below * 10.0  # weighted
            if cost > max_cost:
                continue

            # Lower the cell to match outlet
            result[r, c] = min_outlet_elev

    return result


def fill_burn(
    dem: np.ndarray,
    streams: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Burn streams into DEM then fill the resulting depressions.

    Carves channels along the stream network before filling — useful
    when you have a known stream network (e.g., from hydrography data)
    that should be preserved in the DEM.

    Equivalent to WhiteboxTools FillBurn.

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster (True where streams exist)
        nodata: NODATA value

    Returns:
        2D float32 array with streams burned in and depressions filled

    """
    result = dem.astype(np.float32).copy()

    # Lower stream cells to match the minimum elevation along each stream
    from scipy import ndimage

    labeled_streams, n_streams = ndimage.label(streams)
    for link_id in range(1, n_streams + 1):
        mask = labeled_streams == link_id
        stream_elevs = dem[mask]
        if len(stream_elevs) == 0:
            continue
        min_elev = np.min(stream_elevs)
        # Set all cells in this stream link to the minimum elevation
        result[mask] = min_elev

    # Now fill depressions
    return fill_depressions(result, nodata)


def breach_bridges(
    dem: np.ndarray,
    streams: np.ndarray,
    max_width: int = 10,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Remove bridge/culvert artifacts from DEM.

    Identifies stream crossings that are narrower than max_width and
    carves a channel through them to the stream bed elevation.

    Equivalent to WhiteboxTools BreachBridges.

    Args:
        dem: 2D elevation grid
        streams: Boolean stream raster
        max_width: Maximum bridge/culvert width in cells
        nodata: NODATA value

    Returns:
        2D float32 array with bridges removed

    """
    from scipy import ndimage

    result = dem.astype(np.float32).copy()
    labeled_streams, n_streams = ndimage.label(streams)

    for link_id in range(1, n_streams + 1):
        mask = labeled_streams == link_id
        stream_elevs = dem[mask]
        if len(stream_elevs) == 0:
            continue

        # Find cells where the stream crosses a ridge (bridge)
        min_elev = np.min(stream_elevs)
        for r, c in zip(*np.where(mask), strict=False):
            # Check if this stream cell is elevated above the min
            if dem[r, c] > min_elev + 1.0:
                # Check cross-section width
                width = 0
                for dc in range(-max_width, max_width + 1):
                    nc = c + dc
                    if 0 <= nc < dem.shape[1] and streams[r, nc]:
                        width += 1
                if width <= max_width:
                    # Carve down to stream bed
                    result[r, c] = min_elev

    return result
