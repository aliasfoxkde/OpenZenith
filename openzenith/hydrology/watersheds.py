"""Watershed and basin delineation.

Upstream tracing from pour points (single and multi-point), gaged
watersheds, stream basins, sub-basins, basin identifiers, and pour-point
snapping.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

from collections import deque

import numpy as np

from .constants import D8_DC, D8_DR
from .depressions import fill_depressions
from .flow import d8_flow_direction, flow_accumulation_fast
from .streams import _label_streams


def delineate_watershed(
    lat: float,
    lon: float,
    zoom: int = 10,
    radius_cells: int = 200,
    tile_cache_dir: str | None = None,
) -> dict | None:
    """Delineate watershed upstream from a pour point.

    Loads elevation tiles around the point, computes D8 flow directions,
    then traces upstream from the pour point.

    Args:
        lat: Latitude of pour point
        lon: Longitude of pour point
        zoom: Tile zoom level (higher = finer resolution)
        radius_cells: Search radius in cells
        tile_cache_dir: Path to local tile cache (or uses HuggingFace)

    Returns:
        Dict with watershed boundaries, area, elevation stats, or None if failed

    """
    try:
        from openzenith.elevation import load_elevation_grid
    except ImportError:
        print("❌ Watershed delineation requires elevation loading capability")
        return None

    # Load elevation grid centered on pour point
    try:
        result = load_elevation_grid(
            lat,
            lon,
            zoom,
            radius_cells=radius_cells,
            cache_dir=tile_cache_dir,
        )
    except Exception as e:  # noqa: BLE001
        print(f"❌ Could not load elevation data: {e}")
        return None

    dem = result["grid"]
    center_r = result["center_row"]
    center_c = result["center_col"]
    lat_min = result["lat_min"]
    lon_min = result["lon_min"]
    cell_size_deg = result["cell_size_deg"]

    # Replace NaN with NODATA value for hydrology algorithms
    dem = np.where(np.isnan(dem), -32768.0, dem)
    rows, cols = dem.shape

    # If center is NODATA, find nearest valid cell
    if dem[center_r, center_c] <= -30000:
        best_dist = float("inf")
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] > -30000:
                    dist = abs(r - center_r) + abs(c - center_c)
                    if dist < best_dist:
                        best_dist = dist
                        center_r, center_c = r, c
        if best_dist == float("inf"):
            print("❌ No valid elevation data in grid")
            return None

    # Compute flow direction (with depression filling for better results)
    dem_filled = fill_depressions(dem)
    flow_dir = d8_flow_direction(dem_filled)

    # Compute flow accumulation (use fast topological sort)
    flow_accumulation_fast(flow_dir)

    # Trace upstream from pour point
    rows, cols = dem.shape
    watershed = np.zeros((rows, cols), dtype=bool)
    watershed[center_r, center_c] = True

    # BFS upstream: find all cells that eventually flow to the pour point
    # We trace backwards: for each cell in watershed, find all cells that flow INTO it
    queue = deque([(center_r, center_c)])
    visited = {(center_r, center_c)}

    while queue:
        r, c = queue.popleft()
        flow_dir[r, c]

        for d in range(8):
            # Check if neighbor (nr, nc) flows in direction d towards (r, c)
            # That means flow_dir[nr, nc] should be opposite of d
            nr = r - int(D8_DR[d])
            nc = c - int(D8_DC[d])

            if (nr, nc) in visited:
                continue
            if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                continue
            if dem[nr, nc] <= -30000:  # NODATA
                continue

            # Check if this neighbor flows into (r, c)
            # flow_dir[nr, nc] = (d + 4) % 8 would mean nr,nc flows to r,c
            opposite_dir = (d + 4) % 8
            if flow_dir[nr, nc] == opposite_dir:
                visited.add((nr, nc))
                watershed[nr, nc] = True
                queue.append((nr, nc))

    # Compute stats
    ws_pixels = watershed.sum()
    if ws_pixels == 0:
        return None

    cell_size_m = cell_size_deg * 111320  # approximate meters per degree at equator
    area_km2 = ws_pixels * (cell_size_m**2) / 1e6

    ws_elevations = dem[watershed]
    valid_elev = ws_elevations[ws_elevations > -30000]

    # Get boundary coordinates
    ws_rows, ws_cols = np.where(watershed)
    if len(ws_rows) == 0:
        return None

    boundary_coords = []
    for r, c in zip(ws_rows, ws_cols, strict=False):
        # Check if boundary cell
        is_edge = False
        for d in range(8):
            nr, nc = r + int(D8_DR[d]), c + int(D8_DC[d])
            if nr < 0 or nr >= rows or nc < 0 or nc >= cols or not watershed[nr, nc]:
                is_edge = True
                break
        if is_edge:
            boundary_coords.append(
                [
                    lat_min + r * cell_size_deg,
                    lon_min + c * cell_size_deg,
                ]
            )

    return {
        "center": [lat, lon],
        "area_km2": round(area_km2, 2),
        "pixels": int(ws_pixels),
        "min_elev": float(valid_elev.min()) if len(valid_elev) > 0 else None,
        "max_elev": float(valid_elev.max()) if len(valid_elev) > 0 else None,
        "mean_elev": float(valid_elev.mean()) if len(valid_elev) > 0 else None,
        "boundary": boundary_coords[:1000],  # Limit to prevent huge JSON
        "zoom": zoom,
        "cell_size_deg": cell_size_deg,
        "grid_shape": list(dem.shape),
    }


def watershed(
    pour_points: list[tuple[int, int]],
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Delineate watersheds from pour points using D8 flow tracing.

    This is an alias/enhancement of delineate_watershed that accepts
    multiple pour points simultaneously.

    Equivalent to WhiteboxTools Watershed.

    Args:
        pour_points: List of (row, col) pour point coordinates
        dem: 2D elevation grid
        nodata: NODATA value

    Returns:
        2D int32 array of watershed IDs (0 = no watershed)

    """
    rows, cols = dem.shape
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    result = np.zeros((rows, cols), dtype=np.int32)
    for wid, (pr, pc) in enumerate(pour_points, start=1):
        if 0 <= pr < rows and 0 <= pc < cols and dem[pr, pc] > nodata:
            _trace_watershed(result, fd, pr, pc, wid, -1)

    return result


