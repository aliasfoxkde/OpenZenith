"""D8 flow direction and flow accumulation.

Steepest-descent D8 flow directions, accumulation by iterative propagation
and by topological sort, maximum accumulation along each flow path, and
stream extraction by accumulation threshold.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

from .constants import D8_DC, D8_DISTANCE, D8_DR
from .depressions import fill_depressions


def d8_flow_direction(dem: np.ndarray, nodata: float = -32768.0) -> np.ndarray:
    """Compute D8 flow direction grid.

    Each cell points to its steepest downhill neighbor.
    Encoded as: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
    Pits (no downhill neighbor) get value -1.

    Args:
        dem: 2D elevation grid (rows=lat, cols=lon)
        nodata: NODATA value to treat as invalid

    Returns:
        2D int8 array of flow directions

    """
    rows, cols = dem.shape
    flow_dir = np.full((rows, cols), -1, dtype=np.int8)

    # Create padded DEM for neighbor access
    padded = np.full((rows + 2, cols + 2), nodata)
    padded[1:-1, 1:-1] = dem

    valid = padded[1:-1, 1:-1] != nodata

    for d in range(8):
        # Get neighbor elevation
        neighbor_elev = padded[
            1 + D8_DR[d] : rows + 1 + D8_DR[d], 1 + D8_DC[d] : cols + 1 + D8_DC[d]
        ]
        # Compute slope (drop per unit distance)
        slope = (dem - neighbor_elev) / D8_DISTANCE[d]
        # Only downhill to valid cells
        downhill = valid & (neighbor_elev != nodata) & (slope > 0)

        # Update if steeper than current best
        if d == 0:
            max_slope = np.where(downhill, slope, -np.inf)
            flow_dir = np.where(downhill, np.int8(d), flow_dir)
        else:
            steeper = downhill & (slope > max_slope)
            max_slope = np.where(steeper, slope, max_slope)
            flow_dir = np.where(steeper, np.int8(d), flow_dir)

    return flow_dir


def flow_accumulation(flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Compute flow accumulation from D8 directions.

    Each cell's value is the count of upstream cells (including itself).

    Uses iterative priority-flood approach for efficiency.

    Args:
        flow_dir: 2D int8 array from d8_flow_direction
        nodata_dir: Direction value indicating no flow (pits)

    Returns:
        2D int32 array of accumulation counts

    """
    rows, cols = flow_dir.shape
    accum = np.ones((rows, cols), dtype=np.int32)
    visited = np.zeros((rows, cols), dtype=bool)

    # Find pit cells (no outgoing flow) and edge cells
    pits = flow_dir == nodata_dir
    edge = np.zeros_like(pits)
    edge[0, :] = True
    edge[-1, :] = True
    edge[:, 0] = True
    edge[:, -1] = True

    # Start from pits and edge cells
    # Use simple iterative propagation
    changed = True
    iterations = 0
    max_iterations = rows * cols * 4  # safety limit

    while changed and iterations < max_iterations:
        changed = False
        iterations += 1

        for d in range(8):
            # Source cells are those whose flow goes in direction d
            # They contribute to the cell at (r + dr[d], c + dc[d])
            dr, dc = int(D8_DR[d]), int(D8_DC[d])

            # For each cell that flows in direction d, add its accumulation to the neighbor
            src_mask = (flow_dir == d) & ~visited

            if not src_mask.any():
                continue

            # Target row/col indices
            src_r, src_c = np.where(src_mask)
            tgt_r = src_r + dr
            tgt_c = src_c + dc

            # Only process valid targets
            valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
            tgt_r = tgt_r[valid]
            tgt_c = tgt_c[valid]
            src_r = src_r[valid]
            src_c = src_c[valid]

            # Add accumulation (numpy advanced indexing with addition)
            np.add.at(accum, (tgt_r, tgt_c), accum[src_r, src_c])
            visited[src_r, src_c] = True
            changed = True

    return accum


