//! WASM bindings for `openzenith-core` OZT2 decoder.
//!
//! Exposes gradient reconstruction and related functions to JavaScript via wasm-bindgen.
//!
//! Build with (the `wasm` feature gates this whole module, so it must be
//! passed explicitly — a plain `wasm-pack build` produces bindings with no
//! exported functions):
//!
//! ```text
//! wasm-pack build --target web --out-dir ../api/public/pkg core -- --features wasm
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

/// Header predictor/compressor codes — the OZT2 production convention, shared
/// with the Python encoder (`openzenith/tile_format_v2.py`) and the edge
/// decoder (`api/src/lib/ozt2_decode.ts`). Every shipped tile uses these
/// codes, so this module must not invent its own.
const PRED_NONE: u8 = 0;
const PRED_LEFT: u8 = 1;
const PRED_GRADIENT: u8 = 2;

const COMP_BROTLI: u8 = 0;
const COMP_ZSTD: u8 = 1;
const COMP_ZLIB: u8 = 2;
/// Reserved for tiles that ship an uncompressed residual stream; the Python
/// encoder never emits it, but decoding must not route it through a
/// decompressor.
const COMP_NONE: u8 = 3;

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
const fn predictor_name(predictor: u8) -> &'static str {
    match predictor {
        PRED_NONE => "none",
        PRED_LEFT => "left",
        PRED_GRADIENT => "gradient",
        _ => "unknown",
    }
}

