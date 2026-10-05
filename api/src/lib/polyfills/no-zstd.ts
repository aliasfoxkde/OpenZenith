// No-op ZSTD decompressor for browser context where WASM is unavailable
// The elevation API (edge runtime) uses the async decoder which will fall back gracefully

/**
 * Browser stand-in for the zstd `Decompressor` API when the WASM build cannot
 * load. `init()` resolves immediately so construction never awaits; both
 * `decompress` and `stream` throw, so a caller that actually needs bytes fails
 * fast rather than decoding garbage. The elevation API's async decoder catches
 * this and falls back to its own decoder.
 */
export class Decompressor {
  init(): Promise<this> {
    return Promise.resolve(this);
  }
  decompress(_data: Uint8Array): Uint8Array {
    throw new Error("ZSTD not available in browser context");
  }
  // Declared `never`: this throws synchronously — it does not return a
  // generator, so callers relying on lazy iteration would otherwise swallow
  // the error until first pull.
  stream(_data: Uint8Array): never {
    throw new Error("ZSTD not available in browser context");
  }
}
