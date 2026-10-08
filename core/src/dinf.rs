//! D-infinity (D∞) flow direction — Tarboton (1997).
//!
//! D8 snaps every cell's descent onto one of eight compass directions. D∞
//! instead fits a plane to each of the eight triangular facets around the
//! cell, keeps the facet with the steepest descent, and splits the flow
//! between the two neighbours that bracket the resulting direction, so a
//! ridge can shed flow on both sides instead of choosing one.
//!
//! Reference: D. G. Tarboton, "A new method for the determination of flow
//! directions and upslope areas in grid digital elevation models", Water
//! Resources Research 33(2), 309–319 (1997). The facet enumeration, the
//! clamping of the descent direction into its facet and the angular flow
//! split are that paper's; the facet algebra below is written out in the
//! cell-centre coordinate frame this crate uses.
//!
//! # Output contract
//!
//! [`dinf_flow_direction`] returns a [`DInfFlow`] holding three grids of the
//! same shape as the DEM:
//!
//! * `dir` — `i8` compass index of the *first* neighbour of the bracketing
//!   pair, in the same ordering as the D8 direction grid in
//!   [`crate::d8`](crate::d8) (0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW,
//!   6 = N, 7 = NE). The second member of the pair is always
//!   `(dir + 1) % 8`. `-1` marks nodata cells and pits.
//! * `angles` — the steepest-descent bearing in radians, clockwise from
//!   north, always inside the 45° sector between the two bracketing
//!   neighbours. `-1.0` marks nodata cells and pits.
//! * `proportions` — the fraction of the cell's flow routed to neighbour
//!   `dir`; the remaining `1 - proportions` goes to neighbour
//!   `(dir + 1) % 8`. `0.0` marks nodata cells and pits.
//!
//! A cell whose descent lands exactly on a sector boundary encodes that
//! through `dir`/`proportions` (`dir = k, proportion = 0` and
//! `dir = k + 1, proportion = 1` are the same single-neighbour flow), so a
//! consumer should resolve the two receivers from the pair, not from `dir`
//! alone.
//!
//! Both members of a facet's pair must be on-grid and non-nodata, because the
//! triangle needs all three of its corners. Edge cells lose the sectors that
//! point off-grid, and a single-row or single-column grid has no complete
//! facet anywhere, so every one of its cells is a pit — use
//! [`crate::d8::d8_flow_direction`] when D8's edge handling is wanted on such
//! degenerate shapes.
//!
//! # Facet algebra
//!
//! For the sector between compass indices `k` and `(k + 1) % 8`, one member
//! is cardinal and the other diagonal. Naming the cardinal one `C` and the
//! diagonal one `D`, the triangle `cell → C → D` is a right triangle: local
//! axis `x` runs from the cell centre toward `C` (one cell) and local axis
//! `y` runs from `C` toward `D` (one cardinal cell, hence perpendicular to
//! `x`). The plane through the three centres is `z = z0 + a·x + b·y` with
//! `a = z(C) - z0` and `b = z(D) - z(C)`, so the descent rate at a local
//! bearing `φ` measured from `x` toward `y` is
//! `f(φ) = -a·cos φ - b·sin φ`, whose unconstrained maximum sits at
//! `φ_v = atan2(-b, -a)`. Clamping that into the facet's `[0, π/4]` span
//! gives the facet's steepest descent — evaluated at both endpoints when
//! `φ_v` falls outside, since `f` is a single raised cosine and a plain clamp
//! would otherwise wrap past the peak. The winning facet is the one with the
//! largest rate, `rate <= 0` means no descent anywhere (a pit), and ties go
//! to the lowest sector index, mirroring [`crate::d8::d8_flow_direction`].
//!
//! The flow split is angular, as in Tarboton's equation 8: writing `δ` for
//! the descent bearing's offset inside the sector, neighbour `k` takes
//! `1 - δ/(π/4)` and neighbour `(k + 1) % 8` the remainder.

use ndarray::{Array2, ArrayView2};
use rayon::prelude::*;

