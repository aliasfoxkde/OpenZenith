import { describe, it, expect } from "vitest";
import { Decompressor } from "../polyfills/no-zstd";

describe("no-zstd Decompressor", () => {
  it("init resolves with the same instance (chainable)", async () => {
    const d = new Decompressor();
    await expect(d.init()).resolves.toBe(d);
  });

  it("decompress always throws — ZSTD is unavailable in browser context", () => {
    const d = new Decompressor();
    expect(() => d.decompress(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).toThrow(
      "ZSTD not available in browser context",
    );
    expect(() => d.decompress(new Uint8Array(0))).toThrow("ZSTD not available in browser context");
  });

  it("stream throws synchronously with the same message", () => {
    const d = new Decompressor();
    expect(() => d.stream(new Uint8Array([1, 2, 3]))).toThrow("ZSTD not available in browser context");
    expect(() => d.stream(new Uint8Array(0))).toThrow("ZSTD not available in browser context");
  });

  it("decompress and stream reject every call, not just the first", () => {
    const d = new Decompressor();
    expect(() => d.decompress(new Uint8Array(1))).toThrow();
    expect(() => d.decompress(new Uint8Array(1))).toThrow();
    expect(() => d.stream(new Uint8Array(1))).toThrow();
    expect(() => d.stream(new Uint8Array(1))).toThrow();
  });

  it("each instance fails independently", async () => {
    const a = new Decompressor();
    const b = new Decompressor();
    await expect(b.init()).resolves.toBe(b);
    expect(() => a.decompress(new Uint8Array(1))).toThrow(/ZSTD/);
    expect(() => b.decompress(new Uint8Array(1))).toThrow(/ZSTD/);
  });
});
