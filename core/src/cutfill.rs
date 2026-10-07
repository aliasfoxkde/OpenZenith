//! Cut and fill volumes between a DEM and a reference surface.
//!
//! Earthworks convention, used for every field of [`CutFillSummary`]:
//!
//! * **cut** — the DEM is *above* the reference surface, so material has to be
//!   excavated; a cell contributes `dem - reference` to
//!   [`CutFillSummary::cut_volume`].
//! * **fill** — the DEM is *below* the reference surface, so material has to
//!   be brought in; a cell contributes `reference - dem` to
//!   [`CutFillSummary::fill_volume`].
//!
//! With DEM elevations and `cell_size` in metres the volumes are cubic metres
//! and [`CutFillSummary::area`] is the planimetric area of the compared cells
//! in square metres. `cell_size` only ever enters squared, so a negative value
//! behaves as its absolute value and a zero yields zero volumes over zero
//! area. [`CutFillSummary::net_volume`] is `fill - cut`, so a positive net
//! means the design surface needs more material than the ground supplies.

use ndarray::{Array2, ArrayView2};

/// The four corner elevations of a tilted reference plane, in metres.
///
/// North/west are row/column index 0 — the convention of a north-up grid —
/// so the "north" corners are the first row.
#[derive(Debug, Clone, Copy)]
pub struct Corners {
    /// Elevation at cell `(0, 0)`, in metres.
    pub north_west: f32,
    /// Elevation at cell `(0, cols - 1)`, in metres.
    pub north_east: f32,
    /// Elevation at cell `(rows - 1, 0)`, in metres.
    pub south_west: f32,
    /// Elevation at cell `(rows - 1, cols - 1)`, in metres.
    pub south_east: f32,
}

/// Reference surface a DEM is compared against in a cut/fill analysis.
#[derive(Debug, Clone, Copy)]
pub enum ReferenceSurface<'a> {
    /// A horizontal plane at this elevation, in metres.
    Constant(f32),
    /// A plane tilted across the whole grid, given by the elevation at the
    /// four corner cell centres and interpolated bilinearly in the row/column
    /// index between them (see [`tilted_plane`] for the exact interpolation).
    Tilted(Corners),
    /// A second DEM compared cell-for-cell; its shape must match the DEM
    /// under test, and its own nodata cells are excluded from the comparison.
    Dem(ArrayView2<'a, f32>),
}

impl ReferenceSurface<'_> {
    /// Elevation of the reference surface at cell `(r, c)`, in metres.
    fn at(&self, r: usize, c: usize, rows: usize, cols: usize) -> f32 {
        match *self {
            Self::Constant(z) => z,
            Self::Tilted(corners) => corners.at(r, c, rows, cols),
            Self::Dem(ref_dem) => ref_dem[[r, c]],
        }
    }
}

impl Corners {
    /// Bilinear interpolation of the four corner elevations at `(r, c)`.
    fn at(self, r: usize, c: usize, rows: usize, cols: usize) -> f32 {
        // A single-row or single-column grid has no extent to tilt across, so
        // the fraction is pinned to the first edge rather than dividing by 0.
        let fr = if rows > 1 {
            r as f32 / (rows - 1) as f32
        } else {
            0.0
        };
        let fc = if cols > 1 {
            c as f32 / (cols - 1) as f32
        } else {
            0.0
        };
        let top = self.north_west + (self.north_east - self.north_west) * fc;
        let bottom = self.south_west + (self.south_east - self.south_west) * fc;
        top + (bottom - top) * fr
    }
}

/// Build the tilted reference plane of [`ReferenceSurface::Tilted`] as a grid.
///
/// Exposed for inspection and testing: the cut/fill comparison reads the same
/// values cell-for-cell.
///
/// # Arguments
/// * `rows`/`cols` – grid dimensions
/// * `corners` – corner elevations; see [`Corners`]
///
/// # Returns
/// 2D `f32` grid of reference elevations in metres, same shape as the DEM the
/// plane was built for.
///
/// # Panics
/// Never — a single row or column is pinned to that edge's profile instead of
/// dividing by zero.
#[must_use]
pub fn tilted_plane(rows: usize, cols: usize, corners: Corners) -> Array2<f32> {
    Array2::from_shape_fn((rows, cols), |(r, c)| corners.at(r, c, rows, cols))
}

/// Aggregated cut/fill volumes for one DEM against one reference surface.
///
/// See the [module documentation](self) for the sign convention.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CutFillSummary {
    /// Volume to excavate where the DEM is above the reference surface, in
    /// cubic metres (m³ for metric input).
    pub cut_volume: f64,
    /// Volume to add where the DEM is below the reference surface, in cubic
    /// metres.
    pub fill_volume: f64,
    /// `fill_volume - cut_volume`; positive means a net import of material.
    pub net_volume: f64,
    /// Planimetric area of the compared (non-nodata) cells, in square metres.
    pub area: f64,
    /// Number of cells that entered the comparison — cells at or below
    /// `nodata` in the DEM, or in a [`ReferenceSurface::Dem`] reference, are
    /// excluded.
    pub cell_count: usize,
}

