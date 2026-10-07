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
//!
//! A neighbour sitting at the nodata sentinel is a marker, not metres, so it
//! never enters the predictor: the cell falls back to whichever of its
//! neighbours still holds real data ([`Predictor`]). Both passes make the same
//! choice — the encoder from the raw grid, the decoder from the partially
//! reconstructed tile, which agrees with the encoder on every cell decoded so
//! far — so a sentinel round-trips verbatim instead of poisoning the cells
//! behind it.

use ndarray::{Array2, ArrayView2};

/// The strongest predictor a cell may use, given which of its three gradient
/// neighbours hold real data.
///
/// The encoder and the decoder must agree on this choice or the tile cannot be
/// inverted, which is why both select through [`Predictor::select`].
enum Predictor {
    /// All three neighbours are data: the panorama predictor
    /// `left + top - diagonal`.
    Gradient {
        /// West neighbour, in metres.
        left: f32,
        /// North neighbour, in metres.
        top: f32,
        /// North-west neighbour, in metres.
        diagonal: f32,
    },
    /// Exactly one neighbour is usable, so the cell predicts from it alone.
    Neighbour(f32),
    /// No usable neighbour — the cell's own value is its residual.
    Direct,
}

impl Predictor {
    /// Pick the predictor for a cell from its three gradient neighbours, with
    /// off-grid positions and nodata values already mapped to `None`.
    ///
    /// The single-neighbour order — left, then top, then diagonal — is the
    /// order the first-row and first-column arms always used, so a grid with
    /// no nodata selects exactly the predictor it selected before the nodata
    /// fallback existed.
    fn select(left: Option<f32>, top: Option<f32>, diagonal: Option<f32>) -> Self {
        match (left, top, diagonal) {
            (Some(left), Some(top), Some(diagonal)) => Self::Gradient {
                left,
                top,
                diagonal,
            },
            (Some(left), _, _) => Self::Neighbour(left),
            (_, Some(top), _) => Self::Neighbour(top),
            (_, _, Some(diagonal)) => Self::Neighbour(diagonal),
            (None, None, None) => Self::Direct,
        }
    }
}

/// Reconstruct a tile from gradient-predicted residuals (OZT2 decode step 2).
///
/// Undoes the encoder's panorama prediction in place:
/// `tile[i,j] = residual[i,j] * dequant_scale + tile[i,j-1] + tile[i-1,j] -
/// tile[i-1,j-1]`, with the first row/column falling back to their single
/// available neighbour. The residual is a *difference* in metres, so only the
/// scale applies here — `dequant_min` (the tile's absolute level) enters
/// exactly once per connected run, through the direct-copy arm that seeds it.
/// Adding it to every residual would drift each predicted cell upward by
/// `dequant_min` and compound once more per reconstructed row.
///
/// A neighbour that decoded to the `nodata` sentinel is skipped, exactly as the
/// encoder skipped it, so the cell falls back to its remaining neighbours — or
/// to its own residual, once none are left.
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

            // Dequantize the delta. The residual is a difference in metres —
            // the absolute level lives in the already-reconstructed
            // neighbours, so `dequant_min` enters only through the `Direct`
            // arm (a run start). Adding it here as well would drift every
            // predicted cell upward by `dequant_min` and compound per row.
            let delta = f32::from(r) * dequant_scale;

            // A decoded cell is nodata exactly when its residual was the
            // sentinel, so availability is read from the residual grid (an i16
            // comparison) while the value comes from the tile — the same
            // ingredients the encoder inspected.
            let ingredient = |r: usize, c: usize| -> Option<f32> {
                if residuals[[r, c]] == nodata {
                    None
                } else {
                    Some(tile[[r, c]])
                }
            };
            let left = if j > 0 { ingredient(i, j - 1) } else { None };
            let top = if i > 0 { ingredient(i - 1, j) } else { None };
            let diagonal = if i > 0 && j > 0 {
                ingredient(i - 1, j - 1)
            } else {
                None
            };

            tile[[i, j]] = match Predictor::select(left, top, diagonal) {
                Predictor::Gradient {
                    left,
                    top,
                    diagonal,
                } => delta + left + top - diagonal,
                Predictor::Neighbour(neighbour) => delta + neighbour,
                Predictor::Direct => dequant_min + delta,
            };
        }
    }

    tile
}

