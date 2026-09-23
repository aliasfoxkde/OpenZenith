/**
 * Tests for src/lib/storage/r2-binding.ts — the single place the DEM_TILES
 * binding is resolved. The @cloudflare/next-on-pages module is replaced with
 * a controllable fake so both the bound and unbound request-context paths are
 * exercised (the global alias stub can only throw).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctxState = vi.hoisted(() => {
  // Annotation (not an assertion) so `env` widens from undefined to the
  // request-context env shape the tests assign in each case.
  const state: { shouldThrow: boolean; env: Record<string, unknown> | undefined } = {
    shouldThrow: false,
    env: undefined,
  };
  return state;
});

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: () => {
    if (ctxState.shouldThrow) {
      throw new Error("unavailable outside a Cloudflare Pages request context");
    }
    return { env: ctxState.env };
  },
}));

import {
  getR2Bucket,
  setR2BucketProvider,
  type R2BucketLike,
} from "@/lib/storage/r2-binding";

function fakeBucket(): R2BucketLike {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("r2-binding", () => {
  beforeEach(() => {
    ctxState.shouldThrow = false;
    ctxState.env = undefined;
    setR2BucketProvider(null);
  });

  afterEach(() => {
    setR2BucketProvider(null);
  });

  it("returns the injected provider's bucket", () => {
    const bucket = fakeBucket();
    setR2BucketProvider(() => bucket);
    expect(getR2Bucket()).toBe(bucket);
  });

  it("restores request-context resolution when the provider is cleared", () => {
    const bound = fakeBucket();
    ctxState.env = { DEM_TILES: bound };

    setR2BucketProvider(() => fakeBucket());
    setR2BucketProvider(null);
    expect(getR2Bucket()).toBe(bound);
  });

  it("resolves DEM_TILES structurally from the request context env", () => {
    const bound = fakeBucket();
    ctxState.env = { DEM_TILES: bound };
    expect(getR2Bucket()).toBe(bound);
  });

  it("returns null when the env has no DEM_TILES binding", () => {
    ctxState.env = { SOMETHING_ELSE: {} };
    expect(getR2Bucket()).toBeNull();
  });

  it("returns null when env is undefined", () => {
    ctxState.env = undefined;
    expect(getR2Bucket()).toBeNull();
  });

  it("returns null when the request context itself is unavailable", () => {
    ctxState.shouldThrow = true;
    expect(getR2Bucket()).toBeNull();
  });

  it("returns null when the injected provider throws", () => {
    setR2BucketProvider(() => {
      throw new Error("provider exploded");
    });
    expect(getR2Bucket()).toBeNull();
  });
});