def gage_watershed(
    flow_dir: np.ndarray,
    pour_points: list[tuple[int, int]],
    nodata_dir: int = -1,
) -> np.ndarray:
    """Delineate individual watersheds for a list of pour points.

    Each pour point gets a unique watershed ID.

    Equivalent to WhiteboxTools GageWatershed.

    Args:
        flow_dir: D8 flow direction grid
        pour_points: List of (row, col) pour point coordinates
        nodata_dir: NODATA direction value

    Returns:
        2D int32 array of watershed IDs (0 = no watershed)

    """
    rows, cols = flow_dir.shape
    result = np.zeros(flow_dir.shape, dtype=np.int32)

    for basin_id, (pr, pc) in enumerate(pour_points, start=1):
        if not (0 <= pr < rows and 0 <= pc < cols):
            continue
        if flow_dir[pr, pc] == nodata_dir:
            continue

        # Trace all cells that flow into this pour point
        _trace_watershed(result, flow_dir, pr, pc, basin_id, nodata_dir)

    return result


def _trace_watershed(
    result: np.ndarray,
    flow_dir: np.ndarray,
    pr: int,
    pc: int,
    basin_id: int,
    nodata_dir: int,
) -> None:
    """Recursively trace all cells upstream of a pour point."""
    rows, cols = result.shape

    def trace_recursive(r: int, c: int) -> None:
        if not (0 <= r < rows and 0 <= c < cols):
            return
        if result[r, c] == basin_id:
            return
        if flow_dir[r, c] == nodata_dir:
            return
        d = flow_dir[r, c]
        nr = r + int(D8_DR[d])
        nc = c + int(D8_DC[d])
        result[r, c] = basin_id
        if 0 <= nr < rows and 0 <= nc < cols:
            trace_recursive(nr, nc)

    result[pr, pc] = basin_id
    trace_recursive(pr, pc)


