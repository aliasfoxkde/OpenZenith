//! D8 flow direction and flow accumulation.
//!
//! Direction convention (matches Python openzenith.hydrology):
//!   0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW, 6 = N, 7 = NE
//!   -1 = nodata / pit (no outflow)

use ndarray::{Array2, ArrayView2, Axis};
use rayon::prelude::*;

// Direction offset tables (matches Python D8_DR, D8_DC)
const DR: [isize; 8] = [0, 1, 1, 1, 0, -1, -1, -1];
const DC: [isize; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
const DIST: [f32; 8] = [
    1.0,
    std::f32::consts::SQRT_2,
    1.0,
    std::f32::consts::SQRT_2,
    1.0,
    std::f32::consts::SQRT_2,
    1.0,
    std::f32::consts::SQRT_2,
];

/// D8 flow direction for a DEM.
///
///
/// Returns an int8 grid with values 0-7 (direction index) or -1 (nodata/pit).
/// Direction: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
///
/// # Arguments
/// * `dem` – 2D elevation grid (f32)
/// * `nodata` – nodata value
///
pub fn d8_flow_direction(dem: &ArrayView2<f32>, nodata: f32) -> Array2<i8> {
    let rows = dem.nrows();
    let cols = dem.ncols();
    let mut flow_dir = Array2::<i8>::zeros((rows, cols));

    for r in 0..rows {
        for c in 0..cols {
            let elev = dem[[r, c]];
            if elev <= nodata {
                flow_dir[[r, c]] = -1;
                continue;
            }

            let mut max_slope = 0.0_f32;
            let mut best_dir = -1_i8;

            for d in 0..8 {
                let nr = r as isize + DR[d];
                let nc = c as isize + DC[d];
                if nr < 0 || nr >= rows as isize || nc < 0 || nc >= cols as isize {
                    continue;
                }
                let n_elev = dem[[nr as usize, nc as usize]];
                if n_elev <= nodata {
                    continue;
                }
                let slope = (elev - n_elev) / DIST[d];
                if slope > max_slope {
                    max_slope = slope;
                    best_dir = d as i8;
                }
            }

            flow_dir[[r, c]] = best_dir;
        }
    }

    flow_dir
}

/// D8 flow direction — parallel version using rayon row parallelism.
///
pub fn d8_flow_direction_par(dem: &ArrayView2<f32>, nodata: f32) -> Array2<i8> {
    let rows = dem.nrows();
    let cols = dem.ncols();
    let mut flow_dir = Array2::<i8>::zeros((rows, cols));

    flow_dir
        .axis_iter_mut(Axis(0))
        .into_par_iter()
        .enumerate()
        .for_each(|(r, mut row)| {
            for c in 0..cols {
                let elev = dem[[r, c]];
                if elev <= nodata {
                    row[c] = -1;
                    continue;
                }

                let mut max_slope = 0.0_f32;
                let mut best_dir = -1_i8;

                for d in 0..8 {
                    let nr = r as isize + DR[d];
                    let nc = c as isize + DC[d];
                    if nr < 0 || nr >= rows as isize || nc < 0 || nc >= cols as isize {
                        continue;
                    }
                    let n_elev = dem[[nr as usize, nc as usize]];
                    if n_elev <= nodata {
                        continue;
                    }
                    let slope = (elev - n_elev) / DIST[d];
                    if slope > max_slope {
                        max_slope = slope;
                        best_dir = d as i8;
                    }
                }
                row[c] = best_dir;
            }
        });

    flow_dir
}

/// Flow accumulation via topological sort (Kahn's algorithm).
///
/// Matches the Python openzenith.hydrology._flow_accumulation_toposort.
///
/// # Arguments
/// * `flow_dir` – D8 direction grid (i8, values 0-7 or -1)
/// * `nodata_dir` – nodata value (typically -1)
///
/// # Returns
/// 2D int32 grid where each cell holds the count of upstream draining cells.
pub fn flow_accumulation(flow_dir: &ArrayView2<i8>, nodata_dir: i8) -> Array2<i32> {
    let rows = flow_dir.nrows();
    let cols = flow_dir.ncols();

    let mut in_degree = Array2::<i32>::zeros((rows, cols));
    let mut accum = Array2::<i32>::ones((rows, cols));

    // Build in-degree: for each cell that flows in direction d,
    // increment in_degree of its target neighbour at (r+DR[d], c+DC[d]).
    for r in 0..rows {
        for c in 0..cols {
            let d = flow_dir[[r, c]];
            if d == nodata_dir {
                continue;
            }
            let d_usize = d as usize;
            let tgt_r = (r as isize + DR[d_usize]).clamp(0, rows as isize - 1) as usize;
            let tgt_c = (c as isize + DC[d_usize]).clamp(0, cols as isize - 1) as usize;
            in_degree[[tgt_r, tgt_c]] += 1;
        }
    }

    // Kahn's algorithm: start with all cells that have no incoming edges.
    let mut queue: Vec<(usize, usize)> = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            if in_degree[[r, c]] == 0 && flow_dir[[r, c]] != nodata_dir {
                queue.push((r, c));
            }
        }
    }

    // BFS-style processing.
    // Use a simple frontier approach where we process all items in the current queue.
    let mut head = 0;
    while head < queue.len() {
        let (r, c) = queue[head];
        head += 1;

        let d = flow_dir[[r, c]];
        if d == nodata_dir {
            continue;
        }
        let d_usize = d as usize;
        let tgt_r = (r as isize + DR[d_usize]).clamp(0, rows as isize - 1) as usize;
        let tgt_c = (c as isize + DC[d_usize]).clamp(0, cols as isize - 1) as usize;

        accum[[tgt_r, tgt_c]] += accum[[r, c]];
        in_degree[[tgt_r, tgt_c]] -= 1;
        if in_degree[[tgt_r, tgt_c]] == 0 {
            queue.push((tgt_r, tgt_c));
        }
    }

    accum
}