use crate::d8::{DC, DR};

/// Bearing of each D8 compass index, radians clockwise from north.
///
/// Index 6 is north (0) and index 7 north-east (π/4) rather than 2π and 9π/4,
/// so adding an in-sector offset never leaves the `[0, 2π)` range.
const BEARING: [f64; 8] = [
    std::f64::consts::FRAC_PI_2,       // 0 E
    3.0 * std::f64::consts::FRAC_PI_4, // 1 SE
    std::f64::consts::PI,              // 2 S
    5.0 * std::f64::consts::FRAC_PI_4, // 3 SW
    3.0 * std::f64::consts::FRAC_PI_2, // 4 W
    7.0 * std::f64::consts::FRAC_PI_4, // 5 NW
    0.0,                               // 6 N
    std::f64::consts::FRAC_PI_4,       // 7 NE
];

/// Whether each D8 compass index is a cardinal neighbour (E, S, W, N).
///
/// Every sector pairs one cardinal with one diagonal neighbour, which is what
/// makes the facet a right triangle.
const CARDINAL: [bool; 8] = [true, false, true, false, true, false, true, false];

/// D-infinity flow grids for one DEM.
///
/// See the [module documentation](self) for the meaning of each grid and its
/// nodata sentinel.
#[derive(Debug, Clone, PartialEq)]
pub struct DInfFlow {
    /// `i8` compass index of the first neighbour of the bracketing pair
    /// (D8 ordering, `-1` = nodata or pit).
    pub dir: Array2<i8>,
    /// Steepest-descent bearing in radians clockwise from north
    /// (`-1.0` = nodata or pit).
    pub angles: Array2<f32>,
    /// Fraction of flow routed to neighbour `dir` (`0.0` = nodata or pit).
    pub proportions: Array2<f32>,
}

/// D-infinity flow direction for a DEM.
///
/// # Arguments
/// * `dem` – 2D elevation grid, `f32` in metres
/// * `nodata` – elevation sentinel; cells `<= nodata` are ignored as terrain
///   and never receive flow
///
/// # Returns
/// A [`DInfFlow`] with `dir`/`angles`/`proportions` grids of the same shape
/// as `dem`.
///
/// # Panics
/// Never — degenerate input (empty grids, nodata-saturated cells) yields the
/// documented sentinels instead of an error.
#[must_use]
pub fn dinf_flow_direction(dem: &ArrayView2<f32>, nodata: f32) -> DInfFlow {
    let rows = dem.nrows();
    let cols = dem.ncols();

    let mut dir = Array2::<i8>::zeros((rows, cols));
    let mut angles = Array2::<f32>::zeros((rows, cols));
    let mut proportions = Array2::<f32>::zeros((rows, cols));

    for (r, row) in (0..rows).map(|r| dinf_row(dem, r, nodata)).enumerate() {
        write_row(row, r, &mut dir, &mut angles, &mut proportions);
    }

    DInfFlow {
        dir,
        angles,
        proportions,
    }
}

/// D-infinity twin of [`dinf_flow_direction`] using rayon row parallelism.
///
/// Cells are independent, so the parallel pass is bitwise identical to the
/// sequential one; it exists purely to use spare cores on large DEMs.
///
/// # Arguments
/// * `dem` – 2D elevation grid, `f32` in metres
/// * `nodata` – elevation sentinel; cells `<= nodata` are ignored as terrain
///
/// # Returns
/// A [`DInfFlow`] identical to [`dinf_flow_direction`]'s output.
///
/// # Panics
/// Never — same contract as [`dinf_flow_direction`].
#[must_use]
pub fn dinf_flow_direction_par(dem: &ArrayView2<f32>, nodata: f32) -> DInfFlow {
    let rows = dem.nrows();
    let cols = dem.ncols();

    let mut dir = Array2::<i8>::zeros((rows, cols));
    let mut angles = Array2::<f32>::zeros((rows, cols));
    let mut proportions = Array2::<f32>::zeros((rows, cols));

    // rayon's for_each wants a Fn, and the three output grids cannot all be
    // captured mutably by one, so rows are collected first and written back
    // in row order.
    let grid: Vec<Vec<(i8, f32, f32)>> = (0..rows)
        .into_par_iter()
        .map(|r| dinf_row(dem, r, nodata))
        .collect();

    for (r, row) in grid.into_iter().enumerate() {
        write_row(row, r, &mut dir, &mut angles, &mut proportions);
    }

    DInfFlow {
        dir,
        angles,
        proportions,
    }
}

