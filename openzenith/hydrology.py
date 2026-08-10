"""OpenZenith Hydrology — D8 flow direction, flow accumulation, stream extraction, watershed.

Implements standard terrain hydrology algorithms:
- D8 flow direction (steepest descent neighbor)
- Flow accumulation (upstream area counting)
- Priority-flood depression filling
- Stream extraction (accumulation threshold)
- Watershed delineation (upstream tracing from pour point)
- Stream extraction (accumulation threshold)
- Watershed delineation (upstream tracing from pour point)

For compute-intensive applications, use the local SDK instead of the web API
to avoid HTTPS chunk download overhead on every tile request.

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

from collections import deque

import numpy as np

# D8 direction encoding: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
# Row/col offsets for each direction
D8_DR = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int16)
D8_DC = np.array([1, 1, 0, -1, -1, -1, 0, 1], dtype=np.int16)
D8_DISTANCE = np.array([1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)])


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
        neighbor_elev = padded[1 + D8_DR[d]:rows + 1 + D8_DR[d],
                               1 + D8_DC[d]:cols + 1 + D8_DC[d]]
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


def stream_order(streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Compute Strahler stream order.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction

    Returns:
        2D int32 array of Strahler orders (0 = not a stream)
    """
    rows, cols = streams.shape
    order = np.where(streams, np.int32(1), np.int32(0))

    # Count inflowing streams for each cell
    # Iterate until stable
    changed = True
    iterations = 0
    while changed and iterations < 20:
        changed = False
        iterations += 1

        for d in range(8):
            dr, dc = int(D8_DR[d]), int(D8_DC[d])
            # Cells flowing into current cell from direction (d+4)%8
            in_dir = (d + 4) % 8
            mask = flow_dir == in_dir
            if not mask.any():
                continue

            src_r, src_c = np.where(mask)
            tgt_r = src_r + dr
            tgt_c = src_c + dc

            valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols) & streams[src_r, src_c]
            sr = src_r[valid]
            sc = src_c[valid]
            tr = tgt_r[valid]
            tc = tgt_c[valid]

            src_order = order[sr, sc]
            tgt_order = order[tr, tc]

            # Strahler: max + 1 if two or more same-order streams meet
            update_mask = src_order >= tgt_order
            if update_mask.any():
                ur = tr[update_mask]
                uc = tc[update_mask]
                uo = src_order[update_mask]

                # Check if there are multiple inflowing streams of the same max order
                for i in range(len(ur)):
                    r, c, o = ur[i], uc[i], uo[i]
                    # Count inflowing streams with order == current max
                    count = 0
                    for dd in range(8):
                        irr, icc = r - int(D8_DR[dd]), c - int(D8_DC[dd])
                        if 0 <= irr < rows and 0 <= icc < cols and flow_dir[irr, icc] == dd and streams[irr, icc] and order[irr, icc] >= o:
                                count += 1
                    if count >= 2:
                        new_order = o + 1
                    else:
                        new_order = o
                    if new_order > order[r, c]:
                        order[r, c] = new_order
                        changed = True

    return order


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
            lat, lon, zoom,
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
        best_dist = float('inf')
        for r in range(rows):
            for c in range(cols):
                if dem[r, c] > -30000:
                    dist = abs(r - center_r) + abs(c - center_c)
                    if dist < best_dist:
                        best_dist = dist
                        center_r, center_c = r, c
        if best_dist == float('inf'):
            print("❌ No valid elevation data in grid")
            return None

    # Compute flow direction (with depression filling for better results)
    dem_filled = fill_depressions(dem)
    flow_dir = d8_flow_direction(dem_filled)

    # Compute flow accumulation (use fast topological sort)
    from openzenith.hydrology import flow_accumulation_fast
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
    area_km2 = ws_pixels * (cell_size_m ** 2) / 1e6

    ws_elevations = dem[watershed]
    valid_elev = ws_elevations[ws_elevations > -30000]

    # Get boundary coordinates
    ws_rows, ws_cols = np.where(watershed)
    if len(ws_rows) == 0:
        return None

    boundary_coords = []
    for r, c in zip(ws_rows, ws_cols):
        # Check if boundary cell
        is_edge = False
        for d in range(8):
            nr, nc = r + int(D8_DR[d]), c + int(D8_DC[d])
            if nr < 0 or nr >= rows or nc < 0 or nc >= cols or not watershed[nr, nc]:
                is_edge = True
                break
        if is_edge:
            boundary_coords.append([
                lat_min + r * cell_size_deg,
                lon_min + c * cell_size_deg,
            ])

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


def twi(
    dem: np.ndarray,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Topographic Wetness Index (TWI).

    TWI = ln(a / tan(β))
    where a = specific catchment area (flow_accumulation × cell_area)
    and β = slope in radians.

    High TWI indicates areas prone to saturation and water accumulation.
    Low TWI indicates well-drained ridges and slopes.

    Args:
        dem: 2D elevation grid
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of TWI values. NODATA cells and cells with
        zero slope are set to NaN.
    """
    from openzenith.terrain import slope as calc_slope

    # Fill depressions for proper flow routing
    filled = fill_depressions(dem, nodata)

    # Flow direction and accumulation
    fd = d8_flow_direction(filled, nodata)
    accum = flow_accumulation_fast(fd)

    # Slope in degrees
    slp = calc_slope(dem, cell_size_deg, nodata)

    # Cell area in square meters
    cell_m = cell_size_deg * 111320.0
    cell_area = cell_m * cell_m

    # Specific catchment area
    sca = accum.astype(np.float64) * cell_area

    # TWI = ln(sca / tan(slope_rad))
    # Avoid division by zero: mask slope < 0.1 degrees
    slope_rad = np.deg2rad(slp)
    slope_rad[slope_rad < np.deg2rad(0.1)] = np.nan

    tan_slope = np.tan(slope_rad)
    result = np.log(sca / tan_slope)

    # Mask nodata cells
    valid = dem != nodata
    result[~valid] = np.nan

    # Clip to reasonable range
    result = np.clip(result, 0, 25)

    return result.astype(np.float32)