def stream_basins(
    flow_dir: np.ndarray,
    streams: np.ndarray,
    nodata_dir: int = -1,
) -> np.ndarray:
    """Delineate individual stream basins from stream raster and flow direction.

    Each basin is assigned a unique integer ID.

    Equivalent to WhiteboxTools StreamBasins.

    Args:
        flow_dir: D8 flow direction grid (integers 1-8, or 0=flat)
        streams: Boolean or thresholded stream raster (True=stream)
        nodata_dir: NODATA direction value

    Returns:
        2D int32 array of basin IDs (0 = no basin)

    """
    from scipy import ndimage

    rows, cols = flow_dir.shape
    (flow_dir != nodata_dir) & streams

    # Direction offsets: 1=E, 2=NE, 3=N, 4=NW, 5=W, 6=SW, 7=S, 8=SE
    # D8: 1=East, 2=NE, 3=N, 4=NW, 5=W, 6=SW, 7=S, 8=SE
    dr_map = {1: 0, 2: -1, 3: -1, 4: -1, 5: 0, 6: 1, 7: 1, 8: 1}
    dc_map = {1: 1, 2: 1, 3: 0, 4: -1, 5: -1, 6: -1, 7: 0, 8: 1}

    # Label connected stream cells
    labeled_streams, n_streams = ndimage.label(streams)
    result = np.zeros_like(flow_dir, dtype=np.int32)

    for basin_id in range(1, n_streams + 1):
        stream_mask = labeled_streams == basin_id
        # Find outlet (stream cell with no upstream neighbor)
        for r in range(rows):
            for c in range(cols):
                if not stream_mask[r, c]:
                    continue
                d = flow_dir[r, c]
                if d == nodata_dir:
                    continue
                # Check if any neighbor flows into (r,c)
                has_upstream = False
                for prev_d in [1, 2, 3, 4, 5, 6, 7, 8]:
                    pr = r + dr_map[prev_d]
                    pc = c + dc_map[prev_d]
                    if (
                        0 <= pr < rows
                        and 0 <= pc < cols
                        and flow_dir[pr, pc] == prev_d
                        and stream_mask[pr, pc]
                    ):
                        has_upstream = True
                        break
                if not has_upstream:
                    # This is the outlet — trace all cells flowing here
                    _trace_basin(
                        result, flow_dir, stream_mask, r, c, basin_id, dr_map, dc_map, nodata_dir
                    )

    return result


def _trace_basin(
    result: np.ndarray,
    flow_dir: np.ndarray,
    stream_mask: np.ndarray,
    r: int,
    c: int,
    basin_id: int,
    dr_map: dict,
    dc_map: dict,
    nodata_dir: int,
) -> None:
    """Recursively trace all cells draining to (r,c) within the stream mask."""
    rows, cols = result.shape
    if not (0 <= r < rows and 0 <= c < cols):
        return
    if result[r, c] == basin_id:
        return
    if not stream_mask[r, c]:
        return
    if flow_dir[r, c] == nodata_dir:
        return

    result[r, c] = basin_id
    # Trace cells that flow into this one
    d = flow_dir[r, c]
    pr = r - dr_map[d]
    pc = c - dc_map[d]
    if 0 <= pr < rows and 0 <= pc < cols:
        _trace_basin(result, flow_dir, stream_mask, pr, pc, basin_id, dr_map, dc_map, nodata_dir)


def sub_basins(
    flow_dir: np.ndarray,
    streams: np.ndarray,
    nodata_dir: int = -1,
) -> np.ndarray:
    """Partition the domain into sub-basins using stream network.

    Each stream link defines one sub-basin. Cells are assigned to the
    sub-basin of the first stream link encountered when tracing downstream.

    Equivalent to WhiteboxTools Subbasins.

    Args:
        flow_dir: D8 flow direction grid
        streams: Stream raster (True where streams exist)
        nodata_dir: NODATA direction value

    Returns:
        2D int32 array of sub-basin IDs (0 = no basin)

    """
    rows, cols = flow_dir.shape
    valid = (flow_dir != nodata_dir) & streams

    labeled_streams, _n_links = _label_streams(streams, flow_dir, nodata_dir)
    result = np.zeros(flow_dir.shape, dtype=np.int32)

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c]:
                continue
            # Trace to first stream link
            cr, cc = r, c
            visited = set()
            while True:
                if (cr, cc) in visited:
                    break
                visited.add((cr, cc))
                if streams[cr, cc]:
                    link_id = labeled_streams[cr, cc]
                    result[r, c] = link_id
                    break
                d = flow_dir[cr, cc]
                if d == nodata_dir:
                    break
                nr = cr + int(D8_DR[d])
                nc = cc + int(D8_DC[d])
                if not (0 <= nr < rows and 0 <= nc < cols):
                    break
                cr, cc = nr, nc

    return result