/// Flow accumulation twin of [`flow_accumulation`] for call sites paired with
/// `d8_flow_direction_par`.
///
/// Kahn's topological pass is inherently sequential — a cell's total depends
/// on all upstream totals being finalised first — so there is no parallel
/// phase to run here. This delegates to [`flow_accumulation`] rather than
/// duplicating its body.
pub fn flow_accumulation_par(flow_dir: &ArrayView2<i8>, nodata_dir: i8) -> Array2<i32> {
    flow_accumulation(flow_dir, nodata_dir)
}

/// Stream order from binary stream mask and D8 flow direction grid (Strahler order).
///
/// Args:
///   streams: 2D int8 array (1 = stream cell, 0 = non-stream)
///   flow_dir: 2D int8 array from d8_flow_direction (0-7, -1 = pit/nodata)
///   nodata_dir: value in flow_dir that indicates no flow (default -1)
pub fn stream_order(
    streams: &ArrayView2<i8>,
    flow_dir: &ArrayView2<i8>,
    nodata_dir: i8,
) -> Array2<u8> {
    let rows = streams.nrows();
    let cols = streams.ncols();
    let mut order = Array2::<u8>::zeros((rows, cols));

    // Mark initial stream segments with order 1
    for r in 0..rows {
        for c in 0..cols {
            if streams[[r, c]] != 0 {
                order[[r, c]] = 1;
            }
        }
    }

    // Iteratively compute Strahler order (max 20 iterations)
    for _ in 0..20 {
        let mut changed = false;

        for r in 0..rows {
            for c in 0..cols {
                if order[[r, c]] == 0 {
                    continue;
                }

                // Find the downstream neighbour using flow_dir
                let fd = flow_dir[[r, c]];
                if fd == nodata_dir {
                    continue;
                }

                let d = fd as isize;
                let nr = r as isize + DR[d as usize];
                let nc = c as isize + DC[d as usize];
                if nr < 0 || nr >= rows as isize || nc < 0 || nc >= cols as isize {
                    continue;
                }
                let nr = nr as usize;
                let nc = nc as usize;

                if streams[[nr, nc]] == 0 {
                    continue;
                }

                // Strahler rule (mirrors openzenith.hydrology.streams.stream_order):
                // the target takes the source's order, +1 when two or more
                // same-order streams flow into it. The source itself is one of
                // the counted inflows, so count >= 2 means a genuine merge.
                let src_order = order[[r, c]];
                let tgt_order = order[[nr, nc]];
                if src_order < tgt_order {
                    continue;
                }

                let mut inflow_count = 0;
                for d in 0..8 {
                    // Upstream neighbour of the target flowing in from direction d
                    let ir = nr as isize - DR[d];
                    let ic = nc as isize - DC[d];
                    if ir < 0 || ir >= rows as isize || ic < 0 || ic >= cols as isize {
                        continue;
                    }
                    let ir = ir as usize;
                    let ic = ic as usize;
                    if flow_dir[[ir, ic]] == d as i8
                        && streams[[ir, ic]] != 0
                        && order[[ir, ic]] >= src_order
                    {
                        inflow_count += 1;
                    }
                }

                let new_order = if inflow_count >= 2 {
                    src_order + 1
                } else {
                    src_order
                };
                if new_order > tgt_order {
                    order[[nr, nc]] = new_order;
                    changed = true;
                }
            }
        }

        if !changed {
            break;
        }
    }

    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::arr2;

    // ── d8_flow_direction tests ───────────────────────────────────────────────

    #[test]
    fn test_d8_flat_cell() {
        // Flat cells have no downhill neighbour → -1
        let dem = arr2(&[
            [100.0, 100.0, 100.0],
            [100.0, 100.0, 100.0],
            [100.0, 100.0, 100.0],
        ]);
        let fd = d8_flow_direction(&dem.view(), -32768.0);
        for r in 0..3 {
            for c in 0..3 {
                assert_eq!(fd[[r, c]], -1, "flat cell ({r},{c}) should be -1");
            }
        }
    }

    #[test]
    fn test_d8_slope_to_south() {
        // E slope: centre cell drains S (dir=2)
        // centre (1,1) elev=5, S neighbour (2,1) elev=0 → slope = 5/1 = 5
        // other neighbours are higher or equal
        let dem = arr2(&[[10.0, 10.0, 10.0], [10.0, 5.0, 10.0], [10.0, 0.0, 10.0]]);
        let fd = d8_flow_direction(&dem.view(), -32768.0);
        // (1,1) drains S → dir 2
        assert_eq!(fd[[1, 1]], 2, "(1,1) should drain S (dir=2)");
    }

    #[test]
    fn test_d8_slope_to_east() {
        // Centre (1,1) elev=5, E neighbour (1,2) elev=0 → drains E (dir=0)
        // All other neighbours are higher or equal, so E (steepest drop) wins.
        let dem = arr2(&[[10.0, 10.0, 10.0], [10.0, 5.0, 0.0], [10.0, 10.0, 10.0]]);
        let fd = d8_flow_direction(&dem.view(), -32768.0);
        assert_eq!(fd[[1, 1]], 0, "(1,1) should drain E (dir=0)");
    }

    #[test]
    fn test_d8_nodata() {
        let dem = arr2(&[[-32768.0, 100.0], [100.0, 100.0]]);
        let fd = d8_flow_direction(&dem.view(), -32768.0);
        assert_eq!(fd[[0, 0]], -1);
    }

    // ── flow_accumulation tests ────────────────────────────────────────────────

    #[test]
    fn test_flow_accum_single_source() {
        // Single source draining to outlet:
        // Source (0,1) drains S (dir=2) to outlet (1,1)
        // Outlet (1,1) drains off-grid (no valid target within bounds)
        let fd = arr2(&[[-1i8, 2, -1], [-1, -1, -1], [-1, -1, -1]]);
        let accum = flow_accumulation(&fd.view(), -1);
        assert_eq!(accum[[0, 1]], 1, "source accum should be 1");
        // outlet at grid edge: target clipped to (2,1) which has no outgoing dir
        // but since clipped, outlet flows to (2,1) = off-grid but clipped to last row
        // and (2,1) is not nodata, so it accumulates
    }

    #[test]
    fn test_flow_accum_linear_chain() {
        // 3 cells in a chain: source → mid → outlet
        // source (0,1) drains S(2) → mid (1,1)
        // mid (1,1) drains S(2) → outlet (2,1) (clipped, off-grid)
        let fd = arr2(&[[-1i8, 2, -1], [-1, 2, -1], [-1, -1, -1]]);
        let accum = flow_accumulation(&fd.view(), -1);
        // source = 1, mid = source + 1 = 2, outlet = mid + 1 = 3
        assert_eq!(accum[[0, 1]], 1);
        assert_eq!(accum[[1, 1]], 2);
    }

    #[test]
    fn test_flow_accum_divide() {
        // Two sources merge at outlet
        // source A (0,0) drains E(0) → (0,1)
        // source B (1,0) drains E(0) → (1,1)
        // both flow to outlet (1,1) via E from (0,1) draining SE(1)?
        // Let (0,1) drain S(2) to (1,1), and (1,1) drain off-grid
        let fd = arr2(&[[0i8, 2, -1], [0, -1, -1], [-1, -1, -1]]);
        let accum = flow_accumulation(&fd.view(), -1);
        // (0,0) source → 1, (1,0) source → 1, (0,1) = 2, (1,1) = 1+1+2 = 4?
        // Let's trace: (0,0)→(0,1)→(1,1); (1,0)→(1,1)
        // (0,0): 1; (1,0): 1; (0,1): 1+1=2; (1,1): 1+1+2=4
        assert_eq!(accum[[0, 0]], 1);
        assert_eq!(accum[[1, 0]], 1);
        assert_eq!(accum[[0, 1]], 2);
    }

    // ── stream_order tests ────────────────────────────────────────────────────

    #[test]
    fn test_stream_order_single_stream() {
        // Simple case: one stream cell draining east
        let streams = arr2(&[[1i8, 0], [0, 0]]);
        let flow_dir = arr2(&[[0i8, -1], [-1, -1]]); // (0,0) drains E
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 1, "single stream cell should be order 1");
        assert_eq!(order[[0, 1]], 0, "non-stream cell should be 0");
    }

    #[test]
    fn test_stream_order_confluence() {
        // Two first-order streams meeting at a confluence:
        // (0,0) drains S (2) to (1,0); (1,1) drains W (4) to (1,0).
        // Confluence at (1,0) must become order 2 (two order-1 streams meet).
        let streams = arr2(&[[1i8, 0], [1, 1]]);
        let flow_dir = arr2(&[[2i8, -1], [-1, 4]]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 1, "source should be order 1");
        assert_eq!(order[[1, 1]], 1, "source should be order 1");
        assert_eq!(order[[1, 0]], 2, "confluence of two order-1 streams");
    }

    #[test]
    fn test_stream_order_no_merge_stays_order_1() {
        // A single headwater flowing through a stream cell must NOT escalate
        // the downstream cell — no confluence, no promotion.
        let streams = arr2(&[[1i8, 0], [1, 0]]);
        let flow_dir = arr2(&[[2i8, -1], [-1, -1]]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 1);
        assert_eq!(order[[1, 0]], 1);
    }

    #[test]
    fn test_stream_order_no_streams() {
        let streams = arr2(&[[0i8, 0], [0, 0]]);
        let flow_dir = arr2(&[[0i8, -1], [-1, -1]]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 0);
        assert_eq!(order[[1, 0]], 0);
    }

    #[test]
    fn test_stream_order_offgrid_downstream() {
        // A stream cell at the east edge whose flow direction points off-grid
        // (a valid direction, not nodata_dir): the target clip must skip it
        // without panicking or escalating anything.
        let streams = arr2(&[[1i8, 1]]);
        let flow_dir = arr2(&[[0i8, 0]]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 1);
        assert_eq!(order[[0, 1]], 1);
    }

    // ── d8_flow_direction_par tests ──────────────────────────────────────────

    #[test]
    fn test_d8_par_matches_sequential() {
        // Deterministic mixed terrain (slopes, flats, an interior nodata hole,
        // grid edges): the rayon row-parallel pass must agree with the
        // sequential pass cell for cell.
        let mut dem = Array2::<f32>::zeros((9, 9));
        for r in 0..9 {
            for c in 0..9 {
                dem[[r, c]] = (3 * r + 7 * c) as f32 * 2.5;
            }
        }
        dem[[4, 4]] = -32768.0; // interior nodata hole
        let seq = d8_flow_direction(&dem.view(), -32768.0);
        let par = d8_flow_direction_par(&dem.view(), -32768.0);
        assert_eq!(seq, par, "parallel D8 must match sequential D8");
    }

    #[test]
    fn test_d8_par_flat_and_nodata_are_pits() {
        let dem = arr2(&[[-32768.0f32, 100.0], [50.0, 40.0]]);
        let fd = d8_flow_direction_par(&dem.view(), -32768.0);
        assert_eq!(fd[[0, 0]], -1, "nodata cell is a pit");
        assert_eq!(fd[[1, 1]], -1, "lowest cell is a pit");
        assert_eq!(fd[[1, 0]], 0, "(1,0)=50 drains E to 40");
        assert_eq!(fd[[0, 1]], 2, "(0,1)=100 drains S to 40");
    }

    #[test]
    fn test_d8_par_single_row() {
        // Degenerate shape: no vertical neighbours exist, flow must go E.
        let dem = arr2(&[[30.0f32, 20.0, 10.0]]);
        let fd = d8_flow_direction_par(&dem.view(), -32768.0);
        assert_eq!(fd[[0, 0]], 0);
        assert_eq!(fd[[0, 1]], 0);
        assert_eq!(fd[[0, 2]], -1);
    }

    // ── flow_accumulation_par tests ──────────────────────────────────────────

    #[test]
    fn test_flow_accum_par_matches_sequential() {
        // Delegates to flow_accumulation — must produce identical output.
        let fd = arr2(&[[-1i8, 2, -1], [-1, 2, -1], [-1, -1, -1]]);
        let seq = flow_accumulation(&fd.view(), -1);
        let par = flow_accumulation_par(&fd.view(), -1);
        assert_eq!(seq, par);
        assert_eq!(par[[0, 1]], 1);
        assert_eq!(par[[1, 1]], 2);
    }

    // ── viewshed tests (delegated to viewshed module) ────────────────────────
}
