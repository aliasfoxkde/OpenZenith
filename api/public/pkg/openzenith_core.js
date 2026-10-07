/* @ts-self-types="./openzenith_core.d.ts" */

/**
 * D8 flow direction (WASM) — returns a `Uint8Array` of direction values
 * (0-7, or 255 for nodata).
 *
 * # Safety
 * `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
 * and stay valid for the duration of the call.
 * @param {number} dem_ptr
 * @param {number} len
 * @param {number} rows
 * @param {number} cols
 * @param {number} nodata
 * @returns {Uint8Array}
 */
export function d8_flow_direction_wasm(dem_ptr, len, rows, cols, nodata) {
    const ret = wasm.d8_flow_direction_wasm(dem_ptr, len, rows, cols, nodata);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

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
 * @param {Uint8Array} tile_bytes
 * @param {Function} decompress_fn
 * @returns {any}
 */
export function decode_ozt2(tile_bytes, decompress_fn) {
    const ptr0 = passArray8ToWasm0(tile_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_ozt2(ptr0, len0, decompress_fn);
    return ret;
}

/**
 * Flow accumulation (WASM) — returns a `Uint32Array` of upstream counts.
 *
 * # Safety
 * `flow_dir_ptr` must point to `len` readable `i8` elements in WASM linear
 * memory and stay valid for the duration of the call.
 * @param {number} flow_dir_ptr
 * @param {number} len
 * @param {number} rows
 * @param {number} cols
 * @param {number} nodata_dir
 * @returns {Uint32Array}
 */
export function flow_accumulation_wasm(flow_dir_ptr, len, rows, cols, nodata_dir) {
    const ret = wasm.flow_accumulation_wasm(flow_dir_ptr, len, rows, cols, nodata_dir);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * Gradient prediction (encode direction) — compute residuals from elevation grid (WASM).
 *
 * # Returns
 * A `Uint16Array` of int16 residuals (as unsigned for WASM compatibility).
 *
 * # Safety
 * `elevation_ptr` must point to `len` readable `f32` elements in WASM linear
 * memory and stay valid for the duration of the call.
 * @param {number} elevation_ptr
 * @param {number} len
 * @param {number} rows
 * @param {number} cols
 * @param {number} nodata
 * @returns {Int16Array}
 */
export function gradient_predict_wasm(elevation_ptr, len, rows, cols, nodata) {
    const ret = wasm.gradient_predict_wasm(elevation_ptr, len, rows, cols, nodata);
    var v1 = getArrayI16FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
    return v1;
}

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
 * @param {number} residuals_ptr
 * @param {number} len
 * @param {number} height
 * @param {number} width
 * @param {number} nodata
 * @param {number} dequant_min
 * @param {number} dequant_scale
 * @returns {Uint16Array}
 */
export function gradient_reconstruct_wasm(residuals_ptr, len, height, width, nodata, dequant_min, dequant_scale) {
    const ret = wasm.gradient_reconstruct_wasm(residuals_ptr, len, height, width, nodata, dequant_min, dequant_scale);
    var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
    return v1;
}

/**
 * Left-predict reconstruction (WASM).
 *
 * # Safety
 * Same contract as [`gradient_reconstruct_wasm`]: `residuals_ptr` must point
 * to `len` readable `i16` elements and stay valid for the call.
 * @param {number} residuals_ptr
 * @param {number} len
 * @param {number} height
 * @param {number} width
 * @param {number} nodata
 * @param {number} dequant_min
 * @param {number} dequant_scale
 * @returns {Uint16Array}
 */
export function left_reconstruct_wasm(residuals_ptr, len, height, width, nodata, dequant_min, dequant_scale) {
    const ret = wasm.left_reconstruct_wasm(residuals_ptr, len, height, width, nodata, dequant_min, dequant_scale);
    var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
    return v1;
}

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
 * @param {number} streams_ptr
 * @param {number} flow_dir_ptr
 * @param {number} len
 * @param {number} rows
 * @param {number} cols
 * @param {number} nodata_dir
 * @returns {Uint8Array}
 */
export function stream_order_wasm(streams_ptr, flow_dir_ptr, len, rows, cols, nodata_dir) {
    const ret = wasm.stream_order_wasm(streams_ptr, flow_dir_ptr, len, rows, cols, nodata_dir);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Viewshed (WASM) — returns a `Uint8Array` of visibility (0/1).
 *
 * # Safety
 * `dem_ptr` must point to `len` readable `f32` elements in WASM linear memory
 * and stay valid for the duration of the call.
 * @param {number} dem_ptr
 * @param {number} len
 * @param {number} rows
 * @param {number} cols
 * @param {number} observer_row
 * @param {number} observer_col
 * @param {number} observer_height
 * @param {number} cell_size
 * @param {number} nodata
 * @param {number | null} [max_distance_cells]
 * @returns {Uint8Array}
 */
export function viewshed_wasm(dem_ptr, len, rows, cols, observer_row, observer_col, observer_height, cell_size, nodata, max_distance_cells) {
    const ret = wasm.viewshed_wasm(dem_ptr, len, rows, cols, observer_row, observer_col, observer_height, cell_size, nodata, isLikeNone(max_distance_cells) ? Number.MAX_SAFE_INTEGER : (max_distance_cells) >>> 0);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_rethrow_cb2e88c6b2a16733: function(arg0) {
            throw arg0;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_1875a20c43a36133: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_617a8cdb8bb1130e: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_23f60f47cde8d664: function(arg0, arg1) {
            const ret = new Uint16Array(getArrayU16FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_9a868026ffa4208a: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_145a351398b48c65: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./openzenith_core_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayI16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedInt16ArrayMemory0 = null;
function getInt16ArrayMemory0() {
    if (cachedInt16ArrayMemory0 === null || cachedInt16ArrayMemory0.byteLength === 0) {
        cachedInt16ArrayMemory0 = new Int16Array(wasm.memory.buffer);
    }
    return cachedInt16ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedInt16ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('openzenith_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
