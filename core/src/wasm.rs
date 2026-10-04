//! WASM bindings for `openzenith-core` OZT2 decoder.
//!
//! Exposes gradient reconstruction and related functions to JavaScript via wasm-bindgen.
//!
//! Build with:
//!
//! ```text
//! wasm-pack build --target web
//! ```
//!
//! Usage in JS:
//!
//! ```text
//! import init, { gradient_reconstruct, decode_ozt2 } from "./pkg/openzenith_core.js";
//! await init();
//! const { data, metadata } = decode_ozt2(tile_bytes);
//! ```

// The exported functions take raw (ptr, len) pairs — that is the shipped JS
// ABI, consumed by api/src/app/wasm-demo via the wasm-bindgen glue. Every
// `unsafe` below is a slice view over WASM linear memory handed in by that
// glue; each block carries a SAFETY comment stating the caller contract.
#![allow(unsafe_code)]

use ndarray::Array2;
use wasm_bindgen::prelude::*;

/// Residual value that marks "no data" in an OZT2 tile; identical to the
/// elevation nodata sentinel used by the encoder.
const RESIDUAL_NODATA: i16 = -32768;

/// Set a property on a freshly created JS object.
///
/// `Reflect::set` only errors when the target is not an object (and returns
/// `false` for non-writable keys) — impossible for the objects this module
/// creates — but the failure path must not panic inside WASM, so it becomes a
/// JS exception instead.
fn set_js_prop(target: &js_sys::Object, key: &str, value: &JsValue) {
    if let Err(err) = js_sys::Reflect::set(target, &JsValue::from_str(key), value) {
        wasm_bindgen::throw_val(err);
    }
}

/// Clamp reconstructed metres into the `u16` elevation output range.
///
/// Values are rounded to the nearest whole metre, then clamped to
/// `0..=65535`; the range is a property of the shipped JS ABI, where
/// elevations are handed over as a `Uint16Array`.
fn clamp_to_u16_metres(values: &[f32]) -> Vec<u16> {
    values
        .iter()
        .map(|&v| {
            let metres = v.round() as i32;
            metres.clamp(0, 65535) as u16
        })
        .collect()
}

/// Human-readable name for an OZT2 header predictor code.
fn predictor_name(predictor: u8) -> &'static str {
    match predictor {
        0 => "gradient",
        1 => "left",
        _ => "none",
    }
}

/// Human-readable name for an OZT2 header compressor code.
fn compressor_name(compressor: u8) -> &'static str {
    match compressor {
        0 => "none",
        1 => "zlib",
        2 => "zstd",
        3 => "brotli",
        _ => "unknown",
    }
}

// ─── Gradient reconstruction (pure Rust, no external deps) ────────────────────

