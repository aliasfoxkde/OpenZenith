/* tslint:disable */
/* eslint-disable */

/**
 * D8 flow direction (WASM) — returns a `Uint8Array` of direction values
 * (0-7, or 255 for nodata).
 *
 * # Safety
 * `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
 * and stay valid for the duration of the call.
 */
export function d8_flow_direction_wasm(dem_ptr: number, len: number, rows: number, cols: number, nodata: number): Uint8Array;

/**
 * OZT2 decode: decompress and reconstruct a full OZT2 tile.
 *
 * Header codes follow the production convention (`openzenith/tile_format_v2.py`,
 * `api/src/lib/ozt2_decode.ts`): predictor 0=none/1=left/2=gradient,
 * compressor 0=brotli/1=zstd/2=zlib/3=none.
 *
 * # Arguments
 * * `tile_bytes` – `Uint8Array` of OZT2 binary data (6-byte header followed
 *   by the compressed residual stream)
 * * `decompress_fn` – JS function called to decompress:
 *   `(bytes: Uint8Array, compressor: number) -> Uint8Array`. The second
 *   argument is the header's compressor code, so one JS dispatcher can route
 *   brotli/zstd/zlib; it is not called for compressor code 3 (none).
 *
 * # Returns
 * A JS object `{ elevations: Uint16Array, metadata: Object }`, where
 * `metadata` carries `min_elevation`, `elevation_range`, `max_elevation`,
 * `bits_per_pixel`, `predictor`, `compressor`, `width` and `height`.
 *
 * # Errors
 * Throws a JS exception (never panics) when the tile is shorter than the
 * 6-byte header, when the predictor or compressor code is not part of the
 * production convention, when the JS decompressor rejects the payload, or
 * when the decoded pixel count matches no known tile shape.
 */
export function decode_ozt2(tile_bytes: Uint8Array, decompress_fn: Function): any;

/**
 * Flow accumulation (WASM) — returns a `Uint32Array` of upstream counts.
 *
 * # Safety
 * `flow_dir_ptr` must point to `len` readable `i8` elements in WASM linear
 * memory and stay valid for the duration of the call.
 */
export function flow_accumulation_wasm(flow_dir_ptr: number, len: number, rows: number, cols: number, nodata_dir: number): Uint32Array;

/**
 * Gradient prediction (encode direction) — compute residuals from elevation grid (WASM).
 *
 * # Returns
 * A `Uint16Array` of int16 residuals (as unsigned for WASM compatibility).
 *
 * # Safety
 * `elevation_ptr` must point to `len` readable `f32` elements in WASM linear
 * memory and stay valid for the duration of the call.
 */
export function gradient_predict_wasm(elevation_ptr: number, len: number, rows: number, cols: number, nodata: number): Int16Array;

/**
 * Reconstruct elevation from OZT2 gradient residuals (WASM).
 *
 * # Arguments
 * * `residuals_ptr` – pointer to int16 residuals data
 * * `len` – number of elements
 * * `height` – tile height
 * * `width` – tile width
 * * `nodata` – nodata value (typically -32768)
 * * `dequant_min` – minimum dequantization value
 * * `dequant_scale` – dequantization scale
 *
 * # Returns
 * A `Uint16Array` of reconstructed elevations in whole metres, clamped to
 * `0..=65535`.
 *
 * # Safety
 * `residuals_ptr` must point to `len` readable `i16` elements in WASM linear
 * memory (as produced by the JS glue's `__wbindgen_malloc` + typed-array
 * copy) and must stay valid for the duration of the call.
 */
export function gradient_reconstruct_wasm(residuals_ptr: number, len: number, height: number, width: number, nodata: number, dequant_min: number, dequant_scale: number): Uint16Array;

/**
 * Left-predict reconstruction (WASM).
 *
 * # Safety
 * Same contract as [`gradient_reconstruct_wasm`]: `residuals_ptr` must point
 * to `len` readable `i16` elements and stay valid for the call.
 */
export function left_reconstruct_wasm(residuals_ptr: number, len: number, height: number, width: number, nodata: number, dequant_min: number, dequant_scale: number): Uint16Array;

/**
 * Stream order (Strahler) (WASM) — returns a `Uint8Array` of orders.
 *
 * Mirrors the CLI's `stream-order` contract exactly: `streams` holds
 * 1 for a stream cell and 0 otherwise, `flow_dir` holds D8 compass indices
 * with `nodata_dir` marking "no flow" (-1 for `d8_flow_direction` output),
 * and the result carries the Strahler order per cell — 0 = non-stream,
 * 1 = headwater, n = order n. Unlike the D8 export there is no two's
 * -complement remapping here: orders are already unsigned.
 *
 * # Safety
 * `streams_ptr` and `flow_dir_ptr` must each point to `len` readable `i8`
 * elements in WASM linear memory and stay valid for the duration of the call.
 */
export function stream_order_wasm(streams_ptr: number, flow_dir_ptr: number, len: number, rows: number, cols: number, nodata_dir: number): Uint8Array;

/**
 * Viewshed (WASM) — returns a `Uint8Array` of visibility (0/1).
 *
 * # Safety
 * `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
 * and stay valid for the duration of the call.
 */
export function viewshed_wasm(dem_ptr: number, len: number, rows: number, cols: number, observer_row: number, observer_col: number, observer_height: number, cell_size: number, nodata: number, max_distance_cells?: number | null): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly d8_flow_direction_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly decode_ozt2: (a: number, b: number, c: any) => any;
    readonly flow_accumulation_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly gradient_predict_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly gradient_reconstruct_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly left_reconstruct_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly stream_order_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly viewshed_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
