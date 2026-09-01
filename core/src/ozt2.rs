//! OZT2 tile format — Rust-native gradient reconstruction.
//!
//! The OZT2 format uses gradient (panorama) prediction:
//!   residual[i,j] = tile[i,j] - (tile[i,j-1] + tile[i-1,j] - tile[i-1,j-1])
//!
//! Reconstruction (gradient reconstruct):
//!   tile[i,j] = residual[i,j] + tile[i,j-1] + tile[i-1,j] - tile[i-1,j-1]
//!
//! This has a data dependency along rows (i) and columns (j), preventing
//! vectorization in a single pass. We traverse row-by-row, which is the
//! most cache-friendly order.

use ndarray::{Array2, ArrayView2};

/// Reconstruct a tile from gradient-predicted residuals (OZT2 decode step 2).
///
/// `residuals` — 2D array of int16 residuals from the decompressor
/// `nodata` — nodata value (typically -32768)
/// `dequant_min` — minimum value before quantization (f32)
///
/// Returns a 2D f32 array of reconstructed elevations.
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
                tile[[i, j]] = nodata as f32;
                continue;
            }

            // Dequantize
            let unq = dequant_min + (r as f32) * dequant_scale;

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
                tile[[i, j]] = nodata as f32;
                prev_valid = false;
                running = 0.0;
            } else {
                let unq = dequant_min + (r as f32) * dequant_scale;
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
/// `elevation` — raw f32 (or int16) elevation grid
/// `nodata` — nodata value
///
/// Returns residuals grid (int16).
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
}
