//! Contract tests for the shipped `decode_ozt2` WASM export.
//!
//! `decode_ozt2` is js_sys-bound (JS objects in, JS objects out), so it cannot
//! execute on a host target — these tests run under `wasm-pack test --node`,
//! where the `js_sys` imports are live. The two `throw_str` rejection arms
//! (tile-too-short, uninferrable dimensions) raise real JS exceptions that a
//! Rust-side `catch_unwind` cannot intercept, so they stay validated by the
//! browser E2E (`api/e2e/ozt2-validate.spec.ts`, run with `E2E_RUN_HEAVY=1`)
//! rather than here.
//!
//! Run with: `wasm-pack test --node --features wasm`

#![cfg(all(feature = "wasm", target_arch = "wasm32"))]
// In tests an unwrap/expect failure IS the test failing, and every f32/f64
// compared below is integer-valued, so the arithmetic is exact.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;

/// Build a 2×2 OZT2 tile: 6-byte header + raw int16-LE residuals.
///
/// Header: vmin = 100, elev_range = 7, bits = 16 (unquantized → unit scale),
/// predictor 1 (left), compressor 1 (decompressor is called even though this
/// payload is already raw — the test's identity function passes it through).
///
/// Residual note: reconstruction dequantizes every cell as
/// `min + r·scale` and cumsums those values along the row, so each residual
/// contributes a `vmin` on top of the running sum; the values below are the
/// ones whose cumsum lands exactly on [[100, 103], [105, 107]].
fn two_by_two_left_tile() -> Vec<u8> {
    let mut tile = Vec::new();
    tile.extend_from_slice(&100_i16.to_le_bytes()); // vmin
    tile.extend_from_slice(&7_u16.to_le_bytes()); // elev_range
    tile.push(16); // bits
    tile.push(0x05); // predictor 1 (left) | compressor 1 (zlib slot) << 2
    for r in [0_i16, -97, 5, -98] {
        tile.extend_from_slice(&r.to_le_bytes());
    }
    tile
}

#[wasm_bindgen_test]
fn decode_ozt2_left_predictor_roundtrip_with_decompressor() {
    // A no-op decompressor in the zlib slot: decode must hand it the payload
    // verbatim and continue with the returned bytes.
    let identity = js_sys::Function::new_no_args("return arguments[0];");
    let tile = two_by_two_left_tile();

    let result = openzenith_core::wasm::decode_ozt2(&tile, &identity);

    // Left-predictor semantics: first cell of each row is vmin + r·scale,
    // the rest cumsum along the row. scale is 1.0 because bits == 16.
    // Row cumsum of dequantized cells: [[100+0, 100+0+100−97],
    // [100+5, 100+5+100−98]] → [[100, 103], [105, 107]].
    let elevations: js_sys::Uint16Array = js_sys::Reflect::get(&result, &"elevations".into())
        .unwrap()
        .unchecked_into();
    assert_eq!(elevations.length(), 4);
    let expected = [100_u16, 103, 105, 107];
    for (i, &want) in expected.iter().enumerate() {
        assert_eq!(elevations.get_index(i as u32), want, "cell {i}");
    }

    let metadata = js_sys::Reflect::get(&result, &"metadata".into()).unwrap();
    let num = |key: &str| {
        js_sys::Reflect::get(&metadata, &key.into())
            .unwrap()
            .as_f64()
            .unwrap()
    };
    let text = |key: &str| {
        js_sys::Reflect::get(&metadata, &key.into())
            .unwrap()
            .as_string()
            .unwrap()
    };

    assert_eq!(num("min_elevation"), 100.0);
    assert_eq!(num("elevation_range"), 7.0);
    assert_eq!(num("max_elevation"), 107.0);
    assert_eq!(num("bits_per_pixel"), 16.0);
    assert_eq!(num("width"), 2.0);
    assert_eq!(num("height"), 2.0);
    assert_eq!(text("predictor"), "left");
    assert_eq!(text("compressor"), "zlib");
}

#[wasm_bindgen_test]
fn decode_ozt2_uncompressed_gradient_tile_roundtrip() {
    // compressor 0 skips the decompressor entirely; predictor 0 takes the
    // gradient path. Gradient v = left + above − diag + (vmin + r·scale);
    // residuals [0, −40, −50, −50] land on [[50, 60], [50, 60]] — the
    // bottom-right cell takes (60 + 50 − 50) + (50 − 50).
    let mut tile = Vec::new();
    tile.extend_from_slice(&50_i16.to_le_bytes());
    tile.extend_from_slice(&10_u16.to_le_bytes());
    tile.push(16);
    tile.push(0x00); // predictor 0 (gradient) | compressor 0 (none) << 2
    for r in [0_i16, -40, -50, -50] {
        tile.extend_from_slice(&r.to_le_bytes());
    }

    // A decompressor that must never be called: calling it would return a
    // non-Uint8Array and break the unchecked_into contract.
    let boom = js_sys::Function::new_no_args("throw new Error('decompressor used');");

    let result = openzenith_core::wasm::decode_ozt2(&tile, &boom);

    let elevations: js_sys::Uint16Array = js_sys::Reflect::get(&result, &"elevations".into())
        .unwrap()
        .unchecked_into();
    let expected = [50_u16, 60, 50, 60];
    for (i, &want) in expected.iter().enumerate() {
        assert_eq!(elevations.get_index(i as u32), want, "cell {i}");
    }

    let metadata = js_sys::Reflect::get(&result, &"metadata".into()).unwrap();
    let predictor = js_sys::Reflect::get(&metadata, &"predictor".into())
        .unwrap()
        .as_string()
        .unwrap();
    let compressor = js_sys::Reflect::get(&metadata, &"compressor".into())
        .unwrap()
        .as_string()
        .unwrap();
    assert_eq!(predictor, "gradient");
    assert_eq!(compressor, "none");
}
