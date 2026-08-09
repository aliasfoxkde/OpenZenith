/* tslint:disable */
/* eslint-disable */

/**
 * D8 flow direction (WASM) — returns a Uint8Array of direction values (0-7 or 255 for nodata).
 */
export function d8_flow_direction_wasm(dem_ptr: number, len: number, rows: number, cols: number, nodata: number): Uint8Array;

/**
 * OZT2 decode: decompress and reconstruct a full OZT2 tile.
 *
 * # Arguments
 * * `tile_bytes` – Uint8Array of OZT2 binary data
 * * `decompress_fn` – JS function to call for decompression: `(bytes: Uint8Array, decompressor: str) -> Uint8Array`
 *
 * Returns a JS object: { elevations: Uint16Array, metadata: JsValue }
 */
export function decode_ozt2(tile_bytes: Uint8Array, decompress_fn: Function): any;

/**
 * Flow accumulation (WASM) — returns a Uint32Array of upstream counts.
 */
export function flow_accumulation_wasm(flow_dir_ptr: number, len: number, rows: number, cols: number, nodata_dir: number): Uint32Array;

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
 * Returns a Uint16Array of reconstructed elevations.
 */
export function gradient_reconstruct_wasm(residuals_ptr: number, len: number, height: number, width: number, nodata: number, dequant_min: number, dequant_scale: number): Uint16Array;

/**
 * Left-predict reconstruction (WASM).
 */
export function left_reconstruct_wasm(residuals_ptr: number, len: number, height: number, width: number, nodata: number, dequant_min: number, dequant_scale: number): Uint16Array;

/**
 * Viewshed (WASM) — returns a Uint8Array of visibility (0/1).
 */
export function viewshed_wasm(dem_ptr: number, len: number, rows: number, cols: number, observer_row: number, observer_col: number, observer_height: number, cell_size: number, nodata: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly d8_flow_direction_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly decode_ozt2: (a: number, b: number, c: any) => any;
    readonly flow_accumulation_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly gradient_reconstruct_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly left_reconstruct_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly viewshed_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
