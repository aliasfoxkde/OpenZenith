// No-op ZSTD decompressor for browser context where WASM is unavailable
// The elevation API (edge runtime) uses the async decoder which will fall back gracefully

export class Decompressor {
  async init(): Promise<this> {
    return this;
  }
  decompress(_data: Uint8Array): Uint8Array {
    throw new Error("ZSTD not available in browser context");
  }
  stream(_data: Uint8Array): Generator<Uint8Array, void, unknown> {
    throw new Error("ZSTD not available in browser context");
  }
}
