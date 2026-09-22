"""Elevation and flow-path profiles.

Elevation profiles along a cell path, hillslope profiles traced upslope from
an outlet, and D8 flow-path lengths (downslope and upslope).

This module was split out of the former single-module ``openzenith.terrain``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np


def profile(
    dem: np.ndarray, points: list[tuple[int, int]], cell_size_deg: float = 0.001
) -> list[dict]:
    """Extract elevation profile along a line of cells.

    Args:
        dem: 2D elevation grid (meters)
        points: List of (row, col) pairs defining the profile path
        cell_size_deg: Cell size in degrees

    Returns:
        List of dicts with 'distance_m', 'elevation', 'row', 'col'

    """
    if len(points) < 2:
        return []

    cell_m = cell_size_deg * 111320.0
    result = [
        {
            "distance_m": 0.0,
            "elevation": float(dem[points[0]]),
            "row": points[0][0],
            "col": points[0][1],
        }
    ]

    total_dist = 0.0
    for i in range(1, len(points)):
        r0, c0 = points[i - 1]
        r1, c1 = points[i]
        seg_dist = np.sqrt(((r1 - r0) * cell_m) ** 2 + ((c1 - c0) * cell_m) ** 2)
        total_dist += seg_dist
        result.append(
            {
                "distance_m": round(total_dist, 1),
                "elevation": float(dem[r1, c1]),
                "row": r1,
                "col": c1,
            }
        )

    return result


def hillslope_profile(
    dem: np.ndarray,
    outlet_row: int,
    outlet_col: int,
    nodata: float = -32768.0,
) -> list[dict]:
    """Extract hillslope profile from outlet to ridge.

    Traces upslope from the outlet to the divide, returning elevation
    and distance at each step.

    Args:
        dem: 2D elevation grid
        outlet_row: Row of the outlet point
        outlet_col: Column of the outlet point
        nodata: NODATA value

    Returns:
        List of dicts with keys: distance_m, elevation

    """
    from openzenith.hydrology import d8_flow_direction

    rows, cols = dem.shape
    fd = d8_flow_direction(dem, nodata)
    cell_m = 0.001 * 111320.0

    profile = []
    cr, cc = outlet_row, outlet_col
    total_dist = 0.0
    dem[cr, cc]

    while True:
        profile.append({"distance_m": total_dist, "elevation": float(dem[cr, cc])})
        d = fd[cr, cc]
        if d == -1:
            break
        nr = cr + int(np.array([0, 1, 1, 1, 0, -1, -1, -1])[d])
        nc = cc + int(np.array([1, 1, 0, -1, -1, -1, 0, 1])[d])
        if not (0 <= nr < rows and 0 <= nc < cols):
            break
        dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][d]
        total_dist += dist * cell_m
        cr, cc = nr, nc
        if dem[cr, cc] <= nodata:
            break

    return profile


def flow_length(
    dem: np.ndarray,
    direction: str = "downslope",
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute longest flow path length from each cell to grid edge.

    For each cell, traces the flow path (using D8) and returns the total
    path length in meters.

    Equivalent to WhiteboxTools FlowLength.

    Args:
        dem: 2D elevation grid
        direction: "downslope" or "upslope"
        nodata: NODATA value

    Returns:
        2D float32 array of flow path lengths (meters)

    """
    from openzenith.hydrology import d8_flow_direction

    rows, cols = dem.shape

    fd = d8_flow_direction(dem, nodata)
    result = np.full((rows, cols), 0.0, dtype=np.float32)

    cell_m = 0.001 * 111320.0  # approximate

    if direction == "downslope":
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] <= nodata:
                    continue
                cr, cc = r, c
                length = 0.0
                visited = set()
                while True:
                    if (cr, cc) in visited:
                        break
                    visited.add((cr, cc))
                    d = fd[cr, cc]
                    if d == -1:
                        break
                    di = int(d)
                    nr = cr + int(np.array([0, 1, 1, 1, 0, -1, -1, -1])[di])
                    nc = cc + int(np.array([1, 1, 0, -1, -1, -1, 0, 1])[di])
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        break
                    dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][di]
                    length += dist * cell_m
                    cr, cc = nr, nc
                result[r, c] = length
    else:  # upslope
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] <= nodata:
                    continue
                # Trace all cells that flow into (r,c)
                length = _upslope_flow_length(dem, fd, r, c, nodata)
                result[r, c] = length

    return result


def _upslope_flow_length(
    dem: np.ndarray,
    fd: np.ndarray,
    tr: int,
    tc: int,
    nodata: float,
) -> float:
    """Compute total upslope flow length for a target cell."""
    rows, cols = dem.shape
    cell_m = 0.001 * 111320.0

    dr_map = {0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: -1, 6: -1, 7: -1}
    dc_map = {0: 1, 1: 1, 2: 0, 3: -1, 4: -1, 5: -1, 6: 0, 7: 1}

    def trace(r, c, visited):
        if (r, c) in visited or dem[r, c] <= nodata or fd[r, c] == -1:
            return 0.0
        visited.add((r, c))
        d = int(fd[r, c])
        dist = [1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)][d]
        nr = r + dr_map[d]
        nc = c + dc_map[d]
        if 0 <= nr < rows and 0 <= nc < cols:
            return dist * cell_m + trace(nr, nc, visited)
        return dist * cell_m

    visited = set()
    return trace(tr, tc, visited)
