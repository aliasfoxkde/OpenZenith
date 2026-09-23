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
            # Cells flowing in direction d land on (src + offset(d))
            mask = flow_dir == d
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

    # Find stream heads: stream cells with no upstream stream neighbor
    stream_mask = streams
    has_upstream = np.zeros_like(stream_mask)
    for d in range(8):
        dr, dc = int(D8_DR[d]), int(D8_DC[d])
        # Cells flowing in direction d land on (src + offset(d))
        src_r, src_c = np.where(stream_mask & (flow_dir == d))
        tgt_r = src_r + dr
        tgt_c = src_c + dc
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
            if (
                0 <= nr < rows
                and 0 <= nc < cols
                and streams[nr, nc]
                # The neighbour flows toward (r,c) iff its direction is d
                # (it sits at (r,c) - offset(d))
                and flow_dir[nr, nc] == d
            ):
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
        walked = {(head_r, head_c)}
        while True:
            up_count = count_upstream_streams(head_r, head_c)
            if up_count >= 2:
                break  # Hit a junction
            # Move to upstream neighbor (never revisit a cell: hand-built
            # flow grids may contain cycles)
            moved = False
            for d in range(8):
                nr = head_r - int(D8_DR[d])
                nc = head_c - int(D8_DC[d])
                if (
                    0 <= nr < rows
                    and 0 <= nc < cols
                    and streams[nr, nc]
                    and flow_dir[nr, nc] == d
                    and (nr, nc) not in walked
                ):
                    walked.add((nr, nc))
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

    # Compute stream order (Strahler) over the link graph. A junction inside
    # a link raises that link's order when two upstream cells from *other*
    # links share the max upstream order. Same-link neighbours never count —
    # a link cannot be its own tributary (counting them made order grow
    # without bound). Each pass only ever raises orders, and an order is
    # bounded by the longest chain of distinct upstream links, so the pass
    # cap below is a backstop rather than the termination argument.
    order = np.ones(n_links + 1, dtype=np.int32)
    n_rows, n_cols = streams.shape
    for _ in range(2 * (n_links + 1)):
        changed = False
        for r in range(n_rows):
            for c in range(n_cols):
                if not streams[r, c]:
                    continue
                link_id = labeled[r, c]
                d = flow_dir[r, c]
                if d == nodata_dir:
                    continue
                # Upstream neighbours: sit at (r, c) - offset(prev_d) and
                # flow in direction prev_d onto (r, c).
                upstream_orders = []
                for prev_d in range(8):
                    pr, pc = r - int(D8_DR[prev_d]), c - int(D8_DC[prev_d])
                    if (
                        0 <= pr < n_rows
                        and 0 <= pc < n_cols
                        and flow_dir[pr, pc] == prev_d
                        and streams[pr, pc]
                        and labeled[pr, pc] != link_id
                    ):
                        upstream_orders.append(order[labeled[pr, pc]])
                if len(upstream_orders) >= 2:
                    max_up = max(upstream_orders)
                    if upstream_orders.count(max_up) >= 2 and max_up + 1 > order[link_id]:
                        order[link_id] = max_up + 1
                        changed = True
        if not changed:
            break

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