/// Left-predict reconstruction (simpler, no intra-row dependency).
///
/// Each row is an independent running sum of residual deltas, so a row can be
/// decoded without its predecessor. `dequant_min` seeds a run — it is added
/// once, at the run's first valid cell, never per step. A `nodata` residual is
/// copied through and resets the running sum, so the next valid cell starts
/// from its own residual rather than accumulating across the gap.
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
        // Cumsum along row (left-to-right). Residuals are deltas: the
        // dequantized level (`dequant_min`) enters exactly once, when a run
        // starts — adding it per cell would drift the whole row upward by
        // (cells × dequant_min) metres.
        let mut running: f32 = 0.0;
        let mut prev_valid = false;
        for j in 0..cols {
            let r = residuals[[i, j]];
            if r == nodata {
                tile[[i, j]] = f32::from(nodata);
                prev_valid = false;
                running = 0.0;
            } else {
                let delta = f32::from(r) * dequant_scale;
                if prev_valid {
                    running += delta;
                } else {
                    running = dequant_min + delta;
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
/// A neighbour at or below the `nodata` sentinel is a marker rather than metres
/// and is excluded from the prediction: the cell falls back to a single
/// available neighbour, and to its own residual once none are left. The decoder
/// makes the same choice from its reconstructed values, so the residual is
/// always the one it can invert.
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

    // A neighbour at or below the sentinel carries no metres, so it is not a
    // predictor ingredient.
    let available = |r: usize, c: usize| -> Option<f32> {
        let v = elevation[[r, c]];
        if v <= nodata {
            None
        } else {
            Some(v)
        }
    };

    for i in 0..rows {
        for j in 0..cols {
            let e = elevation[[i, j]];
            if e <= nodata {
                residuals[[i, j]] = nodata as i16;
                continue;
            }

            let left = if j > 0 { available(i, j - 1) } else { None };
            let top = if i > 0 { available(i - 1, j) } else { None };
            let diagonal = if i > 0 && j > 0 {
                available(i - 1, j - 1)
            } else {
                None
            };

            let residual = match Predictor::select(left, top, diagonal) {
                Predictor::Gradient {
                    left,
                    top,
                    diagonal,
                } => e - (left + top - diagonal),
                Predictor::Neighbour(neighbour) => e - neighbour,
                Predictor::Direct => e,
            };
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
        // Residuals are deltas in metres (`residual * scale`), while
        // `dequant_min` is the tile's absolute level and enters once — at the
        // direct-copy cell that seeds the reconstruction. This mirrors the
        // production decoder (openzenith/tile_format_v2.py: reconstruct the
        // quantized grid, then dequantize per cell): a residual of 2 beside a
        // 1002 m neighbour is 1003 m, not 2003 m.
        let residuals = arr2(&[[4i16, 2, -2], [2, 0, 2]]);
        let out = gradient_reconstruct(&residuals.view(), -32768, 1000.0, 0.5);
        // (0,0) = 1000 + 4*0.5 = 1002 (level enters here)
        assert_eq!(out[[0, 0]], 1002.0);
        // (0,1) = 1002 + 2*0.5 = 1003
        assert_eq!(out[[0, 1]], 1003.0);
        // (0,2) = 1003 - 2*0.5 = 1002
        assert_eq!(out[[0, 2]], 1002.0);
        // (1,0) = 1002 + 2*0.5 = 1003 (above-predict from (0,0))
        assert_eq!(out[[1, 0]], 1003.0);
        // (1,1) = 1003 + 1003 + 1002 - 1002 = 1004
        assert_eq!(out[[1, 1]], 1004.0);
        // (1,2) = 1004 + 1004 + 1002 - 1003 = 1004
        assert_eq!(out[[1, 2]], 1004.0);
    }

    #[test]
    fn test_left_reconstruct_applies_dequant_params() {
        // Left reconstruction is a per-row cumsum of residual deltas; the
        // level seeds the run once at its first valid cell.
        let residuals = arr2(&[[4i16, 2, -2]]);
        let out = left_reconstruct(&residuals.view(), -32768, 1000.0, 0.5);
        assert_eq!(out[[0, 0]], 1002.0);
        assert_eq!(out[[0, 1]], 1003.0);
        assert_eq!(out[[0, 2]], 1002.0);
    }

    #[test]
    fn test_quantized_tile_roundtrip_matches_production_semantics() {
        // A production tile with bits < 16: the encoder quantizes
        // (`q = round((dem - vmin) / scale)`), predicts over `q`, and the
        // decoder must come back within half a quantum of the source DEM.
        // Regression for the double-`dequant_min` drift this module used to
        // carry: with vmin = 4605 (tile z10/758/428's level), the old
        // arithmetic added the level again on every first-row/first-column
        // cell and once more per reconstructed row, driving the Himalaya
        // tile into the output clamp (~65535 m instead of ~8162 m).
        let vmin = 4605.0_f32;
        let scale = 3557.0_f32 / 4095.0; // 12-bit tile, 3557 m of relief
        let dem = Array2::from_shape_fn((16, 16), |(i, j)| {
            vmin + 3000.0 * ((i % 4) as f32 / 3.0) + 500.0 * ((j % 5) as f32 / 4.0)
        });

        let quantized = ((&dem - vmin) / scale).mapv(f32::round);
        let residuals = gradient_predict(&quantized.view(), -32768.0);
        let out = gradient_reconstruct(&residuals.view(), -32768, vmin, scale);

        for i in 0..16 {
            for j in 0..16 {
                let err = (out[[i, j]] - dem[[i, j]]).abs();
                // Bound = half a quantum of true quantization noise, plus a
                // few ulps of f32 composition error: the gradient arm folds
                // three ~8 000 m values (`delta + left + top - diagonal`), so
                // ~0.001 m of float noise rides on top of the quantization.
                assert!(
                    err <= scale / 2.0 + 1e-2,
                    "cell ({i},{j}): {err} m off — drift is not quantization noise"
                );
            }
        }
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
    fn test_gradient_predict_nodata_free_payload_is_unchanged() {
        // Pinned from the pre-fallback encoder (values captured by running
        // `gradient-predict` on this exact grid before the change): a grid
        // holding no nodata must encode to the same residual payload it always
        // did, or every tile already in the dataset becomes undecodable.
        let elevation = arr2(&[
            [100.0f32, 150.0, 120.0, 90.0],
            [110.0, 160.0, 130.0, 85.0],
            [105.0, 155.0, 125.0, 95.0],
        ]);
        let expected = [100i16, 50, -30, -30, 10, 0, 0, -15, -5, 0, 0, 15];
        assert_eq!(
            gradient_predict(&elevation.view(), -32768.0)
                .into_raw_vec_and_offset()
                .0,
            expected,
            "a nodata-free payload must stay byte-identical"
        );
    }

    #[test]
    fn test_gradient_roundtrip_parity_grid_with_edge_sentinel() {
        // The reported failure, reduced: a sentinel in the first row's last
        // column used to feed -32768 into the three-neighbour predictor, so
        // every cell below it in that column decoded to garbage — 15 of the
        // 256 cells on this grid. The fallback keeps all of them exact.
        let side = 16;
        let nodata = -32768.0_f32;
        let mut elevation = Array2::from_shape_fn((side, side), |(i, j)| {
            1000.0 + 7.0 * (i + j) as f32 + 13.0 * ((i + j) % 2) as f32
        });
        elevation[[0, side - 1]] = nodata;

        let residuals = gradient_predict(&elevation.view(), nodata);
        assert_eq!(
            residuals[[0, side - 1]],
            -32768i16,
            "the sentinel encodes verbatim"
        );

        let decoded = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        for i in 0..side {
            for j in 0..side {
                if (i, j) == (0, side - 1) {
                    assert_eq!(decoded[[i, j]], nodata, "the hole stays a hole");
                } else {
                    assert_eq!(
                        decoded[[i, j]],
                        elevation[[i, j]],
                        "cell ({i},{j}) must survive the sentinel above it"
                    );
                }
            }
        }
    }

    #[test]
    fn test_gradient_roundtrip_nodata_hole_uses_every_fallback() {
        // Three sentinels with one valid cell (2,2) inside the hole: that cell
        // has no usable neighbour at all and predicts from its own residual,
        // (1,3) falls back to its top neighbour, (3,1) to its left, and (3,3)
        // — whose neighbours the hole no longer reaches — returns to the full
        // three-neighbour predictor.
        let nodata = -32768.0_f32;
        let elevation = arr2(&[
            [100.0f32, 120.0, 140.0, 160.0],
            [110.0, nodata, nodata, 170.0],
            [120.0, nodata, 160.0, 180.0],
            [130.0, 150.0, 170.0, 190.0],
        ]);

        let residuals = gradient_predict(&elevation.view(), nodata);
        assert_eq!(
            residuals[[2, 2]],
            160i16,
            "no usable neighbour: direct copy"
        );
        assert_eq!(residuals[[1, 3]], 10i16, "left unavailable: top neighbour");
        assert_eq!(residuals[[3, 1]], 20i16, "top unavailable: left neighbour");
        assert_eq!(residuals[[3, 3]], 0i16, "clear of the hole: full gradient");

        let decoded = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        for i in 0..4 {
            for j in 0..4 {
                assert_eq!(decoded[[i, j]], elevation[[i, j]], "cell ({i},{j})");
            }
        }
    }

    #[test]
    fn test_gradient_roundtrip_diagonal_only_fallback() {
        // The notch case: (2,2) has lost its left and top neighbours to the
        // sentinel but still holds a valid diagonal, so it predicts from that
        // alone — the last of the three single-neighbour fallbacks.
        let nodata = -32768.0_f32;
        let elevation = arr2(&[
            [100.0f32, 120.0, 140.0],
            [110.0, 130.0, nodata],
            [120.0, nodata, 160.0],
        ]);

        let residuals = gradient_predict(&elevation.view(), nodata);
        assert_eq!(residuals[[2, 2]], 30i16, "diagonal is the only ingredient");

        let decoded = gradient_reconstruct(&residuals.view(), -32768, 0.0, 1.0);
        for i in 0..3 {
            for j in 0..3 {
                assert_eq!(decoded[[i, j]], elevation[[i, j]], "cell ({i},{j})");
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