/// Cut/fill volumes between a DEM and a reference surface.
///
/// Every valid cell contributes `dem - reference` (cut) or
/// `reference - dem` (fill) times the squared cell size. Volumes are
/// accumulated in `f64` sequentially so the result is bit-for-bit
/// reproducible for a given input, independent of thread scheduling.
///
/// # Arguments
/// * `dem` – 2D elevation grid, `f32` in metres
/// * `reference` – the surface to compare against; see [`ReferenceSurface`]
/// * `cell_size` – ground size of one cell, in the same unit as the
///   elevations (metres for a projected DEM)
/// * `nodata` – elevation sentinel; cells `<= nodata` are excluded
///
/// # Returns
/// A [`CutFillSummary`] over the cells where both surfaces are valid.
///
/// # Errors
/// Only a [`ReferenceSurface::Dem`] whose shape differs from `dem` is an
/// error; the constant and tilted planes are defined for any grid shape.
///
/// # Panics
/// Never — the comparison is a shape-checked pass over the grid.
pub fn cut_fill(
    dem: &ArrayView2<f32>,
    reference: &ReferenceSurface<'_>,
    cell_size: f32,
    nodata: f32,
) -> Result<CutFillSummary, String> {
    let rows = dem.nrows();
    let cols = dem.ncols();

    if let ReferenceSurface::Dem(ref_dem) = *reference {
        if ref_dem.nrows() != rows || ref_dem.ncols() != cols {
            return Err(format!(
                "reference DEM shape {}x{} != DEM shape {rows}x{cols}",
                ref_dem.nrows(),
                ref_dem.ncols()
            ));
        }
    }

    let cell_area = if cell_size > 0.0 {
        f64::from(cell_size) * f64::from(cell_size)
    } else {
        0.0
    };

    let mut cut = 0.0_f64;
    let mut fill = 0.0_f64;
    let mut count = 0_usize;

    for r in 0..rows {
        for c in 0..cols {
            let z = dem[[r, c]];
            if z <= nodata {
                continue;
            }
            let reference_z = reference.at(r, c, rows, cols);
            if reference_z <= nodata {
                continue;
            }

            count += 1;
            let delta = f64::from(z - reference_z);
            if delta > 0.0 {
                cut += delta;
            } else if delta < 0.0 {
                fill -= delta;
            }
        }
    }

    Ok(CutFillSummary {
        cut_volume: cut * cell_area,
        fill_volume: fill * cell_area,
        net_volume: (fill - cut) * cell_area,
        area: count as f64 * cell_area,
        cell_count: count,
    })
}

#[cfg(test)]
mod tests {
    // Integer-valued metres over small grids are exact in f32/f64, so the
    // assertions below are exact. An expect failure here IS the test failing.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

    use super::*;
    use ndarray::arr2;

    /// A flat-reference case with hand-computable totals.
    const FLAT_DEM: [[f32; 2]; 2] = [[10.0, 20.0], [30.0, 40.0]];

    /// A 3x3 tilted plane rising 4 m per column and 8 m per row.
    const TEST_CORNERS: Corners = Corners {
        north_west: 0.0,
        north_east: 4.0,
        south_west: 8.0,
        south_east: 12.0,
    };

    #[test]
    fn test_cut_fill_constant_plane_matches_hand_totals() {
        // DEM [[10, 20], [30, 40]] against a 25 m plane, 2 m cells: the two
        // cells below the plane sum to fill 15 + 5 = 20 m, the two above sum
        // to cut 5 + 15 = 20 m, each over 4 m² — a balanced earthworks (net 0).
        let dem = arr2(&FLAT_DEM);
        let summary = cut_fill(
            &dem.view(),
            &ReferenceSurface::Constant(25.0),
            2.0,
            -32768.0,
        )
        .expect("a constant plane cannot fail");

        assert_eq!(summary.cell_count, 4);
        assert_eq!(summary.area, 16.0);
        assert_eq!(summary.cut_volume, 20.0 * 4.0);
        assert_eq!(summary.fill_volume, 20.0 * 4.0);
        assert_eq!(summary.net_volume, 0.0);
    }

    #[test]
    fn test_cut_fill_nodata_cells_are_excluded() {
        // (0,0) is nodata in the DEM and (1,1) is nodata in the reference:
        // neither may enter the sums, so a reference hole is an exclusion and
        // not an infinite cut.
        let dem = arr2(&[[-32768.0_f32, 20.0], [30.0, 40.0]]);
        let reference = arr2(&[[10.0_f32, 0.0], [0.0, -32768.0]]);
        let summary = cut_fill(
            &dem.view(),
            &ReferenceSurface::Dem(reference.view()),
            1.0,
            -32768.0,
        )
        .expect("same-shape DEMs cannot fail");

        assert_eq!(summary.cell_count, 2);
        // (0,1): 20 - 0 = 20 m cut; (1,0): 30 - 0 = 30 m cut.
        assert_eq!(summary.cut_volume, 50.0);
        assert_eq!(summary.fill_volume, 0.0);
    }

