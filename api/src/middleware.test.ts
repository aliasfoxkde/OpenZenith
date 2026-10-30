import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

function makeRequest(pathname: string, ip = "test-client-default", method = "GET"): NextRequest {
  return {
    nextUrl: new URL(`https://openzenith.pages.dev${pathname}`),
    headers: new Headers({ "cf-connecting-ip": ip }),
    method,
  } as unknown as NextRequest;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("middleware rate-limit cleanup", () => {
  it("does not enumerate the rate-limit map for CDN-cached tile requests", () => {
    middleware(makeRequest("/api/profile", "test-client-a"));
    middleware(makeRequest("/api/profile", "test-client-b"));
    const iteratedMapSizes: number[] = [];
    const originalIterator = Map.prototype[Symbol.iterator];
    vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function <K, V>(this: Map<K, V>) {
      iteratedMapSizes.push(this.size);
      return originalIterator.call(this);
    });

    middleware(makeRequest("/api/tile/3/2/1"));

    expect(iteratedMapSizes.some((size) => size >= 2)).toBe(false);
  });

  it("sweeps expired entries at most once per cleanup interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date());
    middleware(makeRequest("/api/profile", "test-client-c"));
    middleware(makeRequest("/api/profile", "test-client-d"));
    vi.advanceTimersByTime(60_001);
    const iteratedMapSizes: number[] = [];
    const originalIterator = Map.prototype[Symbol.iterator];
    vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function <K, V>(this: Map<K, V>) {
      iteratedMapSizes.push(this.size);
      return originalIterator.call(this);
    });

    middleware(makeRequest("/api/profile", "test-client-e"));
    expect(iteratedMapSizes.some((size) => size >= 2)).toBe(true);

    middleware(makeRequest("/api/profile", "test-client-f"));
    iteratedMapSizes.length = 0;
    middleware(makeRequest("/api/profile", "test-client-g"));

    expect(iteratedMapSizes.some((size) => size >= 2)).toBe(false);
  });

  it("preserves the per-IP request limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date());
    const responses = Array.from({ length: 121 }, () => middleware(makeRequest("/api/profile", "test-client-h")));

    expect(responses.slice(0, 120).every((response) => response.status !== 429)).toBe(true);
    expect(responses[120]?.status).toBe(429);
  });
});
