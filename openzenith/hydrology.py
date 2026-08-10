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


def stream_link_identifier(streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Assign unique IDs to stream segments.

    Each continuous stream segment (between junctions) gets a unique ID.
    Segments are defined by cells where streams == True.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction

    Returns:
        2D int32 array of link IDs (0 = not a stream)
    """
    rows, cols = streams.shape
    links = np.zeros((rows, cols), dtype=np.int32)
    next_link_id = 1

    # Find stream cells that don't have a stream cell upstream of them
    # (these are the "heads" of stream links)
    stream_mask = streams

    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        # Cells flowing TO direction (d+4)%8
        src_r, src_c = np.where(stream_mask)
        tgt_r = src_r - dr
        tgt_c = src_c - dc

        valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
        src_r = src_r[valid]
        src_c = src_c[valid]
        tgt_r = tgt_r[valid]
        tgt_c = tgt_c[valid]

        # Mark targets as having an upstream stream neighbor
        # We'll use this to find stream heads

    # Find stream heads: stream cells with no upstream stream neighbor
    has_upstream = np.zeros_like(stream_mask)
    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        src_r, src_c = np.where(stream_mask)
        tgt_r = src_r - dr
        tgt_c = src_c - dc
        valid = (tgt_r >= 0) & (tgt_r < rows) & (tgt_c >= 0) & (tgt_c < cols)
        if valid.any():
            has_upstream[tgt_r[valid], tgt_c[valid]] = True

    heads = stream_mask & ~has_upstream

    # BFS from each head, assigning link IDs
    for h_r, h_c in zip(*np.where(heads)):
        queue = deque([(h_r, h_c)])
        visited = {(h_r, h_c)}
        links[h_r, h_c] = next_link_id

        while queue:
            r, c = queue.popleft()
            # Follow downstream
            fd = flow_dir[r, c]
            if fd == nodata_dir:
                continue
            nr = r + int(D8_DR[fd])
            nc = c + int(D8_DC[fd])
            if 0 <= nr < rows and 0 <= nc < cols and streams[nr, nc] and (nr, nc) not in visited:
                links[nr, nc] = next_link_id
                visited.add((nr, nc))
                queue.append((nr, nc))

        next_link_id += 1

    return links


def stream_reach_identifier(streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Assign unique reach IDs to stream network.

    A reach is a continuous stream segment between two junctions
    (or between a junction and an outlet). This assigns sequential
    IDs to all reaches in the network.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction

    Returns:
        2D int32 array of reach IDs (0 = not a stream)
    """
    rows, cols = streams.shape
    reaches = np.zeros((rows, cols), dtype=np.int32)
    next_reach_id = 1

    # Find junctions: stream cells with multiple upstream stream neighbors
    def count_upstream_streams(r, c):
        count = 0
        for d in range(8):
            nr = r - int(D8_DR[d])
            nc = c - int(D8_DC[d])
            if 0 <= nr < rows and 0 <= nc < cols and streams[nr, nc]:
                # Check if this neighbor actually flows toward (r,c)
                opposite = (d + 4) % 8
                if flow_dir[nr, nc] == opposite:
                    count += 1
        return count

    # Find all junctions and outlets
    junctions = set()
    outlets = set()
    stream_cells = list(zip(*np.where(streams)))

    for r, c in stream_cells:
        up_count = count_upstream_streams(r, c)
        if up_count >= 2:
            junctions.add((r, c))
        if up_count == 0 or flow_dir[r, c] == nodata_dir:
            outlets.add((r, c))

    # For each reach between junctions/outlets, assign an ID
    visited = np.zeros_like(streams)

    for start_r, start_c in stream_cells:
        if visited[start_r, start_c]:
            continue
        if not streams[start_r, start_c]:
            continue

        # Find the upstream end of this reach (a junction or head)
        up_count = count_upstream_streams(start_r, start_c)
        if up_count >= 2:
            continue  # This is a junction, not a reach start

        # Trace upstream to find the head
        head_r, head_c = start_r, start_c
        while True:
            up_count = count_upstream_streams(head_r, head_c)
            if up_count >= 2:
                break  # Hit a junction
            # Move to upstream neighbor
            moved = False
            for d in range(8):
                nr = head_r - int(D8_DR[d])
                nc = head_c - int(D8_DC[d])
                if 0 <= nr < rows and 0 <= nc < cols and streams[nr, nc]:
                    opposite = (d + 4) % 8
                    if flow_dir[nr, nc] == opposite:
                        head_r, head_c = nr, nc
                        moved = True
                        break
            if not moved:
                break

        # Now trace from head to next junction/outlet, assigning reach ID
        queue = deque([(head_r, head_c)])
        visited[head_r, head_c] = True
        reaches[head_r, head_c] = next_reach_id

        while queue:
            r, c = queue.popleft()
            fd = flow_dir[r, c]
            if fd == nodata_dir:
                continue
            nr = r + int(D8_DR[fd])
            nc = c + int(D8_DC[fd])
            if 0 <= nr < rows and 0 <= nc < cols and streams[nr, nc] and not visited[nr, nc]:
                up_count = count_upstream_streams(nr, nc)
                if up_count >= 2:
                    # Hit a junction - this reach ends here
                    visited[nr, nc] = True
                    continue
                reaches[nr, nc] = next_reach_id
                visited[nr, nc] = True
                queue.append((nr, nc))

        next_reach_id += 1

    return reaches


def flood_inundation(
    dem: np.ndarray,
    water_level: float,
    fill_depressions_first: bool = True,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute flood inundation extent at a given water level.

    Returns a boolean mask of cells that would be submerged at the
    specified water surface elevation. Optionally fills depressions
    first to model realistic water pooling.

    Args:
        dem: 2D elevation grid (meters)
        water_level: Water surface elevation in meters
        fill_depressions_first: If True, fill depressions before computing
                               inundation (realistic pooling). If False,
                               only cells below water_level are inundation.
        nodata: NODATA value

    Returns:
        2D bool array where True = inundated
    """
    if fill_depressions_first:
        filled = fill_depressions(dem, nodata)
    else:
        filled = dem

    return (filled < water_level) & (filled > nodata)


def inundation_depth(
    dem: np.ndarray,
    water_level: float,
    fill_depressions_first: bool = True,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute flood inundation depth at a given water level.

    Returns the depth of water above each cell (negative = above water).

    Args:
        dem: 2D elevation grid (meters)
        water_level: Water surface elevation in meters
        fill_depressions_first: If True, fill depressions first
        nodata: NODATA value

    Returns:
        2D float32 array of water depth in meters (negative above water)
    """
    if fill_depressions_first:
        filled = fill_depressions(dem, nodata)
    else:
        filled = dem.astype(np.float32)

    depth = np.full(filled.shape, np.nan, dtype=np.float32)
    valid = filled > nodata
    depth[valid] = water_level - filled[valid]
    depth[depth <= 0] = 0
    return depth


def depression_depth_stats(
    dem: np.ndarray,
    nodata: float = -32768.0,
) -> list[dict]:
    """Compute statistics for each depression in the DEM.

    Uses the fill-depression difference to identify depressions and
    compute their depth, volume, and spill elevation.

    Args:
        dem: 2D elevation grid (meters)
        nodata: NODATA value

    Returns:
        List of dicts with keys: 'row', 'col', 'depth_m', 'volume_m3',
        'spill_elev_m', 'area_m2', 'cell_count'
    """
    filled = fill_depressions(dem, nodata)
    diff = filled - dem.astype(np.float64)

    valid = (diff > 0.1) & (dem > nodata)
    if not valid.any():
        return []

    rows, cols = dem.shape
    cell_size_deg = 0.001
    cell_m = cell_size_deg * 111320.0
    cell_area_m2 = cell_m * cell_m

    # Find connected components (depressions)
    from collections import deque

    visited = np.zeros_like(valid, dtype=bool)
    depressions = []

    for r in range(rows):
        for c in range(cols):
            if not valid[r, c] or visited[r, c]:
                continue

            # BFS to find all cells in this depression
            cells = []
            queue = deque([(r, c)])
            visited[r, c] = True
            min_elev = float(filled[r, c])
            original_elevs = []

            while queue:
                cr, cc = queue.popleft()
                cells.append((cr, cc))
                original_elevs.append(dem[cr, cc])
                min_elev = min(min_elev, filled[cr, cc])

                for d in range(8):
                    nr = cr + int(D8_DR[d])
                    nc = cc + int(D8_DC[d])
                    if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc] and valid[nr, nc]:
                        visited[nr, nc] = True
                        queue.append((nr, nc))

            if not cells:
                continue

            # Compute stats
            orig_elevs = np.array(original_elevs, dtype=np.float64)
            max_orig = orig_elevs.max()
            depth = max_orig - min_elev
            spill_elev = filled[cells[0][0], cells[0][1]] if cells else max_orig
            volume = depth * len(cells) * cell_area_m2
            area = len(cells) * cell_area_m2

            depressions.append({
                "row": r,
                "col": c,
                "depth_m": round(depth, 2),
                "volume_m3": round(volume, 2),
                "spill_elev_m": round(spill_elev, 2),
                "area_m2": round(area, 2),
                "cell_count": len(cells),
            })

    # Sort by depth (deepest first)
    depressions.sort(key=lambda x: x["depth_m"], reverse=True)
    return depressions


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
    bank_right_elev = elevations[bank_right_idx] if bank_right_idx < len(elevations) else center_elev
    bank_elev = min(bank_left_elev, bank_right_elev)

    # Width
    width_m = abs(bank_right_idx - bank_left_idx) * cell_m

    # Max depth below bank
    max_depth = max(0.0, bank_elev - center_elev)

    # Cross-section area (trapezoidal approximation below bank level)
    active_elevs = [max(bank_elev, e) for e in elevations[bank_left_idx:bank_right_idx + 1]]
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


def stream_power_index(
    dem: np.ndarray,
    flow_accum: np.ndarray | None = None,
    cell_size_deg: float = 0.001,
    nodata: float = -32768.0,
) -> np.ndarray:
    """Compute Stream Power Index (SPI).

    SPI = ln(accum × cell_area × tan(slope))
    where accum is the upslope contributing area in cells.
    High SPI indicates areas with high erosion potential.

    Args:
        dem: 2D elevation grid
        flow_accum: Optional flow accumulation grid. If None, computed from dem.
        cell_size_deg: Cell size in degrees
        nodata: NODATA value

    Returns:
        2D float32 array of SPI values
    """
    from openzenith.terrain import slope as calc_slope

    # Fill depressions for proper flow routing
    filled = fill_depressions(dem, nodata)
    fd = d8_flow_direction(filled, nodata)

    if flow_accum is None:
        flow_accum = flow_accumulation_fast(fd)

    # Slope in radians
    slp = calc_slope(dem, cell_size_deg, nodata)
    slope_rad = np.deg2rad(slp)

    # Cell area in square meters
    cell_m = cell_size_deg * 111320.0
    cell_area = cell_m * cell_m

    # SPI = ln(accum * cell_area * tan(slope))
    accum_m2 = flow_accum.astype(np.float64) * cell_area
    tan_slope = np.tan(slope_rad)

    # Avoid log(0) and tan(0)
    tan_slope = np.maximum(tan_slope, 1e-10)
    accum_m2 = np.maximum(accum_m2, 1e-10)

    spi = np.log(accum_m2 * tan_slope)

    # Mask invalid cells
    valid = (dem != nodata) & (flow_accum > 0)
    result = np.where(valid, spi, np.nan).astype(np.float32)

    return result


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
