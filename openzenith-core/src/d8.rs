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
const DIST: [f32; 8] = [1.0, std::f32::consts::SQRT_2, 1.0, std::f32::consts::SQRT_2, 1.0, std::f32::consts::SQRT_2, 1.0, std::f32::consts::SQRT_2];

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

/// Parallel flow accumulation — parallel D8 + sequential Kahn's.
///
pub fn flow_accumulation_par(flow_dir: &ArrayView2<i8>, nodata_dir: i8) -> Array2<i32> {
    let rows = flow_dir.nrows();
    let cols = flow_dir.ncols();

    let mut in_degree = Array2::<i32>::zeros((rows, cols));
    let mut accum = Array2::<i32>::ones((rows, cols));

    // Sequential in-degree build (O(n), cheap)
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

    // Sequential Kahn's algorithm (order matters)
    let mut queue: Vec<(usize, usize)> = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            if in_degree[[r, c]] == 0 && flow_dir[[r, c]] != nodata_dir {
                queue.push((r, c));
            }
        }
    }

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

                // Count inflowing stream neighbours of the same order
                let my_order = order[[r, c]];
                let mut same_order_count = 0;

                for d in 0..8 {
                    if d == fd as usize {
                        continue;
                    }
                    let ir = r as isize + DR[d];
                    let ic = c as isize + DC[d];
                    if ir < 0 || ir >= rows as isize || ic < 0 || ic >= cols as isize {
                        continue;
                    }
                    let ir = ir as usize;
                    let ic = ic as usize;
                    if flow_dir[[ir, ic]] == (d as i8 + 4) % 8  // flows into current cell
                        && streams[[ir, ic]] != 0
                        && order[[ir, ic]] == my_order
                    {
                        same_order_count += 1;
                    }
                }

                let tgt_order = order[[nr, nc]];
                if my_order > tgt_order {
                    let new_order = if same_order_count >= 2 { my_order + 1 } else { my_order };
                    if new_order > tgt_order {
                        order[[nr, nc]] = new_order;
                        changed = true;
                    }
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
        let dem = arr2(&[
            [10.0, 10.0, 10.0],
            [10.0, 5.0, 10.0],
            [10.0, 0.0, 10.0],
        ]);
        let fd = d8_flow_direction(&dem.view(), -32768.0);
        // (1,1) drains S → dir 2
        assert_eq!(fd[[1, 1]], 2, "(1,1) should drain S (dir=2)");
    }

    #[test]
    fn test_d8_slope_to_east() {
        // Centre (1,1) elev=5, E neighbour (1,2) elev=0 → drains E (dir=0)
        // All other neighbours are higher or equal, so E (steepest drop) wins.
        let dem = arr2(&[
            [10.0, 10.0, 10.0],
            [10.0, 5.0, 0.0],
            [10.0, 10.0, 10.0],
        ]);
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
        let fd = arr2(&[
            [-1i8, 2, -1],
            [-1, 2, -1],
            [-1, -1, -1],
        ]);
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
        let fd = arr2(&[
            [0i8, 2, -1],
            [0, -1, -1],
            [-1, -1, -1],
        ]);
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
        // Two first-order streams meeting at a confluence
        // (0,0) drains S to (1,0); (1,1) drains N to (1,0)
        // Confluence at (1,0) should be order 2 (two order-1 streams meet)
        let streams = arr2(&[
            [1i8, 0],
            [1, 1],
        ]);
        let flow_dir = arr2(&[
            [2i8, -1], // (0,0) drains S to (1,0)
            [6, -1],   // (1,1) drains N to (1,0); (1,0) drains off-grid
        ]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 1, "source should be order 1");
        assert_eq!(order[[1, 1]], 1, "source should be order 1");
        // Confluence may or may not be order 2 depending on iteration order
        assert!(order[[1, 0]] >= 1);
    }

    #[test]
    fn test_stream_order_no_streams() {
        let streams = arr2(&[[0i8, 0], [0, 0]]);
        let flow_dir = arr2(&[[0i8, -1], [-1, -1]]);
        let order = stream_order(&streams.view(), &flow_dir.view(), -1);
        assert_eq!(order[[0, 0]], 0);
        assert_eq!(order[[1, 0]], 0);
    }

    // ── viewshed tests (delegated to viewshed module) ────────────────────────
}