/// Human-readable name for an OZT2 header compressor code.
const fn compressor_name(compressor: u8) -> &'static str {
    match compressor {
        COMP_BROTLI => "brotli",
        COMP_ZSTD => "zstd",
        COMP_ZLIB => "zlib",
        COMP_NONE => "none",
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

/// Stream order (Strahler) (WASM) — returns a `Uint8Array` of orders.
///
/// Mirrors the CLI's `stream-order` contract exactly: `streams` holds
/// 1 for a stream cell and 0 otherwise, `flow_dir` holds D8 compass indices
/// with `nodata_dir` marking "no flow" (-1 for `d8_flow_direction` output),
/// and the result carries the Strahler order per cell — 0 = non-stream,
/// 1 = headwater, n = order n. Unlike the D8 export there is no two's
/// -complement remapping here: orders are already unsigned.
///
/// # Safety
/// `streams_ptr` and `flow_dir_ptr` must each point to `len` readable `i8`
/// elements in WASM linear memory and stay valid for the duration of the call.
#[must_use]
#[wasm_bindgen]
pub unsafe fn stream_order_wasm(
    streams_ptr: *const i8,
    flow_dir_ptr: *const i8,
    len: usize,
    rows: usize,
    cols: usize,
    nodata_dir: i8,
) -> Vec<u8> {
    // SAFETY: pointer/length pairs come from the JS glue for two live i8
    // buffers; the caller guarantees they outlive the call with matching
    // lengths.
    let streams_slice = unsafe { std::slice::from_raw_parts(streams_ptr, len) };
    let flow_dir_slice = unsafe { std::slice::from_raw_parts(flow_dir_ptr, len) };

    let streams = Array2::from_shape_vec((rows, cols), streams_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));
    let flow_dir = Array2::from_shape_vec((rows, cols), flow_dir_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    super::d8::stream_order(&streams.view(), &flow_dir.view(), nodata_dir)
        .into_raw_vec_and_offset()
        .0
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
#[derive(Debug)]
struct TileHeader {
    /// Minimum elevation of the tile, in metres.
    vmin: i16,
    /// Elevation range of the tile (max - min), in metres.
    elev_range: i32,
    /// Bits per quantized residual (16 means unquantized).
    bits: u8,
    /// Predictor code: 0 = none, 1 = left, 2 = gradient (production codes).
    predictor: u8,
    /// Compressor code: 0 = brotli, 1 = zstd, 2 = zlib, 3 = none.
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

/// Validate the tile header and reconstruct metres from a decompressed OZT2
/// payload — the pure (js-free) heart of the wasm `decode_ozt2` binding, so
/// the header/dimension/dispatch logic is host-testable.
///
/// `decompressed` is the payload after the 6-byte header, already through the
/// JS decompressor (or raw when the tile declares no compression).
///
/// # Errors
/// The same conditions the wasm binding throws for: short header, unknown
/// predictor code, or a pixel count matching no known tile shape.
fn decode_ozt2_core(
    tile_bytes: &[u8],
    decompressed: &[u8],
) -> Result<(Vec<u16>, usize, usize, TileHeader), String> {
    let Some(header) = TileHeader::parse(tile_bytes) else {
        return Err("Tile too small: less than 6 bytes".to_string());
    };
    if header.predictor > PRED_GRADIENT {
        return Err(format!("Unknown predictor code {}", header.predictor));
    }

    // Residuals are always int16
    let residuals: Vec<i16> = decompressed
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| i16::from_le_bytes(*chunk))
        .collect();

    let Some((height, width)) = infer_dimensions(residuals.len()) else {
        return Err(format!(
            "Cannot infer tile dimensions from {} pixels",
            residuals.len()
        ));
    };

    let residuals_arr = Array2::from_shape_vec((height, width), residuals)
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    // Reconstructed values are already in metres (dequantized during
    // reconstruction); clamp to the valid elevation range on the way out.
    let (dequant_min, dequant_scale) = header.dequant_params();
    // Not fused: dequantization is a codec contract shared with `ozt2.rs` and
    // the Python/numpy decoder — all three must round identically, and a
    // single-rounding fma would drift a ULP away from both.
    #[allow(clippy::suboptimal_flops)]
    let reconstructed = match header.predictor {
        PRED_NONE => {
            // No predictor: the residual stream already holds the quantized
            // elevations, so dequantization is the whole reconstruction.
            residuals_arr.map(|&r| {
                if r == RESIDUAL_NODATA {
                    f32::from(RESIDUAL_NODATA)
                } else {
                    dequant_min + f32::from(r) * dequant_scale
                }
            })
        }
        PRED_LEFT => super::ozt2::left_reconstruct(
            &residuals_arr.view(),
            RESIDUAL_NODATA,
            dequant_min,
            dequant_scale,
        ),
        _ => super::ozt2::gradient_reconstruct(
            &residuals_arr.view(),
            RESIDUAL_NODATA,
            dequant_min,
            dequant_scale,
        ),
    };

    let elevations = clamp_to_u16_metres(&reconstructed.into_raw_vec_and_offset().0);
    Ok((elevations, width, height, header))
}

/// OZT2 decode: decompress and reconstruct a full OZT2 tile.
///
/// Header codes follow the production convention (`openzenith/tile_format_v2.py`,
/// `api/src/lib/ozt2_decode.ts`): predictor 0=none/1=left/2=gradient,
/// compressor 0=brotli/1=zstd/2=zlib/3=none.
///
/// # Arguments
/// * `tile_bytes` – `Uint8Array` of OZT2 binary data (6-byte header followed
///   by the compressed residual stream)
/// * `decompress_fn` – JS function called to decompress:
///   `(bytes: Uint8Array, compressor: number) -> Uint8Array`. The second
///   argument is the header's compressor code, so one JS dispatcher can route
///   brotli/zstd/zlib; it is not called for compressor code 3 (none).
///
/// # Returns
/// A JS object `{ elevations: Uint16Array, metadata: Object }`, where
/// `metadata` carries `min_elevation`, `elevation_range`, `max_elevation`,
/// `bits_per_pixel`, `predictor`, `compressor`, `width` and `height`.
///
/// # Errors
/// Throws a JS exception (never panics) when the tile is shorter than the
/// 6-byte header, when the predictor or compressor code is not part of the
/// production convention, when the JS decompressor rejects the payload, or
/// when the decoded pixel count matches no known tile shape.
#[must_use]
#[wasm_bindgen]
pub fn decode_ozt2(tile_bytes: &[u8], decompress_fn: &js_sys::Function) -> JsValue {
    // Parse/validate up front so a bad header or predictor reports before any
    // JS decompression runs (decode_ozt2_core re-parses the 6-byte header).
    let Some(header) = TileHeader::parse(tile_bytes) else {
        wasm_bindgen::throw_str("Tile too small: less than 6 bytes")
    };
    if header.predictor > PRED_GRADIENT {
        wasm_bindgen::throw_str(&format!("Unknown predictor code {}", header.predictor));
    }

    // Call JS decompression function
    let compressed = &tile_bytes[6..];

    // Decompress (skip when the tile declares no compression)
    let decompressed: Vec<u8> = if header.compressor == COMP_NONE {
        // No compression — residuals are stored directly as int16 LE bytes
        compressed.to_vec()
    } else {
        let js_compressed = js_sys::Uint8Array::from(compressed);
        let decompressed_js: js_sys::Uint8Array = decompress_fn
            .call2(
                &JsValue::NULL,
                &js_compressed,
                &JsValue::from(f64::from(header.compressor)),
            )
            // A JS-side decompression failure surfaces as a JS exception, not a
            // WASM panic.
            .unwrap_or_else(|err| wasm_bindgen::throw_val(err))
            .unchecked_into();

        let decompressed_len = decompressed_js.length() as usize;
        let mut raw = vec![0u8; decompressed_len];
        decompressed_js.copy_to(&mut raw);
        raw
    };

    // Residuals are always int16 — parsing, dimension inference and
    // reconstruction live in the js-free core so the host tests cover them.
    // The header errors can't fire here (validated above), but the
    // decompressed length only exists after JS ran, so dimension inference
    // can still fail and must surface its message.
    let (elevations, width, height, header) = match decode_ozt2_core(tile_bytes, &decompressed) {
        Ok(decoded) => decoded,
        Err(msg) => wasm_bindgen::throw_str(&msg),
    };

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
        // flags = 0x0A → predictor 2 (gradient), compressor 2 (zlib) — the
        // codes a Python-encoded gradient/zlib tile carries.
        let header = TileHeader::parse(&[0x00, 0x80, 0x01, 0x00, 16, 0x0A]).unwrap();
        assert_eq!(header.vmin, -32768);
        assert_eq!(header.elev_range, 1);
        assert_eq!(header.bits, 16);
        assert_eq!(header.predictor, PRED_GRADIENT);
        assert_eq!(header.compressor, COMP_ZLIB);

        // A default production tile (gradient predictor + brotli, the encoder's
        // default compressor) parses the same way it does in
        // api/src/lib/ozt2_decode.ts.
        let header = TileHeader::parse(&[0x00, 0x80, 0x01, 0x00, 16, 0x02]).unwrap();
        assert_eq!(header.predictor, PRED_GRADIENT);
        assert_eq!(header.compressor, COMP_BROTLI);
    }

    #[test]
    fn test_predictor_and_compressor_names_match_production() {
        assert_eq!(predictor_name(PRED_NONE), "none");
        assert_eq!(predictor_name(PRED_LEFT), "left");
        assert_eq!(predictor_name(PRED_GRADIENT), "gradient");
        assert_eq!(predictor_name(9), "unknown");
        assert_eq!(compressor_name(COMP_BROTLI), "brotli");
        assert_eq!(compressor_name(COMP_ZSTD), "zstd");
        assert_eq!(compressor_name(COMP_ZLIB), "zlib");
        assert_eq!(compressor_name(COMP_NONE), "none");
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

    // ── decode_ozt2_core (the js-free decode pipeline) ──────────────────────

    /// A minimal OZT2 tile: 6-byte header (vmin, range, bits, flags) plus the
    /// little-endian int16 payload.
    fn make_tile(predictor: u8, compressor: u8, vmin: i16, bits: u8, payload: &[i16]) -> Vec<u8> {
        let mut tile = Vec::with_capacity(6 + payload.len() * 2);
        tile.extend_from_slice(&vmin.to_le_bytes());
        tile.extend_from_slice(&0u16.to_le_bytes());
        tile.push(bits);
        tile.push(predictor | (compressor << 2));
        for v in payload {
            tile.extend_from_slice(&v.to_le_bytes());
        }
        tile
    }

    #[test]
    fn test_decode_core_rejects_short_header() {
        let err = decode_ozt2_core(&[0, 0, 0], &[]).unwrap_err();
        assert!(err.contains("Tile too small"), "{err}");
    }

    #[test]
    fn test_decode_core_rejects_unknown_predictor() {
        // Predictor code 3 is outside the production convention (0/1/2).
        let tile = make_tile(3, 0, 0, 16, &[0, 0, 0, 0]);
        let err = decode_ozt2_core(&tile, &[0; 8]).unwrap_err();
        assert!(err.contains("Unknown predictor code 3"), "{err}");
    }

    #[test]
    fn test_decode_core_rejects_undecodable_pixel_count() {
        // 3 int16 values match no known tile shape (257-value check fails,
        // squares and the known-width table both miss).
        let tile = make_tile(0, 3, 0, 16, &[0, 0, 0]);
        let err = decode_ozt2_core(&tile, &[0; 6]).unwrap_err();
        assert!(
            err.contains("Cannot infer tile dimensions from 3 pixels"),
            "{err}"
        );
    }

    #[test]
    fn test_decode_core_direct_predictor_dequantizes() {
        // predictor 0 (none): payload values ARE the quantized elevations, so
        // output = vmin + r * scale with scale = range / (2^bits - 1); a zero
        // range means unit scale (values pass through clamped).
        let tile = make_tile(0, 3, 100, 16, &[0, 10, 0, -10]);
        let (elevations, width, height, header) =
            decode_ozt2_core(&tile, &[0, 0, 10, 0, 0, 0, 0xF6, 0xFF]).unwrap();
        assert_eq!((width, height), (2, 2));
        assert_eq!(header.predictor, 0);
        assert_eq!(elevations, vec![100, 110, 100, 90]);
    }

    #[test]
    fn test_decode_core_left_predictor_reconstructs_run() {
        // Left residuals [0, 5, 0, 2] at unit scale seed 42 at (0,0): the
        // first row cumsums 42, 47; the second row seeds from the raw
        // residual again (rows are independent), giving 42, 44.
        let tile = make_tile(1, 3, 42, 16, &[0, 5, 0, 2]);
        let (elevations, _w, _h, _meta) =
            decode_ozt2_core(&tile, &[0, 0, 5, 0, 0, 0, 2, 0]).unwrap();
        assert_eq!(elevations, vec![42, 47, 42, 44]);
    }

    #[test]
    fn test_decode_core_gradient_predictor_matches_ozt2_module() {
        // 2x2 gradient tile at unit scale: residual 7 with no left
        // neighbour falls back to the level (500+7); the bottom row predicts
        // 507 from left+top-diagonal and its zero residuals hold it there.
        let tile = make_tile(2, 3, 500, 16, &[0, 7, 0, 0]);
        let (elevations, _w, _h, _meta) =
            decode_ozt2_core(&tile, &[0, 0, 7, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(elevations, vec![500, 507, 500, 507]);
    }

    #[test]
    fn test_decode_core_sentinel_survives_direct_path() {
        // The -32768 residual passes through verbatim and the u16 clamp maps
        // the sentinel to 0 at the ABI boundary (matching decode semantics).
        let tile = make_tile(0, 3, 0, 16, &[-32768]);
        let (elevations, _w, _h, _meta) = decode_ozt2_core(&tile, &[0x00, 0x80]).unwrap();
        assert_eq!(elevations, vec![0]);
    }

    // ── exported glue (raw ptr + len ABI, no js_sys involved) ─────────────────
    //
    // These run on the host target: the exports are plain Rust functions that
    // read a caller-provided slice out of linear memory, so the ABI contract —
    // (ptr, len, rows, cols, …) → clamped integer grid — is verifiable without
    // a browser. Only `decode_ozt2` (js_sys objects) needs the wasm32 runtime.

    #[test]
    fn test_gradient_reconstruct_wasm_abi() {
        // residuals [[0, 257], [300, 100]] → [[0, 257], [300, 657]] metres.
        let residuals: Vec<i16> = vec![0, 257, 300, 100];
        let out = unsafe {
            gradient_reconstruct_wasm(
                residuals.as_ptr(),
                residuals.len(),
                2,
                2,
                RESIDUAL_NODATA,
                0.0,
                1.0,
            )
        };
        assert_eq!(out, vec![0, 257, 300, 657]);
    }

    #[test]
    fn test_gradient_reconstruct_wasm_clamps_to_u16_range() {
        // Negative metres clamp to 0 — the Uint16Array output range of the
        // shipped ABI cannot represent below sea level here.
        let below_sea: Vec<i16> = vec![0, -12, 32767, 32767];
        let out = unsafe {
            gradient_reconstruct_wasm(
                below_sea.as_ptr(),
                below_sea.len(),
                2,
                2,
                RESIDUAL_NODATA,
                0.0,
                1.0,
            )
        };
        // [[0, -12], [32767, 65522]] metres — only the negative cell clamps.
        assert_eq!(out, vec![0, 0, 32_767, 65_522]);

        // Reconstruction can also overshoot u16 (32 767 m of gradient three
        // ways), and that clamps at the top of the range instead of wrapping.
        let overshoot: Vec<i16> = vec![0, 32767, 32767, 32767];
        let out = unsafe {
            gradient_reconstruct_wasm(
                overshoot.as_ptr(),
                overshoot.len(),
                2,
                2,
                RESIDUAL_NODATA,
                0.0,
                1.0,
            )
        };
        // (1,1) = 32767 * 3 = 98301 m → 65535.
        assert_eq!(out, vec![0, 32_767, 32_767, 65_535]);
    }

    #[test]
    fn test_gradient_reconstruct_wasm_shape_mismatch_yields_zero_tile() {
        // A len that fits no shape falls back to a zero-filled grid rather than
        // panicking inside WASM. The JS glue always passes a matching length;
        // this pins the failure mode to a defined result.
        let residuals: Vec<i16> = vec![1, 2, 3];
        let out = unsafe {
            gradient_reconstruct_wasm(
                residuals.as_ptr(),
                residuals.len(),
                2,
                2,
                RESIDUAL_NODATA,
                0.0,
                1.0,
            )
        };
        assert_eq!(out, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_left_reconstruct_wasm_abi() {
        // Row-wise cumsum: [[10, 5], [3, 4]] → [[10, 15], [3, 7]].
        let residuals: Vec<i16> = vec![10, 5, 3, 4];
        let out = unsafe {
            left_reconstruct_wasm(
                residuals.as_ptr(),
                residuals.len(),
                2,
                2,
                RESIDUAL_NODATA,
                0.0,
                1.0,
            )
        };
        assert_eq!(out, vec![10, 15, 3, 7]);
    }

    #[test]
    fn test_gradient_predict_wasm_abi() {
        // Elevation [[100, 150], [110, 160]] → residuals [[100, 50], [10, 0]].
        let elevation: Vec<f32> = vec![100.0, 150.0, 110.0, 160.0];
        let out =
            unsafe { gradient_predict_wasm(elevation.as_ptr(), elevation.len(), 2, 2, -32768.0) };
        assert_eq!(out, vec![100, 50, 10, 0]);
    }

    #[test]
    fn test_d8_flow_direction_wasm_abi() {
        // [[10, 5], [10, 5]]: (0,0) and (1,0) drain E (0); (0,1) and (1,1) are
        // pits, reported as 255 for the Uint8Array output.
        let dem: Vec<f32> = vec![10.0, 5.0, 10.0, 5.0];
        let out = unsafe { d8_flow_direction_wasm(dem.as_ptr(), dem.len(), 2, 2, -32768.0) };
        assert_eq!(out, vec![0, 255, 0, 255]);
    }

    #[test]
    fn test_flow_accumulation_wasm_abi() {
        // (0,0) drains S into (1,0) → accumulations 1 and 2; the right column
        // is two pits with 1 each.
        let flow_dir: Vec<i8> = vec![2, -1, -1, -1];
        let out = unsafe { flow_accumulation_wasm(flow_dir.as_ptr(), flow_dir.len(), 2, 2, -1) };
        assert_eq!(out, vec![1, 1, 2, 1]);
    }

    #[test]
    fn test_stream_order_wasm_abi() {
        // Two order-1 headwaters — (0,0) draining S and (0,1) draining S —
        // converge on (1,1) from (1,0) via E and from (0,1) via S, so (1,1)
        // is promoted to order 2. Row-major expected: [1, 1, 0, 1, 2, 0].
        let streams: Vec<i8> = vec![1, 1, 0, 1, 1, 0];
        let flow_dir: Vec<i8> = vec![2, 2, -1, 0, -1, -1];
        let out = unsafe {
            stream_order_wasm(streams.as_ptr(), flow_dir.as_ptr(), streams.len(), 2, 3, -1)
        };
        assert_eq!(out, vec![1, 1, 0, 1, 2, 0]);
    }

    #[test]
    fn test_stream_order_wasm_custom_nodata_dir() {
        // nodata_dir is part of the ABI, not hardwired: with 7 as the
        // sentinel the NE-pointing middle cell is a pit, so nothing is
        // promoted past order 1.
        let streams: Vec<i8> = vec![1, 1, 1];
        let flow_dir: Vec<i8> = vec![0, 7, -1];
        let out = unsafe {
            stream_order_wasm(streams.as_ptr(), flow_dir.as_ptr(), streams.len(), 1, 3, 7)
        };
        assert_eq!(out, vec![1, 1, 1]);
    }

    #[test]
    fn test_stream_order_wasm_shape_mismatch_yields_zero_grid() {
        // A len that fits no shape falls back to a zero-filled grid rather
        // than panicking inside WASM, matching the other raw-pointer exports.
        let streams: Vec<i8> = vec![1, 1, 1];
        let flow_dir: Vec<i8> = vec![0, 0, 0];
        let out = unsafe { stream_order_wasm(streams.as_ptr(), flow_dir.as_ptr(), 3, 2, 2, -1) };
        assert_eq!(out, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_viewshed_wasm_abi() {
        // Flat 2x2 with a 1.75 m eye. The ray count is min(720, grid diagonal)
        // = 3 here (0°, 120°, 240°), so only the east ray lands in the grid and
        // reaches (0,1): the output is [1, 1, 0, 0], and it is 0/1 bytes rather
        // than bools.
        let dem: Vec<f32> = vec![100.0, 100.0, 100.0, 100.0];
        let out = unsafe {
            viewshed_wasm(
                dem.as_ptr(),
                dem.len(),
                2,
                2,
                0,
                0,
                1.75,
                1.0,
                -32768.0,
                None,
            )
        };
        assert_eq!(out, vec![1, 1, 0, 0]);
    }
}
