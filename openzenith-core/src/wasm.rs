//! WASM bindings for openzenith-core OZT2 decoder.
//!
//! Exposes gradient reconstruction and related functions to JavaScript via wasm-bindgen.
//!
//! Build with:
//!   wasm-pack build --target web
//!
//! Usage in JS:
//!   import init, { gradient_reconstruct, decode_ozt2 } from "./pkg/openzenith_core.js";
//!   await init();
//!   const { data, metadata } = decode_ozt2(tile_bytes);

use wasm_bindgen::prelude::*;
use ndarray::Array2;

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
/// Returns a Uint16Array of reconstructed elevations.
#[wasm_bindgen]
pub fn gradient_reconstruct_wasm(
    residuals_ptr: *const i16,
    len: usize,
    height: usize,
    width: usize,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Vec<u16> {
    // Safety: pointer is from Uint16Array/JsArray buffer, caller guarantees validity
    let residuals_slice = unsafe { std::slice::from_raw_parts(residuals_ptr, len) };

    let arr: Array2<i16> = Array2::from_shape_vec((height, width), residuals_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    let reconstructed = super::ozt2::gradient_reconstruct(&arr.view(), nodata, dequant_min, dequant_scale);

    // Convert f32 → u16 (meters, clip to valid range)
    let out: Vec<u16> = reconstructed
        .into_raw_vec_and_offset()
        .0
        .iter()
        .map(|&v| {
            let meters = v.round() as i32;
            meters.clamp(0, 65535) as u16
        })
        .collect();

    out
}

/// Left-predict reconstruction (WASM).
#[wasm_bindgen]
pub fn left_reconstruct_wasm(
    residuals_ptr: *const i16,
    len: usize,
    height: usize,
    width: usize,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
) -> Vec<u16> {
    let residuals_slice = unsafe { std::slice::from_raw_parts(residuals_ptr, len) };

    let arr: Array2<i16> = Array2::from_shape_vec((height, width), residuals_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    let reconstructed = super::ozt2::left_reconstruct(&arr.view(), nodata, dequant_min, dequant_scale);

    let out: Vec<u16> = reconstructed
        .into_raw_vec_and_offset()
        .0
        .iter()
        .map(|&v| {
            let meters = v.round() as i32;
            meters.clamp(0, 65535) as u16
        })
        .collect();

    out
}

/// Gradient prediction (encode direction) — compute residuals from elevation grid (WASM).
///
/// Returns a Uint16Array of int16 residuals (as unsigned for WASM compatibility).
#[wasm_bindgen]
pub fn gradient_predict_wasm(
    elevation_ptr: *const f32,
    len: usize,
    rows: usize,
    cols: usize,
    nodata: f32,
) -> Vec<i16> {
    let elev_slice = unsafe { std::slice::from_raw_parts(elevation_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), elev_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let residuals = super::ozt2::gradient_predict(&arr.view(), nodata);
    residuals.into_raw_vec_and_offset().0
}

/// D8 flow direction (WASM) — returns a Uint8Array of direction values (0-7 or 255 for nodata).
#[wasm_bindgen]
pub fn d8_flow_direction_wasm(
    dem_ptr: *const f32,
    len: usize,
    rows: usize,
    cols: usize,
    nodata: f32,
) -> Vec<u8> {
    let dem_slice = unsafe { std::slice::from_raw_parts(dem_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), dem_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let fd = super::d8::d8_flow_direction(&arr.view(), nodata);
    let (out, _) = fd.into_raw_vec_and_offset();
    out.into_iter().map(|x| x as u8).collect()
}

/// Flow accumulation (WASM) — returns a Uint32Array of upstream counts.
#[wasm_bindgen]
pub fn flow_accumulation_wasm(
    flow_dir_ptr: *const i8,
    len: usize,
    rows: usize,
    cols: usize,
    nodata_dir: i8,
) -> Vec<u32> {
    let fd_slice = unsafe { std::slice::from_raw_parts(flow_dir_ptr, len) };
    let arr = Array2::from_shape_vec((rows, cols), fd_slice.to_vec())
        .unwrap_or_else(|_| Array2::zeros((rows, cols)));

    let accum = super::d8::flow_accumulation(&arr.view(), nodata_dir);
    let (raw, _) = accum.into_raw_vec_and_offset();
    raw.into_iter().map(|x| x as u32).collect()
}

/// Viewshed (WASM) — returns a Uint8Array of visibility (0/1).
#[wasm_bindgen]
pub fn viewshed_wasm(
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

    vis.into_raw_vec_and_offset().0.iter().map(|&b| if b { 1u8 } else { 0u8 }).collect()
}

/// OZT2 decode: decompress and reconstruct a full OZT2 tile.
///
/// # Arguments
/// * `tile_bytes` – Uint8Array of OZT2 binary data
/// * `decompress_fn` – JS function to call for decompression: `(bytes: Uint8Array, decompressor: str) -> Uint8Array`
///
/// Returns a JS object: { elevations: Uint16Array, metadata: JsValue }
#[wasm_bindgen]
pub fn decode_ozt2(tile_bytes: &[u8], decompress_fn: &js_sys::Function) -> JsValue {
    // Parse header (6 bytes)
    if tile_bytes.len() < 6 {
        wasm_bindgen::throw_str("Tile too small: less than 6 bytes");
    }

    let vmin = i16::from_le_bytes([tile_bytes[0], tile_bytes[1]]);
    let elev_range = u16::from_le_bytes([tile_bytes[2], tile_bytes[3]]) as i32;
    let bits = tile_bytes[4];
    let flags = tile_bytes[5];

    let predictor = flags & 0x03;
    let compressor = (flags >> 2) & 0x03;

    // Call JS decompression function
    let decompressor_name = match compressor {
        0 => "none",
        1 => "zlib",
        2 => "zstd",
        3 => "brotli",
        _ => "unknown",
    };

    let compressed = &tile_bytes[6..];

    // Decompress (skip if compressor=0 / "none")
    let decompressed: Vec<u8> = if compressor == 0 {
        // No compression — residuals are stored directly as int16 LE bytes
        compressed.to_vec()
    } else {
        let js_compressed = js_sys::Uint8Array::from(compressed);
        let decompressed_js: js_sys::Uint8Array = decompress_fn
            .call1(&JsValue::NULL, &js_compressed)
            .unwrap()
            .unchecked_into();

        let decompressed_len = decompressed_js.length() as usize;
        let mut d = vec![0u8; decompressed_len];
        decompressed_js.copy_to(&mut d);
        d
    };

    // Residuals are always int16
    let residuals: Vec<i16> = decompressed
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    let total_pixels = residuals.len();

    // Infer tile dimensions
    let side = (total_pixels as f64).sqrt() as usize;
    let (height, width) = if side * side == total_pixels {
        (side, side)
    } else {
        // Try common sizes
        let mut found = false;
        let mut height = side;
        let mut width = side;
        for w in [256, 512, 1024, 3601, 128, 64] {
            if total_pixels % w == 0 {
                height = total_pixels / w;
                width = w;
                found = true;
                break;
            }
        }
        if !found {
            wasm_bindgen::throw_str(&format!(
                "Cannot infer tile dimensions from {} pixels",
                total_pixels
            ));
        }
        (height, width)
    };

    // Reconstruct
    let residuals_arr = Array2::from_shape_vec((height, width), residuals)
        .unwrap_or_else(|_| Array2::zeros((height, width)));

    // Dequantization parameters for reconstruction: use the quantized scale
    // so that reconstruction operates on properly-scaled residuals.
    // For bits < 16, we rescale during reconstruction so values are in final units.
    let (dequant_min, dequant_scale) = if bits < 16 && elev_range > 0.0 {
        let vmin_f = vmin as f32;
        let er_f = elev_range as f32;
        let max_q = ((1i32 << bits) - 1) as f32;
        // Scale so that 1 residual step = dequant_scale metres
        let dequant_scale = er_f / max_q;
        (vmin_f, dequant_scale)
    } else {
        (vmin as f32, 1.0_f32)
    };

    // OZT2 residual nodata is the same as elevation nodata (-32768)
    const RESIDUAL_NODATA: i16 = -32768;

    let reconstructed = if predictor == 0 {
        super::ozt2::gradient_reconstruct(&residuals_arr.view(), RESIDUAL_NODATA, dequant_min, dequant_scale)
    } else {
        super::ozt2::left_reconstruct(&residuals_arr.view(), RESIDUAL_NODATA, dequant_min, dequant_scale)
    };

    // Reconstructed values are already in metres (dequantized during reconstruction).
    // Just clamp to valid elevation range.
    let elevations: Vec<u16> = reconstructed
        .into_raw_vec_and_offset()
        .0
        .iter()
        .map(|&v| {
            let meters = v.round() as i32;
            meters.clamp(0, 65535) as u16
        })
        .collect();

    // Build JS metadata object
    let predictor_name = match predictor {
        0 => "gradient",
        1 => "left",
        _ => "none",
    };

    let metadata = js_sys::Object::new();
    js_sys::Reflect::set(&metadata, &"min_elevation".into(), &(vmin as f64).into()).unwrap();
    js_sys::Reflect::set(&metadata, &"elevation_range".into(), &(elev_range as f64).into()).unwrap();
    js_sys::Reflect::set(&metadata, &"max_elevation".into(), &((vmin + elev_range) as f64).into()).unwrap();
    js_sys::Reflect::set(&metadata, &"bits_per_pixel".into(), &(bits as f64).into()).unwrap();
    js_sys::Reflect::set(&metadata, &"predictor".into(), &predictor_name.into()).unwrap();
    js_sys::Reflect::set(&metadata, &"compressor".into(), &decompressor_name.into()).unwrap();
    js_sys::Reflect::set(&metadata, &"width".into(), &(width as f64).into()).unwrap();
    js_sys::Reflect::set(&metadata, &"height".into(), &(height as f64).into()).unwrap();

    // Return { elevations: Uint16Array, metadata: Object }
    let result = js_sys::Object::new();
    let elev_array = js_sys::Uint16Array::from(&elevations[..]);
    js_sys::Reflect::set(&result, &"elevations".into(), &elev_array.into()).unwrap();
    js_sys::Reflect::set(&result, &"metadata".into(), &metadata.into()).unwrap();

    result.into()
}