    #[test]
    fn test_cut_fill_dem_shape_mismatch_is_an_error_not_a_panic() {
        let dem = arr2(&FLAT_DEM);
        let reference = arr2(&[[10.0_f32]]);
        let err = cut_fill(
            &dem.view(),
            &ReferenceSurface::Dem(reference.view()),
            1.0,
            -32768.0,
        )
        .expect_err("mismatched shapes must error");
        assert!(
            err.contains("reference DEM shape 1x1 != DEM shape 2x2"),
            "{err}"
        );
    }

    #[test]
    fn test_tilted_plane_corners_and_centre() {
        // Corners are the four inputs; the centre of a 3x3 grid is the mean,
        // and the interior rows/columns interpolate linearly.
        let plane = tilted_plane(3, 3, TEST_CORNERS);
        assert_eq!(plane[[0, 0]], 0.0);
        assert_eq!(plane[[0, 2]], 4.0);
        assert_eq!(plane[[2, 0]], 8.0);
        assert_eq!(plane[[2, 2]], 12.0);
        assert_eq!(plane[[1, 1]], 6.0, "centre of a bilinear plane is the mean");
        assert_eq!(plane[[1, 0]], 4.0, "halfway between 0 and 8");
        assert_eq!(plane[[0, 1]], 2.0, "halfway between 0 and 4");
    }

    #[test]
    fn test_cut_fill_tilted_plane_is_zero_against_itself() {
        // A DEM equal to the tilted plane has no cut and no fill anywhere.
        let plane = tilted_plane(3, 3, TEST_CORNERS);
        let summary = cut_fill(
            &plane.view(),
            &ReferenceSurface::Tilted(TEST_CORNERS),
            1.0,
            -32768.0,
        )
        .expect("a tilted plane cannot fail");
        assert_eq!(summary.cut_volume, 0.0);
        assert_eq!(summary.fill_volume, 0.0);
        assert_eq!(summary.net_volume, 0.0);
        assert_eq!(summary.cell_count, 9);
    }

    #[test]
    fn test_cut_fill_tilted_plane_single_row_has_no_tilt_across_it() {
        // With rows == 1 the row fraction is pinned to 0, so only the north
        // edge's east-west tilt survives and the DEM matches it exactly.
        let dem = arr2(&[[0.0_f32, 10.0]]);
        let reference = ReferenceSurface::Tilted(Corners {
            north_west: 0.0,
            north_east: 10.0,
            south_west: 100.0,
            south_east: 200.0,
        });
        let summary = cut_fill(&dem.view(), &reference, 1.0, -32768.0)
            .expect("a single-row grid cannot fail");
        assert_eq!(summary.cut_volume, 0.0);
        assert_eq!(summary.fill_volume, 0.0);
    }

    #[test]
    fn test_cut_fill_tilted_plane_single_column_has_no_tilt_across_it() {
        // Mirror of the single-row case: with cols == 1 the column fraction is
        // pinned to 0, so only the west edge's north-south tilt survives.
        let dem = arr2(&[[0.0_f32], [10.0]]);
        let reference = ReferenceSurface::Tilted(Corners {
            north_west: 0.0,
            north_east: 50.0,
            south_west: 10.0,
            south_east: 200.0,
        });
        let summary = cut_fill(&dem.view(), &reference, 1.0, -32768.0)
            .expect("a single-column grid cannot fail");
        assert_eq!(summary.cut_volume, 0.0);
        assert_eq!(summary.fill_volume, 0.0);
    }

    #[test]
    fn test_cut_fill_empty_grid_is_all_zero() {
        let empty = Array2::<f32>::zeros((0, 0));
        let summary = cut_fill(
            &empty.view(),
            &ReferenceSurface::Constant(0.0),
            1.0,
            -32768.0,
        )
        .expect("an empty grid cannot fail");
        assert_eq!(
            summary,
            CutFillSummary {
                cut_volume: 0.0,
                fill_volume: 0.0,
                net_volume: 0.0,
                area: 0.0,
                cell_count: 0,
            }
        );
    }

    #[test]
    fn test_cut_fill_zero_cell_size_collapses_volumes_not_counts() {
        let dem = arr2(&FLAT_DEM);
        let summary = cut_fill(&dem.view(), &ReferenceSurface::Constant(0.0), 0.0, -32768.0)
            .expect("a zero cell size cannot fail");
        assert_eq!(summary.cell_count, 4, "cells still enter the comparison");
        assert_eq!(summary.area, 0.0);
        assert_eq!(summary.cut_volume, 0.0);
    }

    #[test]
    fn test_cut_fill_net_volume_sign_follows_fill_minus_cut() {
        // Pure fill: the plane sits above every cell, so the net is positive
        // and equal in magnitude to the fill volume.
        let dem = arr2(&FLAT_DEM);
        let summary = cut_fill(
            &dem.view(),
            &ReferenceSurface::Constant(100.0),
            1.0,
            -32768.0,
        )
        .expect("a constant plane cannot fail");
        assert_eq!(summary.cut_volume, 0.0);
        assert_eq!(summary.fill_volume, 90.0 + 80.0 + 70.0 + 60.0);
        assert_eq!(summary.net_volume, summary.fill_volume);
    }
}
