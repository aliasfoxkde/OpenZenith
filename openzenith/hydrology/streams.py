"""Stream network topology: order, links, reaches, and classes.

Strahler stream ordering plus segmentation of the stream network into
unique links, reaches, and Strahler-ordered link classes.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

from collections import deque

import numpy as np

from .constants import D8_DC, D8_DR


def stream_order(streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1) -> np.ndarray:
    """Compute Strahler stream order.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction
        nodata_dir: Direction value marking cells with no downstream flow (pits)

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

            valid = (
                (tgt_r >= 0)
                & (tgt_r < rows)
                & (tgt_c >= 0)
                & (tgt_c < cols)
                & streams[src_r, src_c]
            )
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
                        if (
                            0 <= irr < rows
                            and 0 <= icc < cols
                            and flow_dir[irr, icc] == dd
                            and streams[irr, icc]
                            and order[irr, icc] >= o
                        ):
                            count += 1
                    new_order = o + 1 if count >= 2 else o
                    if new_order > order[r, c]:
                        order[r, c] = new_order
                        changed = True

    return order


def stream_link_identifier(
    streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1
) -> np.ndarray:
    """Assign unique IDs to stream segments.

    Each continuous stream segment (between junctions) gets a unique ID.
    Segments are defined by cells where streams == True.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction
        nodata_dir: Direction value marking cells with no downstream flow (pits)

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
    for h_r, h_c in zip(*np.where(heads), strict=False):
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


def stream_reach_identifier(
    streams: np.ndarray, flow_dir: np.ndarray, nodata_dir: int = -1
) -> np.ndarray:
    """Assign unique reach IDs to stream network.

    A reach is a continuous stream segment between two junctions
    (or between a junction and an outlet). This assigns sequential
    IDs to all reaches in the network.

    Args:
        streams: 2D bool array from extract_streams
        flow_dir: 2D int8 array from d8_flow_direction
        nodata_dir: Direction value marking cells with no downstream flow (pits)

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
    stream_cells = list(zip(*np.where(streams), strict=False))

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


def stream_link_class(
    streams: np.ndarray,
    flow_dir: np.ndarray,
    nodata_dir: int = -1,
) -> np.ndarray:
    """Classify stream links by stream order (Strahler).

    Assigns each stream cell its stream order (1 = headwater,
    2 = where two 1st-order streams meet, etc.).

    Args:
        streams: Boolean stream raster
        flow_dir: D8 flow direction grid
        nodata_dir: NODATA direction value

    Returns:
        2D int32 array of stream orders

    """
    from scipy import ndimage

    labeled, n_links = ndimage.label(streams)
    result = np.zeros(streams.shape, dtype=np.int32)

    # Assign order 1 to all links initially
    for link_id in range(1, n_links + 1):
        result[labeled == link_id] = 1

    # Compute stream order (Strahler)
    order = np.ones(n_links + 1, dtype=np.int32)
    changed = True
    while changed:
        changed = False
        for r in range(streams.shape[0]):
            for c in range(streams.shape[1]):
                if not streams[r, c]:
                    continue
                link_id = labeled[r, c]
                d = flow_dir[r, c]
                if d == nodata_dir:
                    continue
                # Check if any upstream neighbor has higher order
                dr_map = {0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: -1, 6: -1, 7: -1}
                dc_map = {0: 1, 1: 1, 2: 0, 3: -1, 4: -1, 5: -1, 6: 0, 7: 1}
                upstream_orders = []
                for prev_d in range(8):
                    pr, pc = r + dr_map[prev_d], c + dc_map[prev_d]
                    if (
                        0 <= pr < streams.shape[0]
                        and 0 <= pc < streams.shape[1]
                        and flow_dir[pr, pc] == prev_d
                        and streams[pr, pc]
                    ):
                        upstream_orders.append(order[labeled[pr, pc]])
                if len(upstream_orders) >= 2:
                    max_up = max(upstream_orders)
                    if upstream_orders.count(max_up) >= 2:
                        new_order = max_up + 1
                        if new_order > order[link_id]:
                            order[link_id] = new_order
                            changed = True

    for link_id in range(1, n_links + 1):
        result[labeled == link_id] = order[link_id]

    return result


def _label_streams(
    streams: np.ndarray,
    flow_dir: np.ndarray,
    nodata_dir: int,
) -> tuple[np.ndarray, int]:
    """Label connected stream segments as unique links."""
    from scipy import ndimage

    labeled, n = ndimage.label(streams)
    return labeled, n