def basin_id(
    flow_dir: np.ndarray,
    streams: np.ndarray,
    nodata_dir: int = -1,
) -> np.ndarray:
    """Assign a unique ID to each cell based on which basin it drains to.

    The basin is identified by the unique stream link at the outlet.

    Equivalent to WhiteboxTools BasinID.

    Args:
        flow_dir: D8 flow direction grid
        streams: Stream raster (True = stream cells)
        nodata_dir: NODATA direction value

    Returns:
        2D int32 array of basin IDs

    """
    from scipy import ndimage

    rows, cols = flow_dir.shape
    labeled_streams, n_links = ndimage.label(streams)

    result = np.zeros((rows, cols), dtype=np.int32)

    for link_id in range(1, n_links + 1):
        stream_mask = labeled_streams == link_id
        # Find the outlet of this stream link
        for r in range(rows):
            for c in range(cols):
                if not stream_mask[r, c]:
                    continue
                d = flow_dir[r, c]
                if d == nodata_dir:
                    continue
                # Check if any neighbor flows into (r,c) but is not in the same link
                dr_map = {0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: -1, 6: -1, 7: -1}
                dc_map = {0: 1, 1: 1, 2: 0, 3: -1, 4: -1, 5: -1, 6: 0, 7: 1}
                has_upstream = False
                for prev_d in range(8):
                    pr, pc = r + dr_map[prev_d], c + dc_map[prev_d]
                    if (
                        0 <= pr < rows
                        and 0 <= pc < cols
                        and flow_dir[pr, pc] == prev_d
                        and stream_mask[pr, pc]
                    ):
                        has_upstream = True
                        break
                if not has_upstream:
                    # This is the outlet of link_id — trace all upstream cells
                    _trace_basin(
                        result,
                        flow_dir,
                        labeled_streams == link_id,
                        r,
                        c,
                        link_id,
                        {0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: -1, 6: -1, 7: -1},
                        {0: 1, 1: 1, 2: 0, 3: -1, 4: -1, 5: -1, 6: 0, 7: 1},
                        nodata_dir,
                    )
                    break

    return result


def snap_pour_point(
    pour_points: list[tuple[float, float]],
    dem: np.ndarray,
    flow_dir: np.ndarray,
    search_distance: int = 50,
    nodata: float = -32768.0,
) -> list[tuple[int, int]]:
    """Snap pour points to the nearest stream cell.

    Searches within search_distance cells for the nearest stream cell
    (where flow accumulation is highest along the downslope path).

    Equivalent to WhiteboxTools SnapPourPoints.

    Args:
        pour_points: List of (lat, lon) coordinates
        dem: 2D elevation grid
        flow_dir: D8 flow direction grid
        search_distance: Maximum search distance in cells
        nodata: NODATA value

    Returns:
        List of (row, col) snapped pour point coordinates

    """
    rows, cols = dem.shape
    valid = dem > nodata

    # Build upstream area for weighting
    accum = flow_accumulation_fast(flow_dir)
    accum_norm = accum / (np.max(accum[valid]) + 1e-10)

    snapped = []
    for lat, lon in pour_points:
        # Convert lat/lon to row/col (approximate)
        r = round((90.0 - lat) / (180.0 / rows))
        c = round((lon + 180.0) / (360.0 / cols))
        r = max(0, min(rows - 1, r))
        c = max(0, min(cols - 1, c))

        # Search within search_distance
        best_r, best_c = r, c
        best_weight = -1

        for dr in range(-search_distance, search_distance + 1):
            for dc in range(-search_distance, search_distance + 1):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and valid[nr, nc]:
                    dist = abs(dr) + abs(dc)  # Manhattan distance
                    # Weight: prefer close + high accumulation
                    weight = accum_norm[nr, nc] / (dist + 1)
                    if weight > best_weight:
                        best_weight = weight
                        best_r, best_c = nr, nc

        snapped.append((best_r, best_c))

    return snapped
