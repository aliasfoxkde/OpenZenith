"""Flow-path distances and least-cost paths.

Downslope and upslope flow-path lengths, distance to outlet, longest
upslope path, and least-cost distance surfaces from outlets.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .constants import D8_DC, D8_DISTANCE, D8_DR
from .flow import d8_flow_direction


def downslope_flowpath_length(
    dem: np.ndarray,
    flow_dir: np.ndarray | None = None,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute downslope flowpath length to watershed outlet.

    The distance from each cell to its outlet (cell with no outgoing flow)
    following the D8 flow path. This is the overland flow distance
    used in time-of-concentration and runoff modeling.

    Args:
        dem: 2D elevation grid
        flow_dir: Optional D8 flow direction grid. If None, computed from dem.
        nodata: NODATA value

    Returns:
        2D float32 array of flowpath length in meters

    """
    if flow_dir is None:
        flow_dir = d8_flow_direction(dem, nodata)

    rows, cols = dem.shape
    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0

    # Compute distance to outlet using back-tracking
    # Start from cells with no outflow (pits/edge) and propagate distances
    outflowing = np.zeros((rows, cols), dtype=bool)
    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        src_r, src_c = np.where(flow_dir == d)
        tgt_r = src_r + dr
        tgt_c = src_c + dc
        valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
        outflowing[src_r[valid], src_c[valid]] = True

    # Initialize distance = 0 for cells with no outflow
    dist = np.full((rows, cols), np.inf, dtype=np.float64)
    pits = ~outflowing
    dist[pits] = 0.0

    # Also start from edge cells (they drain off the grid)
    edge = np.zeros_like(pits)
    edge[0, :] = True
    edge[-1, :] = True
    edge[:, 0] = True
    edge[:, -1] = True
    dist[edge] = 0.0

    # Iteratively propagate distances using priority queue
    # Process from lowest distance to highest
    # For each cell, add distance to next cell along flow path
    max_iter = rows * cols * 4
    for _ in range(max_iter):
        changed = False
        for d in range(8):
            dr, dc = int(D8_DR[d]), int(D8_DC[d])
            dist_e = D8_DISTANCE[d] * cell_m

            # Source cells that flow in direction d
            src_r, src_c = np.where(flow_dir == d)
            if len(src_r) == 0:
                continue

            tgt_r = src_r + dr
            tgt_c = src_c + dc

            valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
            valid &= np.isfinite(dist[src_r[valid], src_c[valid]])

            if not valid.any():
                continue

            sr = src_r[valid]
            sc = src_c[valid]
            tr = tgt_r[valid]
            tc = tgt_c[valid]

            new_dist = dist[sr, sc] + dist_e
            mask = new_dist < dist[tr, tc]
            if mask.any():
                dist[tr[mask], tc[mask]] = new_dist[mask]
                changed = True

        if not changed:
            break

    # Replace inf with NaN for cells that never reach outlet
    result = dist.astype(np.float32)
    result[~np.isfinite(result)] = np.nan
    return result