/// D-infinity direction for every column of one row.
fn dinf_row(dem: &ArrayView2<f32>, r: usize, nodata: f32) -> Vec<(i8, f32, f32)> {
    (0..dem.ncols())
        .map(|c| dinf_cell(dem, r, c, nodata))
        .collect()
}

/// Write one row's `(dir, angle, proportion)` triples into the output grids.
fn write_row(
    row: Vec<(i8, f32, f32)>,
    r: usize,
    dir: &mut Array2<i8>,
    angles: &mut Array2<f32>,
    proportions: &mut Array2<f32>,
) {
    for (c, (d, a, p)) in row.into_iter().enumerate() {
        dir[[r, c]] = d;
        angles[[r, c]] = a;
        proportions[[r, c]] = p;
    }
}

/// D-infinity direction for a single cell: `(dir, angle, proportion)`.
// ndarray's 2D indexing is `dem[[r, c]]` — an array-literal index, not a
// tuple→array conversion; the nursery lint misreads it here.
#[allow(clippy::tuple_array_conversions)]
fn dinf_cell(dem: &ArrayView2<f32>, r: usize, c: usize, nodata: f32) -> (i8, f32, f32) {
    let rows = dem.nrows() as isize;
    let cols = dem.ncols() as isize;

    let z0 = dem[[r, c]];
    if z0 <= nodata {
        return (-1, -1.0, 0.0);
    }

    let mut best_dir = -1_i8;
    let mut best_angle = -1.0_f64;
    let mut best_prop = 0.0_f64;
    let mut best_rate = 0.0_f64;

    for k in 0..8_usize {
        let k2 = (k + 1) % 8;
        // The cardinal member makes the facet a right triangle; which of the
        // pair is cardinal decides whether the descent bearing runs
        // clockwise (`k` first) or anticlockwise (`k + 1` first) from the
        // sector's own start.
        let (card, diag, cardinal_first) = if CARDINAL[k] {
            (k, k2, true)
        } else {
            (k2, k, false)
        };

        let Some((card_r, card_c)) = neighbour(r, c, card, rows, cols) else {
            continue;
        };
        let Some((diag_r, diag_c)) = neighbour(r, c, diag, rows, cols) else {
            continue;
        };

        let z_card = dem[[card_r, card_c]];
        let z_diag = dem[[diag_r, diag_c]];
        if z_card <= nodata || z_diag <= nodata {
            continue;
        }

        // Plane gradient in the facet's local (x, y) frame, in metres.
        let a = f64::from(z_card - z0);
        let b = f64::from(z_diag - z_card);

        // Steepest descent: the unconstrained peak of the raised cosine
        // f(φ) = -a·cos φ - b·sin φ, clamped into the facet's [0, π/4] span.
        let mut phi_best = 0.0_f64;
        let mut rate_best = -a; // f(0) — descent straight toward C
        let rate_quarter = (-a - b) * std::f64::consts::FRAC_1_SQRT_2; // f(π/4)
        if rate_quarter > rate_best {
            rate_best = rate_quarter;
            phi_best = std::f64::consts::FRAC_PI_4;
        }
        let phi_unconstrained = (-b).atan2(-a);
        if (0.0..=std::f64::consts::FRAC_PI_4).contains(&phi_unconstrained) {
            let rate_unconstrained = a.hypot(b);
            if rate_unconstrained > rate_best {
                rate_best = rate_unconstrained;
                phi_best = phi_unconstrained;
            }
        }

        if rate_best <= 0.0 || rate_best <= best_rate {
            continue;
        }

        let in_sector = if cardinal_first {
            phi_best
        } else {
            std::f64::consts::FRAC_PI_4 - phi_best
        };

        best_dir = k as i8;
        best_angle = BEARING[k] + in_sector;
        best_prop = 1.0 - in_sector / std::f64::consts::FRAC_PI_4;
        best_rate = rate_best;
    }

    (best_dir, best_angle as f32, best_prop as f32)
}

