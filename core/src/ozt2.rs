//! OZT2 tile format — Rust-native gradient reconstruction.
//!
//! The OZT2 format uses gradient (panorama) prediction:
//!
//! ```text
//! residual[i,j] = tile[i,j] - (tile[i,j-1] + tile[i-1,j] - tile[i-1,j-1])
//! ```
//!
//! Reconstruction (gradient reconstruct):
//!
//! ```text
//! tile[i,j] = residual[i,j] + tile[i,j-1] + tile[i-1,j] - tile[i-1,j-1]
//! ```
//!
//! This has a data dependency along rows (i) and columns (j), preventing
//! vectorization in a single pass. We traverse row-by-row, which is the
//! most cache-friendly order.

use ndarray::{Array2, ArrayView2};

/// Reconstruct a tile from gradient-predicted residuals (OZT2 decode step 2).
///
/// Undoes the encoder's panorama prediction in place:
/// `tile[i,j] = residual[i,j] + tile[i,j-1] + tile[i-1,j] - tile[i-1,j-1]`,
/// with the first row/column falling back to their single available neighbour.
/// Each residual is dequantized to metres first as
/// `dequant_min + residual * dequant_scale`.
///
/// # Arguments
/// * `residuals` – 2D `i16` array from the OZT2 decompressor
/// * `nodata` – residual sentinel (typically -32768); copied through verbatim
/// * `dequant_min` – minimum elevation before quantization, in metres
/// * `dequant_scale` – metres per quantization step (1.0 for 16-bit tiles)
///
/// # Returns
/// 2D `f32` array of reconstructed elevations in metres, same shape as
/// `residuals`.
///
/// # Panics
/// Never — all indexing is bounds-checked by construction over the grid shape.
#[must_use]
pub fn gradient_reconstruct(
    residuals: &ArrayView2<i16>,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Array2<f32> {
    let rows = residuals.nrows();
    let cols = residuals.ncols();
    let mut tile = Array2::<f32>::zeros((rows, cols));

    for i in 0..rows {
        for j in 0..cols {
            let r = residuals[[i, j]];
            if r == nodata {
                tile[[i, j]] = f32::from(nodata);
                continue;
            }

            // Dequantize
            let unq = dequant_min + f32::from(r) * dequant_scale;

            if i == 0 && j == 0 {
                tile[[0, 0]] = unq;
            } else if i == 0 {
                // First row: only left neighbour
                tile[[0, j]] = unq + tile[[0, j - 1]];
            } else if j == 0 {
                // First column: only top neighbour
                tile[[i, 0]] = unq + tile[[i - 1, 0]];
            } else {
                // Gradient reconstruction
                tile[[i, j]] = unq + tile[[i, j - 1]] + tile[[i - 1, j]] - tile[[i - 1, j - 1]];
            }
        }
    }

    tile
}

/// Left-predict reconstruction (simpler, no intra-row dependency).
///
/// Each row is an independent running sum of dequantized residuals, so a row
/// can be decoded without its predecessor. A `nodata` residual is copied
/// through and resets the running sum, so the next valid cell starts from its
/// own residual rather than accumulating across the gap.
///
/// # Arguments
/// * `residuals` – 2D `i16` array from the OZT2 decompressor
/// * `nodata` – residual sentinel (typically -32768)
/// * `dequant_min` – minimum elevation before quantization, in metres
/// * `dequant_scale` – metres per quantization step
///
/// # Returns
/// 2D `f32` array of reconstructed elevations in metres, same shape as
/// `residuals`.
///
/// # Panics
/// Never — all indexing is bounds-checked by construction over the grid shape.
#[must_use]
pub fn left_reconstruct(
    residuals: &ArrayView2<i16>,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Array2<f32> {
    let rows = residuals.nrows();
    let cols = residuals.ncols();
    let mut tile = Array2::<f32>::zeros((rows, cols));

    for i in 0..rows {
        // Cumsum along row (left-to-right)
        let mut running: f32 = 0.0;
        let mut prev_valid = false;
        for j in 0..cols {
            let r = residuals[[i, j]];
            if r == nodata {
                tile[[i, j]] = f32::from(nodata);
                prev_valid = false;
                running = 0.0;
            } else {
                let unq = dequant_min + f32::from(r) * dequant_scale;
                if prev_valid {
                    running += unq;
                } else {
                    running = unq;
                }
                tile[[i, j]] = running;
                prev_valid = true;
            }
        }
    }

    tile
}

/// Encode: compute gradient prediction residuals from a raw elevation grid.
///
/// The forward pass of the OZT2 codec — inverse of [`gradient_reconstruct`]:
/// `residual[i,j] = elevation[i,j] - (elevation[i,j-1] + elevation[i-1,j] -
/// elevation[i-1,j-1])`, with the first row/column predicting from their single
/// available neighbour and the origin predicting from 0.
///
/// # Arguments
/// * `elevation` – raw `f32` elevation grid in metres
/// * `nodata` – elevation sentinel; cells `<= nodata` become the `nodata`
///   residual verbatim
///
/// # Returns
/// 2D `i16` residual grid, same shape as `elevation`. Residuals outside the
/// `i16` range wrap under the `as` cast — callers encoding terrain steeper
/// than ±32767 m of local relief must clip first.
///
/// # Panics
/// Never — all indexing is bounds-checked by construction over the grid shape.
#[must_use]
pub fn gradient_predict(elevation: &ArrayView2<f32>, nodata: f32) -> Array2<i16> {
    let rows = elevation.nrows();
    let cols = elevation.ncols();
    let mut residuals = Array2::<i16>::zeros((rows, cols));

    for i in 0..rows {
        for j in 0..cols {
            let e = elevation[[i, j]];
            if e <= nodata {
                residuals[[i, j]] = nodata as i16;
                continue;
            }

            let (pred, pred_count) = if i == 0 && j == 0 {
                (0.0, 0)
            } else if i == 0 {
                (elevation[[0, j - 1]], 1)
            } else if j == 0 {
                (elevation[[i - 1, 0]], 1)
            } else {
                (
                    elevation[[i, j - 1]] + elevation[[i - 1, j]] - elevation[[i - 1, j - 1]],
                    3,
                )
            };

            let residual = if pred_count == 0 { e } else { e - pred };
            residuals[[i, j]] = residual as i16;
        }
    }

    residuals
}

#[cfg(test)]
mod tests {
    // Every float assertion below compares integer-valued f32 results built by
    // adds/subtracts of whole numbers (well inside the 2^24 exact-integer
    // range), so `assert_eq!` is exact and an epsilon would only weaken the
    // roundtrip guarantee these tests exist to pin.
    #![allow(clippy::float_cmp)]

    use super::*;
    use ndarray::arr2;

    #[test]
    fn test_gradient_roundtrip() {
        let elevation = arr2(&[
            [100.0f32, 150.0, 120.0],
            [110.0, 160.0, 130.0],
            [105.0, 155.0, 125.0],
        ]);
        let residuals = gradient_predict(&elevation.view(), -32768.0);
        let reconstructed = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        for i in 0..3 {
            for j in 0..3 {
                assert!((reconstructed[[i, j]] - elevation[[i, j]]).abs() < 0.01);
            }
        }
    }

    #[test]
    fn test_gradient_reconstruct_nodata() {
        let residuals = arr2(&[[0i16, 0, 0], [0, -32768, 0], [0, 0, 0]]);
        let out = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        assert_eq!(out[[1, 1]], -32768.0);
    }

    #[test]
    fn test_left_reconstruct_simple() {
        let residuals = arr2(&[[10i16, 5, 3], [2, 1, 4]]);
        let out = left_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        assert_eq!(out[[0, 0]], 10.0);
        assert_eq!(out[[0, 1]], 15.0);
        assert_eq!(out[[0, 2]], 18.0);
    }

    #[test]
    fn test_left_reconstruct_nodata_resets_running() {
        // Mid-row nodata passes through and resets the cumsum baseline: the
        // cell after it restarts from its own residual, not 15 + 3.
        let residuals = arr2(&[[10i16, 5, -32768, 3]]);
        let out = left_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        assert_eq!(out[[0, 0]], 10.0);
        assert_eq!(out[[0, 1]], 15.0);
        assert_eq!(out[[0, 2]], -32768.0);
        assert_eq!(out[[0, 3]], 3.0);
    }

    #[test]
    fn test_gradient_predict_nodata_cells() {
        // Nodata elevation cells map straight to the nodata residual.
        let elevation = arr2(&[[100.0f32, -32768.0], [50.0, 60.0]]);
        let residuals = gradient_predict(&elevation.view(), -32768.0);
        assert_eq!(residuals[[0, 1]], -32768i16);
        assert_ne!(residuals[[1, 0]], -32768i16);
    }

    #[test]
    fn test_gradient_predict_treats_at_or_below_nodata_as_missing() {
        // The sentinel is compared with `<=`: a cell exactly at nodata and a
        // cell below it are both "no data", and neither enters the prediction.
        let elevation = arr2(&[[100.0f32, -32768.0, -40000.0]]);
        let residuals = gradient_predict(&elevation.view(), -32768.0);
        assert_eq!(residuals[[0, 1]], -32768i16);
        assert_eq!(residuals[[0, 2]], -32768i16);
        // Origin cell has no predictor, so its residual is the elevation itself.
        assert_eq!(residuals[[0, 0]], 100i16);
    }

    #[test]
    fn test_gradient_reconstruct_applies_dequant_params() {
        // Residuals are metres-after-dequantisation, not raw metres: with
        // min = 1000 and scale = 0.5, a residual of 4 is 1002 m. The running
        // gradient then carries the dequantized value, not the raw residual.
        let residuals = arr2(&[[4i16, 2, -2], [2, 0, 2]]);
        let out = gradient_reconstruct(&residuals.view(), -32768, 1000.0, 0.5);
        // (0,0) = 1000 + 4*0.5 = 1002
        assert_eq!(out[[0, 0]], 1002.0);
        // (0,1) = 1001 + 1002 = 2003
        assert_eq!(out[[0, 1]], 2003.0);
        // (0,2) = 999 + 2003 = 3002
        assert_eq!(out[[0, 2]], 3002.0);
        // (1,0) = 1001 + 1002 = 2003
        assert_eq!(out[[1, 0]], 2003.0);
        // (1,1) = 1000 + 2003 + 2003 - 1002 = 4004
        assert_eq!(out[[1, 1]], 4004.0);
        // (1,2) = 1001 + 4004 + 3002 - 2003 = 6004
        assert_eq!(out[[1, 2]], 6004.0);
    }

    #[test]
    fn test_left_reconstruct_applies_dequant_params() {
        // Left reconstruction is a per-row cumsum of dequantized residuals.
        let residuals = arr2(&[[4i16, 2, -2]]);
        let out = left_reconstruct(&residuals.view(), -32768, 1000.0, 0.5);
        assert_eq!(out[[0, 0]], 1002.0);
        assert_eq!(out[[0, 1]], 2003.0);
        assert_eq!(out[[0, 2]], 3002.0);
    }

    #[test]
    fn test_gradient_roundtrip_across_nodata_hole() {
        // A nodata cell must survive the codec as nodata without corrupting its
        // neighbours: the encoder emits the sentinel residual and the decoder
        // copies it through, so the rest of the tile reconstructs exactly.
        let mut elevation = arr2(&[
            [100.0f32, 120.0, 140.0],
            [110.0, 130.0, 150.0],
            [120.0, 140.0, 160.0],
        ]);
        elevation[[2, 2]] = -32768.0;
        let residuals = gradient_predict(&elevation.view(), -32768.0);
        assert_eq!(residuals[[2, 2]], -32768i16);

        let reconstructed = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        assert_eq!(reconstructed[[2, 2]], -32768.0, "the hole stays a hole");
        for i in 0..3 {
            for j in 0..3 {
                if (i, j) == (2, 2) {
                    continue;
                }
                assert_eq!(
                    reconstructed[[i, j]],
                    elevation[[i, j]],
                    "cell ({i},{j}) must round-trip exactly past the nodata hole"
                );
            }
        }
    }

    #[test]
    fn test_degenerate_shapes_are_total() {
        // Empty and 1x1 grids exercise the "no predictor" origin branch without
        // any neighbour to fall back on — both must return, not panic.
        let empty = Array2::<f32>::zeros((0, 0));
        assert_eq!(
            gradient_predict(&empty.view(), -32768.0).nrows(),
            0,
            "predict on an empty grid is empty"
        );
        assert_eq!(
            gradient_reconstruct(&Array2::<i16>::zeros((0, 0)).view(), -32768, 0.0, 1.0).ncols(),
            0,
            "reconstruct on an empty grid is empty"
        );

        let single = arr2(&[[42.0f32]]);
        let residuals = gradient_predict(&single.view(), -32768.0);
        assert_eq!(residuals[[0, 0]], 42i16);
        let out = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        assert_eq!(out[[0, 0]], 42.0);
    }
}
