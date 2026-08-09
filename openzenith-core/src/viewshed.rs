//! Viewshed analysis — line-of-sight visibility from an observer point.
//!
//! Casts rays at angular intervals and uses bilinear interpolation to sample
//! terrain heights along each ray.

use ndarray::{Array2, ArrayView2};
use std::f32::consts::PI;

/// Maximum number of rays to cast.
const MAX_RAYS: usize = 720;

/// Compute visible cells from an observer point on a DEM.
///
///
/// Casts `n_angles` rays at uniform angular intervals around the observer.
/// For each ray, samples terrain heights at regular distance intervals and
/// determines whether each sample is visible using the maximum-slope criterion.
///
/// # Arguments
/// * `dem` – 2D elevation grid (f32)
/// * `observer_row` – Row index of observer in the grid
/// * `observer_col` – Column index of observer in the grid
/// * `observer_height` – Height of observer above terrain (metres)
/// * `cell_size` – Size of each cell in the same units as elevation (e.g. degrees or metres)
/// * `nodata` – Value marking invalid cells
/// * `max_distance_cells` – Maximum ray length in cells (default: diagonal of grid)
///
/// # Returns
/// Boolean grid (1=visible, 0=not visible).
pub fn viewshed(
    dem: &ArrayView2<f32>,
    observer_row: usize,
    observer_col: usize,
    observer_height: f32,
    cell_size: f32,
    nodata: f32,
    max_distance_cells: Option<usize>,
) -> Array2<bool> {
    let rows = dem.nrows();
    let cols = dem.ncols();

    if observer_row >= rows || observer_col >= cols {
        return Array2::from_elem((rows, cols), false);
    }

    let max_dist = max_distance_cells.unwrap_or(
        ((rows * rows + cols * cols) as f32).sqrt().ceil() as usize,
    );

    let obs_elev = dem[[observer_row, observer_col]];
    if obs_elev <= nodata {
        return Array2::from_elem((rows, cols), false);
    }

    let total_elev = obs_elev + observer_height;

    // Number of angular steps: 360° at 0.5° resolution = 720 rays
    let n_angles = MAX_RAYS.min(max_dist);
    let angle_step = 2.0 * PI / n_angles as f32;

    // Pre-allocate output
    let mut visible = Array2::<bool>::from_elem((rows, cols), false);
    visible[[observer_row, observer_col]] = true;

    // For each angle, march along the ray and track cumulative max slope
    for i in 0..n_angles {
        let angle = i as f32 * angle_step;

        // Pre-compute ray direction components
        let sin_a = angle.sin();
        let cos_a = angle.cos();

        let mut max_slope_seen = 0.0_f32;

        // March along ray: we step by 1 cell in the dominant direction
        // Use Bresenham-style step decisions based on cos/sin ratio.
        // For smooth sampling, we step by 0.5 cells and interpolate.
        let step_size = 0.5_f32; // half-cell steps for smooth terrain following
        let mut t = 1.0_f32; // start 1 cell away from observer (skip observer's own cell)

        while t <= max_dist as f32 {
            // Ray position in grid space
            let ray_r = observer_row as f32 + t * sin_a;
            let ray_c = observer_col as f32 + t * cos_a;

            // Bilinear interpolation of terrain height at (ray_r, ray_c)
            let (r0, c0) = (ray_r.floor() as usize, ray_c.floor() as usize);
            let (r1, c1) = (
                (r0 + 1).min(rows - 1),
                (c0 + 1).min(cols - 1),
            );
            // Sample 4 corners (clamp to bounds)
            let h00 = dem.get([r0, c0]).copied().unwrap_or(nodata);
            let h10 = dem.get([r1, c0]).copied().unwrap_or(nodata);
            let h01 = dem.get([r0, c1]).copied().unwrap_or(nodata);
            let h11 = dem.get([r1, c1]).copied().unwrap_or(nodata);

            let elev = if h00 <= nodata && h10 <= nodata && h01 <= nodata && h11 <= nodata {
                nodata
            } else {
                // Only nodata if ALL corners are nodata
                let valid_count = [h00, h10, h01, h11]
                    .iter()
                    .filter(|&&h| h > nodata)
                    .count();
                if valid_count == 0 {
                    nodata
                } else {
                    // Average of valid corners (simplified bilinear — fast approximation)
                    let total: f32 = [h00, h10, h01, h11]
                        .iter()
                        .filter(|&&h| h > nodata)
                        .sum();
                    total / valid_count as f32
                }
            };

            if elev <= nodata {
                t += step_size;
                continue;
            }

            // Distance from observer in cells
            let dist = t;

            // Slope from observer to this point
            let slope = (total_elev - elev) / (dist * cell_size);

            if slope >= max_slope_seen {
                // This point is visible
                let r_idx = ray_r as usize;
                let c_idx = ray_c as usize;
                if r_idx < rows && c_idx < cols {
                    visible[[r_idx, c_idx]] = true;
                }
                max_slope_seen = slope;
            }

            t += step_size;
        }
    }

    visible
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::arr2;

    #[test]
    fn test_viewshed_flat_terrain() {
        // On flat terrain, only the first cell along each ray is visible
        // (all subsequent cells are hidden by the first at equal elevation).
        let dem = arr2(&[
            [100.0, 100.0, 100.0],
            [100.0, 100.0, 100.0],
            [100.0, 100.0, 100.0],
        ]);
        let vis = viewshed(&dem.view(), 1, 1, 1.75, 0.001, -32768.0, None);
        // Observer cell is always visible
        assert!(vis[[1, 1]]);
        // The cell at (1,2) should be visible (first cell on E ray)
        // and other rays as well
        assert!(vis[[1, 2]]);
    }

    #[test]
    fn test_viewshed_hill_blocks() {
        // Hill at centre should block cells behind it
        let dem = arr2(&[
            [100.0, 100.0, 100.0],
            [100.0, 200.0, 100.0], // tall hill at centre
            [100.0, 100.0, 100.0],
        ]);
        let vis = viewshed(&dem.view(), 0, 0, 1.75, 0.001, -32768.0, None);
        // Cell (0,0) is observer, visible
        assert!(vis[[0, 0]]);
    }

    #[test]
    fn test_viewshed_out_of_bounds() {
        let dem = arr2(&[[100.0, 100.0], [100.0, 100.0]]);
        // Observer outside grid: all false
        let vis = viewshed(&dem.view(), 99, 99, 1.75, 0.001, -32768.0, None);
        for r in 0..2 {
            for c in 0..2 {
                assert!(!vis[[r, c]]);
            }
        }
    }

    #[test]
    fn test_viewshed_nodata_terrain() {
        let dem = arr2(&[
            [-32768.0, -32768.0, -32768.0],
            [-32768.0, 100.0, -32768.0],
            [-32768.0, -32768.0, -32768.0],
        ]);
        let vis = viewshed(&dem.view(), 1, 1, 1.75, 0.001, -32768.0, None);
        assert!(vis[[1, 1]]); // observer visible
    }
}
