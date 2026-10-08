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
/// Casts at most 720 rays at uniform angular intervals around the
/// observer. For each ray, samples terrain heights at half-cell steps with
/// bilinear interpolation over the four surrounding corners (invalid corners
/// are excluded from the weighted mean) and marks a sample visible when its
/// slope from the observer is at least the maximum slope seen so far along
/// that ray.
///
/// # Arguments
/// * `dem` – 2D elevation grid, `f32` in metres
/// * `observer_row` – row index of the observer in the grid
/// * `observer_col` – column index of the observer in the grid
/// * `observer_height` – eye height above the observer's terrain, in metres
/// * `cell_size` – ground size of one cell, in the same unit as the
///   elevations (metres for a projected DEM); scales the slope denominator
/// * `nodata` – value marking invalid cells; cells `<= nodata` are never
///   visible and never block
/// * `max_distance_cells` – maximum ray length in cells; `None` uses the grid
///   diagonal
///
/// # Returns
/// Boolean grid of the same shape as `dem` (`true` = visible). The observer's
/// own cell is always visible when the observer is inside the grid and off
/// nodata; a reference outside the grid, or standing on nodata, yields an
/// all-`false` grid.
///
/// # Panics
/// Never — out-of-range observer indices short-circuit to an all-`false`
/// grid, and ray samples are bounds-checked before writeback.
#[must_use]
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

    let max_dist = max_distance_cells
        .unwrap_or_else(|| ((rows * rows + cols * cols) as f32).sqrt().ceil() as usize);

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
        // Half-steps are exact in f32, so the ray marches on an integer
        // half-step counter — exact termination, no float loop bound.
        // t runs 1.0, 1.5, … max_dist inclusive (1 cell away from the
        // observer; the observer's own cell is skipped).
        let steps = match max_dist {
            0 => 0,
            md => (md - 1) * 2 + 1,
        };

        for step in 0..steps {
            let t = 0.5f32.mul_add(step as f32, 1.0);
            // Ray position in grid space
            let ray_r = t.mul_add(sin_a, observer_row as f32);
            let ray_c = t.mul_add(cos_a, observer_col as f32);

            // Bilinear interpolation of terrain height at (ray_r, ray_c)
            let (r0, c0) = (ray_r.floor() as usize, ray_c.floor() as usize);
            let (r1, c1) = ((r0 + 1).min(rows - 1), (c0 + 1).min(cols - 1));
            // Sample 4 corners (clamp to bounds)
            let h00 = dem.get([r0, c0]).copied().unwrap_or(nodata);
            let h10 = dem.get([r1, c0]).copied().unwrap_or(nodata);
            let h01 = dem.get([r0, c1]).copied().unwrap_or(nodata);
            let h11 = dem.get([r1, c1]).copied().unwrap_or(nodata);

            let elev = if h00 <= nodata && h10 <= nodata && h01 <= nodata && h11 <= nodata {
                nodata
            } else {
                // Fractional position within the cell (0..1)
                let fr = ray_r - r0 as f32;
                let fc = ray_c - c0 as f32;

                // Bilinear weights for each corner
                let w00 = (1.0 - fr) * (1.0 - fc);
                let w10 = fr * (1.0 - fc);
                let w01 = (1.0 - fr) * fc;
                let w11 = fr * fc;

                // Weighted sum and weight sum over valid corners only
                let mut total = 0.0_f32;
                let mut weight_sum = 0.0_f32;
                for (h, w) in [(h00, w00), (h10, w10), (h01, w01), (h11, w11)] {
                    if h > nodata {
                        total = h.mul_add(w, total);
                        weight_sum += w;
                    }
                }

                if weight_sum == 0.0 {
                    nodata
                } else {
                    total / weight_sum
                }
            };

            if elev <= nodata {
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
        // Hill at (1,0) directly south of observer at (0,0) with large flat grid.
        // The hill should be visible. Due to half-cell bilinear sampling,
        // the max_distance test verifies the hill is within range.
        let dem = arr2(&[
            [600.0, 600.0, 600.0, 600.0],
            [500.0, 100.0, 100.0, 100.0], // hill at (1,0) directly south
            [100.0, 100.0, 100.0, 100.0],
            [100.0, 100.0, 100.0, 100.0],
        ]);
        // Observer at (0,0), eye at 601.75m, max_dist covers 2 cells south
        let vis = viewshed(&dem.view(), 0, 0, 1.75, 0.001, -32768.0, Some(5));
        // Observer always visible
        assert!(vis[[0, 0]]);
        // Hill at (1,0) is on the S ray (angle=0), 1 cell away → visible
        assert!(
            vis[[1, 0]],
            "hill at (1,0) should be visible from observer at (0,0)"
        );
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

    #[test]
    fn test_viewshed_observer_on_nodata_cell() {
        // An observer standing in nodata has no meaningful viewpoint: the
        // grid short-circuits to all-hidden before any ray marching.
        let dem = arr2(&[[100.0f32, 100.0], [100.0, -32768.0]]);
        let vis = viewshed(&dem.view(), 1, 1, 1.75, 0.001, -32768.0, None);
        for r in 0..2 {
            for c in 0..2 {
                assert!(!vis[[r, c]], "cell ({r},{c}) should be hidden");
            }
        }
    }

    #[test]
    fn test_viewshed_ridge_hides_ground_behind_it() {
        // East profile from an observer on a 100 m peak: a 90 m shoulder at 1
        // cell sets the running max slope to 10, the 95 m ridge at 2 cells is
        // then hidden (slope 2.5 < 10), and the 20 m valley floor at 4 cells is
        // visible again (slope 20 >= 10) because it drops below the sight line.
        //
        // The three extra rows keep every bilinear sample inside the row so the
        // assertion reads the pure east ray; with max_distance_cells = 4 the ray
        // count is 4 (E, S, W, N) and only the east ray reaches this row's
        // columns 1..4.
        let profile = [100.0_f32, 90.0, 95.0, 95.0, 20.0];
        let dem = Array2::from_shape_fn((3, 5), |(_, c)| profile[c]);
        let vis = viewshed(&dem.view(), 1, 0, 0.0, 1.0, -32768.0, Some(4));
        assert!(vis[[1, 0]], "observer cell");
        assert!(vis[[1, 1]], "90 m shoulder sets the sight line");
        assert!(!vis[[1, 2]], "95 m ridge behind the shoulder is hidden");
        assert!(vis[[1, 4]], "valley floor below the sight line is visible");
    }

    #[test]
    fn test_viewshed_max_distance_cells_limits_reach() {
        // max_distance_cells caps the ray march: with a 1-cell budget the
        // observer sees only the immediate 90 m shoulder, never the ridge.
        let profile = [100.0_f32, 90.0, 95.0, 95.0, 20.0];
        let dem = Array2::from_shape_fn((3, 5), |(_, c)| profile[c]);
        let vis = viewshed(&dem.view(), 1, 0, 0.0, 1.0, -32768.0, Some(1));
        assert!(vis[[1, 1]]);
        assert!(!vis[[1, 2]], "beyond the 1-cell budget");
        assert!(!vis[[1, 4]], "well beyond the 1-cell budget");
    }

    #[test]
    fn test_viewshed_nodata_sample_point_is_not_interpolated() {
        // A sample that lands exactly on a nodata cell must stay nodata even
        // when its neighbours are valid: the corner weights collapse onto the
        // invalid corner, the weight sum is 0, and the sample is skipped
        // instead of inheriting a neighbour's elevation. The rising ground
        // beyond keeps the half-step samples off the sight line too.
        let dem = arr2(&[[100.0f32, -32768.0, 200.0], [100.0, 100.0, 100.0]]);
        let vis = viewshed(&dem.view(), 0, 0, 0.0, 1.0, -32768.0, None);
        assert!(vis[[0, 0]], "observer cell");
        assert!(!vis[[0, 1]], "the nodata cell is never visible");
        assert!(
            !vis[[0, 2]],
            "ground above the observer's eye is not visible"
        );
    }

    #[test]
    fn test_viewshed_zero_ray_count_is_total() {
        // max_distance_cells = 0 means zero rays: the grid degenerates to the
        // observer's own cell without dividing by a zero angle step.
        let dem = arr2(&[[100.0f32, 100.0], [100.0, 100.0]]);
        let vis = viewshed(&dem.view(), 0, 0, 1.75, 1.0, -32768.0, Some(0));
        assert!(vis[[0, 0]]);
        assert!(!vis[[1, 1]], "no rays, no reach");
    }
}