/// Neighbour cell of `(r, c)` in compass direction `d`, if it is on-grid.
const fn neighbour(
    r: usize,
    c: usize,
    d: usize,
    rows: isize,
    cols: isize,
) -> Option<(usize, usize)> {
    let nr = r as isize + DR[d];
    let nc = c as isize + DC[d];
    if nr < 0 || nr >= rows || nc < 0 || nc >= cols {
        return None;
    }
    Some((nr as usize, nc as usize))
}

#[cfg(test)]
mod tests {
    // Bearings and proportions come from exact trigonometry on hand-built
    // grids; the tolerances below only absorb the f32 grid round-trip.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

    use super::*;
    use ndarray::arr2;
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};

    #[test]
    fn test_dinf_flat_grid_is_all_pits() {
        let dem = arr2(&[[100.0_f32; 3]; 3]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        for r in 0..3 {
            for c in 0..3 {
                assert_eq!(flow.dir[[r, c]], -1, "flat cell ({r},{c}) has no descent");
                assert_eq!(flow.angles[[r, c]], -1.0);
                assert_eq!(flow.proportions[[r, c]], 0.0);
            }
        }
    }

    #[test]
    fn test_dinf_uniform_east_slope_flows_east() {
        // Elevation drops 10 m per column: descent is due east (π/2). Rows 0
        // and 1 have the (E, SE) facet, so the whole cell routes to E with
        // proportion 1; the last row has no SE, so its only east-facing facet
        // is (NE, E) and the same flow is encoded as dir = 7 with proportion 0
        // — exactly the boundary encoding the output contract calls out.
        let dem = Array2::from_shape_fn((3, 3), |(_, c)| -10.0 * c as f32);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        for r in 0..3 {
            let dir = flow.dir[[r, 0]];
            let prop = f64::from(flow.proportions[[r, 0]]);
            assert_eq!(flow.angles[[r, 0]], FRAC_PI_2 as f32, "row {r} drains east");
            assert!(
                dir == 0 || dir == 7,
                "row {r} pair must bracket E, got {dir}"
            );
            let east_share = if dir == 0 { prop } else { 1.0 - prop };
            assert!(
                (east_share - 1.0).abs() < 1e-6,
                "row {r} sends all flow east (dir {dir}, prop {prop})"
            );
        }
        // The last column has no E/SE/NE neighbour left and nothing drops
        // south, so those cells are pits.
        assert_eq!(flow.dir[[1, 2]], -1, "east edge cell is a pit");
    }

    #[test]
    fn test_dinf_diagonal_slope_splits_to_single_diagonal() {
        // Elevation drops 10 m per row *and* per column: the steepest descent
        // is exactly south-east (3π/4) with slope 20/√2. That sits on the
        // boundary between the (E, SE) and (SE, S) facets, so either encoding
        // is legitimate — resolve the pair and read off the SE share.
        let dem = Array2::from_shape_fn((3, 3), |(r, c)| -10.0 * (r + c) as f32);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        let dir = flow.dir[[1, 1]];
        let prop = f64::from(flow.proportions[[1, 1]]);
        assert_eq!(flow.angles[[1, 1]], 3.0 * FRAC_PI_4 as f32, "bearing is SE");
        assert!(
            dir == 0 || dir == 1,
            "pair must be (E, SE) or (SE, S), got {dir}"
        );
        let (_, se_share) = [(dir, prop), ((dir + 1) % 8, 1.0 - prop)]
            .into_iter()
            .find(|(neighbour, _)| *neighbour == 1)
            .expect("the bracketing pair contains SE");
        assert_eq!(se_share, 1.0, "all flow goes to SE");
    }

    #[test]
    fn test_dinf_sector_pair_is_reported_in_compass_order() {
        // The (SE, S) facet wins outright here: toward S the drop is 15 m and
        // SE another 5 m, so the descent lands inside that sector — 0.4636 rad
        // from S toward SE — and the split is reported with SE (k = 1) first.
        let dem = arr2(&[
            [200.0_f32, 200.0, 200.0],
            [200.0, 100.0, 100.0],
            [200.0, 85.0, 80.0],
        ]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        let phi = 5.0_f64.atan2(15.0); // in-sector offset from S toward SE
        assert_eq!(flow.dir[[1, 1]], 1, "the (SE, S) facet wins");
        let expected_angle = std::f64::consts::PI - phi;
        let angle = f64::from(flow.angles[[1, 1]]);
        let prop = f64::from(flow.proportions[[1, 1]]);
        assert!(
            (angle - expected_angle).abs() < 1e-5,
            "angle {angle} != {expected_angle}"
        );
        // The bearing runs from the sector's SE start toward its S end, so the
        // share routed to `dir` (SE) grows with that offset.
        let expected_prop = phi / FRAC_PI_4;
        assert!(
            (prop - expected_prop).abs() < 1e-5,
            "share to SE {prop} != {expected_prop}"
        );
    }

    #[test]
    fn test_dinf_interior_direction_splits_proportionally() {
        // E drops 10 m (a = -10) and SE drops 5 m more (b = -5), so the true
        // steepest descent is atan(5/10) = 0.4636 rad inside the (E, SE)
        // sector and the flow splits by angular share.
        let dem = arr2(&[
            [100.0_f32, 100.0, 100.0],
            [100.0, 100.0, 90.0],
            [100.0, 100.0, 85.0],
        ]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);

        let phi = 5.0_f64.atan2(10.0); // 0.4636476090008061
        let expected_angle = FRAC_PI_2 + phi;
        let expected_prop = 1.0 - phi / FRAC_PI_4; // ≈ 0.4097 to E

        assert_eq!(flow.dir[[1, 1]], 0, "the (E, SE) facet wins");
        let angle = f64::from(flow.angles[[1, 1]]);
        let prop = f64::from(flow.proportions[[1, 1]]);
        assert!(
            (angle - expected_angle).abs() < 1e-5,
            "angle {angle} != {expected_angle}"
        );
        assert!(
            (prop - expected_prop).abs() < 1e-5,
            "proportion {prop} != {expected_prop}"
        );
    }

    #[test]
    fn test_dinf_endpoint_beats_interior_when_cardinal_is_steepest() {
        // S drops 15 m (rate 15) while E drops 10 and SE sits level with E:
        // the (E, SE) facet tops out at 10 toward E, so the (SE, S) facet
        // wins with its descent exactly on the S boundary — encoded as
        // dir = 1 with proportion 0 (all flow to S).
        let dem = arr2(&[
            [100.0_f32, 100.0, 100.0],
            [100.0, 100.0, 90.0],
            [100.0, 85.0, 90.0],
        ]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        assert_eq!(flow.dir[[1, 1]], 1, "the (SE, S) facet wins");
        assert_eq!(flow.proportions[[1, 1]], 0.0, "all flow goes to S");
        assert_eq!(flow.angles[[1, 1]], std::f64::consts::PI as f32);
    }

    #[test]
    fn test_dinf_nodata_cell_and_nodata_facet() {
        // A nodata centre is a pit; a facet touching a nodata neighbour is
        // skipped, so (0,1) — whose only downhill direction runs into the
        // hole — becomes a pit instead of draining into it.
        let dem = arr2(&[[10.0_f32, 5.0, -32768.0], [10.0, 10.0, 10.0]]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        assert_eq!(flow.dir[[0, 2]], -1, "nodata cell is a pit");
        assert_eq!(flow.dir[[0, 1]], -1, "facet into the hole is skipped");
        assert_eq!(flow.angles[[0, 1]], -1.0);
        assert_eq!(flow.proportions[[0, 1]], 0.0);
        assert_eq!(
            flow.dir[[0, 0]],
            0,
            "(0,0) still drains E into the 5 m cell"
        );
    }

    #[test]
    fn test_dinf_degenerate_shapes_are_total() {
        // A 1x1 grid has no neighbour to descend to; an empty grid has no
        // cells at all. Neither may panic.
        let one = arr2(&[[42.0_f32]]);
        let flow = dinf_flow_direction(&one.view(), -32768.0);
        assert_eq!(flow.dir[[0, 0]], -1);

        let empty = Array2::<f32>::zeros((0, 0));
        let flow = dinf_flow_direction(&empty.view(), -32768.0);
        assert_eq!(flow.dir.nrows(), 0);
        assert_eq!(flow.angles.ncols(), 0);
    }

    #[test]
    fn test_dinf_bearings_stay_inside_their_sector() {
        // Deterministic mixed terrain: every non-pit cell must carry a
        // bearing inside the 45° sector implied by its `dir`, a proportion in
        // [0, 1], and a sentinel set that is consistent.
        let mut dem = Array2::<f32>::zeros((9, 9));
        for r in 0..9 {
            for c in 0..9 {
                dem[[r, c]] = (3 * r * r + 7 * c + 2 * r * c) as f32;
            }
        }
        dem[[4, 4]] = -32768.0; // interior nodata hole
        let flow = dinf_flow_direction(&dem.view(), -32768.0);

        for r in 0..9 {
            for c in 0..9 {
                let d = flow.dir[[r, c]];
                let angle = f64::from(flow.angles[[r, c]]);
                let prop = f64::from(flow.proportions[[r, c]]);
                if d == -1 {
                    assert_eq!(angle, -1.0, "cell ({r},{c}) pit angle");
                    assert_eq!(prop, 0.0, "cell ({r},{c}) pit proportion");
                    continue;
                }
                let start = BEARING[d as usize];
                let end = start + FRAC_PI_4;
                assert!(
                    angle >= start - 1e-6 && angle <= end + 1e-6,
                    "cell ({r},{c}) bearing {angle} outside [{start}, {end}]"
                );
                assert!(
                    (0.0..=1.0).contains(&prop),
                    "cell ({r},{c}) proportion {prop} out of range"
                );
            }
        }
    }

    #[test]
    fn test_dinf_par_matches_sequential() {
        let mut dem = Array2::<f32>::zeros((9, 9));
        for r in 0..9 {
            for c in 0..9 {
                dem[[r, c]] = (3 * r + 7 * c) as f32 * 2.5;
            }
        }
        dem[[4, 4]] = -32768.0;
        let seq = dinf_flow_direction(&dem.view(), -32768.0);
        let par = dinf_flow_direction_par(&dem.view(), -32768.0);
        assert_eq!(seq, par, "parallel D-inf must match sequential D-inf");
    }

    #[test]
    fn test_dinf_single_row_has_no_facets() {
        // Degenerate shape: every triangular facet needs a cardinal neighbour
        // plus an *adjacent diagonal*, and a single row has neither the
        // diagonals nor a north/south cardinal, so no facet exists at all and
        // every cell — even one that plainly drains east in D8 terms — is a
        // pit. Callers needing D8 semantics on such grids use
        // [`crate::d8::d8_flow_direction`].
        let dem = arr2(&[[30.0_f32, 20.0, 10.0]]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        for c in 0..3 {
            assert_eq!(flow.dir[[0, c]], -1, "single-row cell {c} has no facet");
            assert_eq!(flow.angles[[0, c]], -1.0);
            assert_eq!(flow.proportions[[0, c]], 0.0);
        }
        // Same for a single column.
        let dem = arr2(&[[30.0_f32], [20.0], [10.0]]);
        let flow = dinf_flow_direction(&dem.view(), -32768.0);
        assert_eq!(flow.dir[[0, 0]], -1);
    }
}