/// Reconstruct elevation from OZT2 gradient residuals (WASM).
///
/// # Arguments
/// * `residuals_ptr` – pointer to int16 residuals data
/// * `len` – number of elements
/// * `height` – tile height
/// * `width` – tile width
/// * `nodata` – nodata value (typically -32768)
/// * `dequant_min` – minimum dequantization value
/// * `dequant_scale` – dequantization scale
///
/// # Returns
/// A `Uint16Array` of reconstructed elevations in whole metres, clamped to
/// `0..=65535`.
///
/// # Safety
/// `residuals_ptr` must point to `len` readable `i16` elements in WASM linear
/// memory (as produced by the JS glue's `__wbindgen_malloc` + typed-array
/// copy) and must stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn gradient_reconstruct_wasm(
    residuals_ptr: *const i16,
    len: usize,
    height: usize,
    width: usize,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Vec<u16> {
    // SAFETY: `residuals_ptr`/`len` are produced by the wasm-bindgen JS glue
    // for a typed array copied into (or viewed in) WASM linear memory. The
    // caller guarantees the buffer outlives this call and that `len` matches
    // its element count.
    let residuals_slice = unsafe { std::slice::from_raw_parts(residuals_ptr, len) };

    let arr: Array2<i16> = Array2::from_shape_vec((height, width), residuals_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    let reconstructed =
        super::ozt2::gradient_reconstruct(&arr.view(), nodata, dequant_min, dequant_scale);

    clamp_to_u16_metres(&reconstructed.into_raw_vec_and_offset().0)
}

/// Left-predict reconstruction (WASM).
///
/// # Safety
/// Same contract as [`gradient_reconstruct_wasm`]: `residuals_ptr` must point
/// to `len` readable `i16` elements and stay valid for the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn left_reconstruct_wasm(
    residuals_ptr: *const i16,
    len: usize,
    height: usize,
    width: usize,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Vec<u16> {
    // SAFETY: same caller contract as `gradient_reconstruct_wasm` — pointer and
    // length come from the JS glue for a live int16 buffer.
    let residuals_slice = unsafe { std::slice::from_raw_parts(residuals_ptr, len) };

    let arr: Array2<i16> = Array2::from_shape_vec((height, width), residuals_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    let reconstructed =
        super::ozt2::left_reconstruct(&arr.view(), nodata, dequant_min, dequant_scale);

    clamp_to_u16_metres(&reconstructed.into_raw_vec_and_offset().0)
}

/// Gradient prediction (encode direction) — compute residuals from elevation grid (WASM).
///
/// # Returns
/// A `Uint16Array` of int16 residuals (as unsigned for WASM compatibility).
///
/// # Safety
/// `elevation_ptr` must point to `len` readable `f32` elements in WASM linear
/// memory and stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn gradient_predict_wasm(
    elevation_ptr: *const f32,
    len: usize,
    rows: usize,
    cols: usize,
    nodata: f32,
) -> Vec<i16> {
    // SAFETY: pointer/length come from the JS glue for a live f32 elevation
    // buffer; caller guarantees it outlives the call with a matching length.
    let elev_slice = unsafe { std::slice::from_raw_parts(elevation_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), elev_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let residuals = super::ozt2::gradient_predict(&arr.view(), nodata);
    residuals.into_raw_vec_and_offset().0
}

/// D8 flow direction (WASM) — returns a `Uint8Array` of direction values
/// (0-7, or 255 for nodata).
///
/// # Safety
/// `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
/// and stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn d8_flow_direction_wasm(
    dem_ptr: *const f32,
    len: usize,
    rows: usize,
    cols: usize,
    nodata: f32,
) -> Vec<u8> {
    // SAFETY: pointer/length come from the JS glue for a live f32 DEM buffer;
    // caller guarantees it outlives the call with a matching length.
    let dem_slice = unsafe { std::slice::from_raw_parts(dem_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), dem_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let fd = super::d8::d8_flow_direction(&arr.view(), nodata);
    let (out, _) = fd.into_raw_vec_and_offset();
    out.into_iter().map(|x| x as u8).collect()
}

/// Flow accumulation (WASM) — returns a `Uint32Array` of upstream counts.
///
/// # Safety
/// `flow_dir_ptr` must point to `len` readable `i8` elements in WASM linear
/// memory and stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn flow_accumulation_wasm(
    flow_dir_ptr: *const i8,
    len: usize,
    rows: usize,
    cols: usize,
    nodata_dir: i8,
) -> Vec<u32> {
    // SAFETY: pointer/length come from the JS glue for a live i8 flow-direction
    // buffer; caller guarantees it outlives the call with a matching length.
    let fd_slice = unsafe { std::slice::from_raw_parts(flow_dir_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), fd_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let accum = super::d8::flow_accumulation(&arr.view(), nodata_dir);
    let (raw, _) = accum.into_raw_vec_and_offset();
    raw.into_iter().map(|x| x as u32).collect()
}

/// Viewshed (WASM) — returns a `Uint8Array` of visibility (0/1).
///
/// # Safety
/// `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
/// and stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
// 10 parameters is the WASM ABI, not a design smell: raw-pointer exports are
// flattened (ptr, len, rows, cols, ...) because the JS glue has no struct
// marshalling. The typed-array callers in api/src/app/wasm-demo pass exactly
// these positional arguments.
#[allow(clippy::too_many_arguments)]
pub unsafe fn viewshed_wasm(
    dem_ptr: *const f32,
    len: usize,
    rows: usize,
    cols: usize,
    observer_row: usize,
    observer_col: usize,
    observer_height: f32,
    cell_size: f32,
    nodata: f32,
    max_distance_cells: Option<usize>,
) -> Vec<u8> {
    // SAFETY: pointer/length come from the JS glue for a live f32 DEM buffer;
    // caller guarantees it outlives the call with a matching length.
    let dem_slice = unsafe { std::slice::from_raw_parts(dem_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), dem_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let vis = super::viewshed::viewshed(
        &arr.view(),
        observer_row,
        observer_col,
        observer_height,
        cell_size,
        nodata,
        max_distance_cells,
    );

    vis.into_raw_vec_and_offset()
        .0
        .iter()
        .map(|&b| u8::from(b))
        .collect()
}

/// The 6-byte OZT2 tile header, decoded from little-endian bytes.
struct TileHeader {
    /// Minimum elevation of the tile, in metres.
    vmin: i16,
    /// Elevation range of the tile (max - min), in metres.
    elev_range: i32,
    /// Bits per quantized residual (16 means unquantized).
    bits: u8,
    /// Predictor code: 0 = gradient, 1 = left, anything else = none.
    predictor: u8,
    /// Compressor code: 0 = none, 1 = zlib, 2 = zstd, 3 = brotli.
    compressor: u8,
}

impl TileHeader {
    /// Decode the leading 6 bytes of a tile. Returns `None` when `tile_bytes`
    /// is too short to hold a header.
    fn parse(tile_bytes: &[u8]) -> Option<Self> {
        if tile_bytes.len() < 6 {
            return None;
        }
        Some(Self {
            vmin: i16::from_le_bytes([tile_bytes[0], tile_bytes[1]]),
            elev_range: i32::from(u16::from_le_bytes([tile_bytes[2], tile_bytes[3]])),
            bits: tile_bytes[4],
            predictor: tile_bytes[5] & 0x03,
            compressor: (tile_bytes[5] >> 2) & 0x03,
        })
    }

    /// Dequantization parameters `(min, scale)` in metres: scale is derived
    /// from the elevation range and the quantization bit depth, and is 1.0 for
    /// unquantized (16-bit) tiles or tiles that declare no range.
    fn dequant_params(&self) -> (f32, f32) {
        if self.bits < 16 && self.elev_range > 0 {
            let max_quantum = ((1i32 << self.bits) - 1) as f32;
            (f32::from(self.vmin), self.elev_range as f32 / max_quantum)
        } else {
            (f32::from(self.vmin), 1.0_f32)
        }
    }
}

/// Infer `(height, width)` from a residual element count.
///
/// A perfect square decodes as `n × n`; otherwise the first known tile width
/// that divides the count wins. Returns `None` when no width fits.
fn infer_dimensions(total_pixels: usize) -> Option<(usize, usize)> {
    let side = (total_pixels as f64).sqrt() as usize;
    if side * side == total_pixels {
        return Some((side, side));
    }
    for width in [256, 512, 1024, 3601, 128, 64] {
        if total_pixels.is_multiple_of(width) {
            return Some((total_pixels / width, width));
        }
    }
    None
}

/// Build the metadata JS object returned alongside the decoded elevations.
fn build_metadata(header: &TileHeader, width: usize, height: usize) -> js_sys::Object {
    let metadata = js_sys::Object::new();
    set_js_prop(
        &metadata,
        "min_elevation",
        &JsValue::from(f64::from(header.vmin)),
    );
    set_js_prop(
        &metadata,
        "elevation_range",
        &JsValue::from(f64::from(header.elev_range)),
    );
    // vmin (i16) and elev_range (i32) must widen to a common type before adding.
    set_js_prop(
        &metadata,
        "max_elevation",
        &JsValue::from(f64::from(i32::from(header.vmin) + header.elev_range)),
    );
    set_js_prop(
        &metadata,
        "bits_per_pixel",
        &JsValue::from(f64::from(header.bits)),
    );
    set_js_prop(
        &metadata,
        "predictor",
        &JsValue::from(predictor_name(header.predictor)),
    );
    set_js_prop(
        &metadata,
        "compressor",
        &JsValue::from(compressor_name(header.compressor)),
    );
    set_js_prop(&metadata, "width", &JsValue::from(width as f64));
    set_js_prop(&metadata, "height", &JsValue::from(height as f64));
    metadata
}

/// OZT2 decode: decompress and reconstruct a full OZT2 tile.
///
/// # Arguments
/// * `tile_bytes` – `Uint8Array` of OZT2 binary data (6-byte header followed
///   by the compressed residual stream)
/// * `decompress_fn` – JS function called to decompress:
///   `(bytes: Uint8Array) -> Uint8Array`
///
/// # Returns
/// A JS object `{ elevations: Uint16Array, metadata: Object }`, where
/// `metadata` carries `min_elevation`, `elevation_range`, `max_elevation`,
/// `bits_per_pixel`, `predictor`, `compressor`, `width` and `height`.
///
/// # Errors
/// Throws a JS exception (never panics) when the tile is shorter than the
/// 6-byte header, when the JS decompressor rejects the payload, or when the
/// decoded pixel count matches no known tile shape.
#[must_use]
#[wasm_bindgen]
pub fn decode_ozt2(tile_bytes: &[u8], decompress_fn: &js_sys::Function) -> JsValue {
    // Parse header (6 bytes)
    let Some(header) = TileHeader::parse(tile_bytes) else {
        wasm_bindgen::throw_str("Tile too small: less than 6 bytes")
    };

    // Call JS decompression function
    let compressed = &tile_bytes[6..];

    // Decompress (skip if compressor=0 / "none")
    let decompressed: Vec<u8> = if header.compressor == 0 {
        // No compression — residuals are stored directly as int16 LE bytes
        compressed.to_vec()
    } else {
        let js_compressed = js_sys::Uint8Array::from(compressed);
        let decompressed_js: js_sys::Uint8Array = decompress_fn
            .call1(&JsValue::NULL, &js_compressed)
            // A JS-side decompression failure surfaces as a JS exception, not a
            // WASM panic.
            .unwrap_or_else(|err| wasm_bindgen::throw_val(err))
            .unchecked_into();

        let decompressed_len = decompressed_js.length() as usize;
        let mut raw = vec![0u8; decompressed_len];
        decompressed_js.copy_to(&mut raw);
        raw
    };

    // Residuals are always int16
    let residuals: Vec<i16> = decompressed
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| i16::from_le_bytes(*chunk))
        .collect();

    let Some((height, width)) = infer_dimensions(residuals.len()) else {
        let pixels = residuals.len();
        wasm_bindgen::throw_str(&format!(
            "Cannot infer tile dimensions from {pixels} pixels"
        ))
    };

    let residuals_arr = Array2::from_shape_vec((height, width), residuals)
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    // Reconstructed values are already in metres (dequantized during
    // reconstruction); clamp to the valid elevation range on the way out.
    let (dequant_min, dequant_scale) = header.dequant_params();
    let reconstructed = if header.predictor == 0 {
        super::ozt2::gradient_reconstruct(
            &residuals_arr.view(),
            RESIDUAL_NODATA,
            dequant_min,
            dequant_scale,
        )
    } else {
        super::ozt2::left_reconstruct(
            &residuals_arr.view(),
            RESIDUAL_NODATA,
            dequant_min,
            dequant_scale,
        )
    };

    let elevations = clamp_to_u16_metres(&reconstructed.into_raw_vec_and_offset().0);

    // Return { elevations: Uint16Array, metadata: Object }
    let result = js_sys::Object::new();
    let elev_array = js_sys::Uint16Array::from(&elevations[..]);
    set_js_prop(&result, "elevations", &JsValue::from(elev_array));
    set_js_prop(
        &result,
        "metadata",
        &JsValue::from(build_metadata(&header, width, height)),
    );

    result.into()
}

#[cfg(all(test, feature = "wasm"))]
mod tests {
    // These assertions compare integer-valued f32 results of exact arithmetic,
    // so `assert_eq!` is exact. As in tests/cli_integration_test.rs, an
    // unwrap/expect failure here IS the test failing.
    #![allow(clippy::float_cmp, clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn test_header_parse_rejects_short_input() {
        assert!(TileHeader::parse(&[]).is_none());
        assert!(TileHeader::parse(&[0u8; 5]).is_none());
        assert!(TileHeader::parse(&[0u8; 6]).is_some());
    }

    #[test]
    fn test_header_parse_decodes_fields() {
        // vmin = -32768 (LE 0x00,0x80), range = 1 (LE 0x01,0x00), bits = 16,
        // flags = 0x04 → predictor 0 (gradient), compressor 1 (zlib).
        let header = TileHeader::parse(&[0x00, 0x80, 0x01, 0x00, 16, 0x04]).unwrap();
        assert_eq!(header.vmin, -32768);
        assert_eq!(header.elev_range, 1);
        assert_eq!(header.bits, 16);
        assert_eq!(header.predictor, 0);
        assert_eq!(header.compressor, 1);
    }

    #[test]
    fn test_dequant_params_unquantized_is_unit_scale() {
        let header = TileHeader {
            vmin: -12,
            elev_range: 500,
            bits: 16,
            predictor: 0,
            compressor: 0,
        };
        assert_eq!(header.dequant_params(), (-12.0_f32, 1.0_f32));
    }

    #[test]
    fn test_dequant_params_quantized_spreads_range() {
        // 8-bit quantization over a 255 m range → 1 m per quantum step.
        let header = TileHeader {
            vmin: 100,
            elev_range: 255,
            bits: 8,
            predictor: 0,
            compressor: 0,
        };
        assert_eq!(header.dequant_params(), (100.0_f32, 1.0_f32));
    }

    #[test]
    fn test_infer_dimensions_square_and_known_widths() {
        assert_eq!(infer_dimensions(256 * 256), Some((256, 256)));
        assert_eq!(infer_dimensions(2 * 3601), Some((2, 3601)));
        assert_eq!(infer_dimensions(0), Some((0, 0)));
        assert_eq!(infer_dimensions(257), None);
    }

    #[test]
    fn test_clamp_to_u16_metres_rounds_and_clamps() {
        assert_eq!(
            clamp_to_u16_metres(&[-500.0, -1.5, 0.4, 12.6, 70_000.0]),
            vec![0, 0, 0, 13, 65_535]
        );
    }

    #[test]
    fn test_predictor_and_compressor_names() {
        assert_eq!(predictor_name(0), "gradient");
        assert_eq!(predictor_name(1), "left");
        assert_eq!(predictor_name(2), "none");
        assert_eq!(compressor_name(0), "none");
        assert_eq!(compressor_name(2), "zstd");
        assert_eq!(compressor_name(9), "unknown");
    }
}