def flow_accumulation_fast(flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Fast flow accumulation using topological sort.

    More efficient than iterative for large grids.
    Falls back to iterative if topo-sort fails.
    """
    try:
        return _flow_accumulation_toposort(flow_dir, nodata_dir)
    except Exception:  # noqa: BLE001
        return flow_accumulation(flow_dir, nodata_dir)


def _flow_accumulation_toposort(flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Topological sort approach for flow accumulation."""
    rows, cols = flow_dir.shape
    accum = np.ones((rows, cols), dtype=np.int32)

    # Build reverse adjacency: for each cell, which cells flow INTO it
    # flow_dir[r,c] = d means cell (r,c) flows to (r+dr[d], c+dc[d])
    in_degree = np.zeros((rows, cols), dtype=np.int32)

    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        # Find cells with this flow direction
        mask = flow_dir == d
        if not mask.any():
            continue

        src_r, src_c = np.where(mask)
        tgt_r = np.clip(src_r + dr, 0, rows - 1)
        tgt_c = np.clip(src_c + dc, 0, cols - 1)

        # These target cells have one more incoming edge
        np.add.at(in_degree, (tgt_r, tgt_c), 1)

    # Start with cells that have no incoming edges (sources)
    queue_r, queue_c = np.where(in_degree == 0)

    processed = 0
    max_process = rows * cols

    while len(queue_r) > 0 and processed < max_process:
        # Process all current queue items
        curr_r = queue_r
        curr_c = queue_c

        # For each processed cell, add its accumulation to its target
        new_r = []
        new_c = []

        for d in range(8):
            dr, dc = int(D8_DR[d]), int(D8_DC[d])
            mask = flow_dir[curr_r, curr_c] == d
            if not mask.any():
                continue

            sr = curr_r[mask]
            sc = curr_c[mask]
            tr = np.clip(sr + dr, 0, rows - 1)
            tc = np.clip(sc + dc, 0, cols - 1)

            # Add accumulation
            np.add.at(accum, (tr, tc), accum[sr, sc])

            # Decrement in-degree
            np.subtract.at(in_degree, (tr, tc), 1)

            # Find newly zero in-degree cells
            new_mask = in_degree[tr, tc] == 0
            new_r.extend(tr[new_mask].tolist())
            new_c.extend(tc[new_mask].tolist())

        queue_r = np.array(new_r, dtype=np.int64) if new_r else np.array([], dtype=np.int64)
        queue_c = np.array(new_c, dtype=np.int64) if new_c else np.array([], dtype=np.int64)
        processed += len(curr_r)

    return accum


def flow_accumulation_max(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute flow accumulation using D8 and return the maximum value encountered.

    For each cell, traces the full downstream path and returns the
    maximum flow accumulation value seen anywhere along that path.

    Equivalent to WhiteboxTools MaxFlowpathVal.

    Args:
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D float32 array of max accumulation values along each flow path

    """
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)
    valid = accum > 0

    # For each cell, propagate the max accumulation downstream
    result = accum.copy().astype(np.float32)
    rows, cols = dem.shape

    # Sort cells by accumulation descending — process high-accum cells first
    sorted_cells = np.argsort(accum[valid])[::-1]
    valid_coords = np.argwhere(valid)

    for idx in sorted_cells:
        r, c = valid_coords[idx]
        d = fd[r, c]
        if d == -1:
            continue
        nr = r + int(D8_DR[d])
        nc = c + int(D8_DC[d])
        if 0 <= nr < rows and 0 <= nc < cols and valid[nr, nc]:
            result[nr, nc] = max(result[nr, nc], result[r, c])

    result[~valid] = 0
    return result.astype(np.float32)


def extract_streams(accum: np.ndarray, threshold: int = 100) -> np.ndarray:
    """Extract stream network from flow accumulation.

    Cells with accumulation >= threshold are marked as streams.

    Args:
        accum: 2D int32 array from flow_accumulation
        threshold: Minimum upstream area (in pixels) to be a stream

    Returns:
        2D bool array (True = stream)

    """
    return accum >= threshold
