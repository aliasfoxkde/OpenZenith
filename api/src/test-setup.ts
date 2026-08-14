/**
 * Global test setup — mock R2 storage modules for all API tests.
 *
 * R2 modules use environment bindings (process.env.DEM_TILES) that
 * aren't available in vitest's Node.js environment. Mocking them
 * globally avoids repeating mocks in every test file.
 */
import { vi } from "vitest";

vi.mock("@/lib/storage/r2-tile-cache", () => ({
  r2GetTile: vi.fn().mockResolvedValue(null),
  r2PutTile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage/r2-json-cache", () => ({
  r2GetJson: vi.fn().mockResolvedValue(null),
  r2PutJson: vi.fn().mockResolvedValue(undefined),
  apiCacheKey: vi.fn((...args: string[]) => args.join(":")),
}));

vi.mock("@/lib/storage/cache", () => ({
  staleWhileRevalidate: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object") as RequestInit[]));
  }),
}));

vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object") as RequestInit[]));
  }),
  staleWhileRevalidate: vi.fn(async (url: string, ...args: unknown[]) => {
    return fetch(url, ...(args.filter((a): a is RequestInit => typeof a === "object") as RequestInit[]));
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