def upslope_flowpath_length(
    dem: np.ndarray,
    flow_dir: np.ndarray | None = None,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute upslope flowpath length from each cell to ridge.

    The distance from each cell to the nearest ridge (cell with no
    upslope contributing cells) following flow paths backward.

    Args:
        dem: 2D elevation grid
        flow_dir: Optional D8 flow direction grid. If None, computed from dem.
        nodata: NODATA value

    Returns:
        2D float32 array of upslope flowpath length in meters

    """
    if flow_dir is None:
        flow_dir = d8_flow_direction(dem, nodata)

    rows, cols = dem.shape
    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0

    # Find source cells (cells no other cell flows into)
    in_degree = np.zeros((rows, cols), dtype=np.int32)
    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        src_r, src_c = np.where(flow_dir == d)
        tgt_r = np.clip(src_r + dr, 0, rows - 1)
        tgt_c = np.clip(src_c + dc, 0, cols - 1)
        np.add.at(in_degree, (tgt_r, tgt_c), 1)

    # Sources have in_degree == 0
    sources = in_degree == 0
    dist = np.where(sources, 0.0, np.inf).astype(np.float64)

    # Reverse propagation: from sources, go UP the flow path
    # (i.e., follow reverse of flow_dir)
    max_iter = rows * cols * 4
    for _ in range(max_iter):
        changed = False
        for d in range(8):
            dr, dc = int(D8_DR[d]), int(D8_DC[d])
            dist_e = D8_DISTANCE[d] * cell_m

            # Cells flowing in direction d -> their target is at (r+dr, c+dc)
            src_r, src_c = np.where(flow_dir == d)
            if len(src_r) == 0:
                continue

            tgt_r = src_r + dr
            tgt_c = src_c + dc

            valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
            valid &= np.isfinite(dist[tgt_r[valid], tgt_c[valid]])

            if not valid.any():
                continue

            sr = src_r[valid]
            sc = src_c[valid]
            tr = tgt_r[valid]
            tc = tgt_c[valid]

            new_dist = dist[tr, tc] + dist_e
            mask = new_dist < dist[sr, sc]
            if mask.any():
                dist[sr[mask], sc[mask]] = new_dist[mask]
                changed = True

        if not changed:
            break

    result = dist.astype(np.float32)
    result[~np.isfinite(result)] = np.nan
    return result


def max_upslope_flow_length(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """For each cell, compute the longest upslope flow path length.

    Equivalent to WhiteboxTools MaxUpslopeFlowLen.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of longest upslope path length (meters)

    """
    from openzenith.terrain import flow_length

    return flow_length(dem, direction="upslope", nodata=nodata)


def downslope_distance_to_outlet(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute downslope distance from each cell to the watershed outlet.

    Equivalent to WhiteboxTools DownslopeDistToOutlet.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of distances (meters)

    """
    from openzenith.terrain import flow_length

    return flow_length(dem, direction="downslope", nodata=nodata)


def cost_distance(
    dem: np.ndarray,
    outlets: list[tuple[int, int]],
    cost_function: str = "slope",
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute least-cost distance from each cell to the nearest outlet.

    Cost is based on a cost function (default: slope × distance).

    Args:
        dem: 2D elevation grid
        outlets: List of (row, col) outlet coordinates
        cost_function: "slope" or "distance"
        nodata: NODATA value

    Returns:
        2D float32 array of least-cost distances

    """
    import heapq

    rows, cols = dem.shape
    cell_m = 0.001 * 111320.0

    # Initialize cost grid
    cost = np.full((rows, cols), np.inf, dtype=np.float64)
    for r, c in outlets:
        if 0 <= r < rows and 0 <= c < cols and dem[r, c] > nodata:
            cost[r, c] = 0.0

    # Priority queue: (cost, row, col)
    heap = [
        (0.0, r, c) for r, c in outlets if 0 <= r < rows and 0 <= c < cols and dem[r, c] > nodata
    ]
    heapq.heapify(heap)
    visited = np.zeros((rows, cols), dtype=bool)

    dr = [0, 1, 1, 1, 0, -1, -1, -1]
    dc = [1, 1, 0, -1, -1, -1, 0, 1]
    dists = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)]

    while heap:
        cur_cost, r, c = heapq.heappop(heap)
        if visited[r, c]:
            continue
        visited[r, c] = True

        for d in range(8):
            nr, nc = r + dr[d], c + dc[d]
            if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc]:
                if dem[nr, nc] <= nodata:
                    continue

                # Compute move cost
                elev_diff = abs(dem[nr, nc] - dem[r, c])
                move_dist = dists[d] * cell_m

                move_cost = elev_diff * move_dist if cost_function == "slope" else move_dist

                new_cost = cur_cost + move_cost
                if new_cost < cost[nr, nc]:
                    cost[nr, nc] = new_cost
                    heapq.heappush(heap, (new_cost, nr, nc))

    result = np.full((rows, cols), np.nan, dtype=np.float32)
    valid = (cost < np.inf) & (dem > nodata)
    result[valid] = cost[valid]
    result[~valid] = nodata
    return result.astype(np.float32)
