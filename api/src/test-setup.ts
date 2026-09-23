/**
 * Global test setup — mock R2 storage modules for all API tests.
 *
 * R2 modules use environment bindings (process.env.DEM_TILES) that
 * aren't available in vitest's Node.js environment. Mocking them
 * globally avoids repeating mocks in every test file.
 */
import { beforeEach, vi } from "vitest";

/**
 * Hermeticity net: unit tests must never touch the network.
 *
 * Route tests stub globalThis.fetch with single-shot mocks
 * (mockResolvedValueOnce). When that queue runs dry, vitest falls back to
 * the implementation the spy wrapped — historically the real fetch — so a
 * missing mock silently became a live upstream request that only showed up
 * as a 5s timeout when the machine was loaded. Re-installing this net
 * before every test makes the fallback loud instead: any non-localhost
 * request through an unstubbed fetch rejects immediately with a message
 * naming the URL and the fix. Tests that stub fetch themselves (spyOn,
 * stubGlobal, or the module mocks above) replace the net wholesale, and a
 * spy whose once-queue exhausts falls back to the net rather than out to
 * the network.
 */
const REAL_FETCH = globalThis.fetch.bind(globalThis);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

async function hermeticFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    // Unparseable target — treat as external and block it.
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `hermeticity: test attempted a live request to ${raw} — stub fetch (mockResolvedValue) in this test`,
    );
  }
  return REAL_FETCH(input, init);
}

beforeEach(() => {
  globalThis.fetch = hermeticFetch;
});

vi.mock("@/lib/storage/r2-tile-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/r2-tile-cache")>();
  return {
    // Keep the real constant: routes derive their cache namespaces from it.
    RENDER_SCHEMA_VERSION: actual.RENDER_SCHEMA_VERSION,
    r2GetTile: vi.fn().mockResolvedValue(null),
    r2PutTile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/storage/r2-json-cache", () => ({
  r2GetJson: vi.fn().mockResolvedValue(null),
  r2PutJson: vi.fn().mockResolvedValue(undefined),
  apiCacheKey: vi.fn((...args: string[]) => args.join(":")),
}));

vi.mock("@/lib/storage/cache", () => ({
  staleWhileRevalidate: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object")));
  }),
}));

vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object")));
  }),
  staleWhileRevalidate: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object")));
  }),
  CACHE_TTL: {
    FLIGHTS: 300,
    MILITARY: 30,
    EARTHQUAKES: 60,
    RADAR: 120,
    WARNINGS: 120,
    VESSELS: 60,
    NLNOG: 3600,
    ELEVATION: 86400,
    BATHYMETRY: 86400,
    WATERWAYS: 3600,
    GEOCODE: 86400,
  },
}));
