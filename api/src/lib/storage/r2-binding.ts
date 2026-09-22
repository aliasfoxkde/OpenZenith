/**
 * Shared, injectable access to the Cloudflare R2 bucket binding.
 *
 * Both R2 cache modules (r2-tile-cache, r2-json-cache) resolve the same
 * DEM_TILES binding. Centralizing it gives them:
 * - one minimal structural type instead of duplicated `R2Bucket = any`
 * - a single place where the binding is resolved from the request context
 * - a provider seam (`setR2BucketProvider`) so tests inject an in-memory
 *   bucket directly instead of hoisted `vi.mock("@cloudflare/next-on-pages")`
 */

import { getRequestContext } from "@cloudflare/next-on-pages";

/** Minimal shape of an object returned by R2 `get` — only what we use. */
export interface R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  readonly customMetadata?: Record<string, string>;
}

/** Minimal structural type for the R2 bucket surface these modules use. */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
        cacheExpiry?: Date;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

function fromRequestContext(): R2BucketLike | null {
  try {
    // Read the binding structurally: the generated CloudflareEnv type does not
    // carry DEM_TILES in every tsconfig context.
    const env = getRequestContext().env as unknown as { DEM_TILES?: R2BucketLike } | undefined;
    return env?.DEM_TILES ?? null;
  } catch {
    // Not running in a CF Pages request context (local dev)
    return null;
  }
}

let provider: () => R2BucketLike | null = fromRequestContext;

/**
 * Override how the R2 bucket is resolved. Tests pass `() => fakeBucket`;
 * pass `null` to restore the default request-context resolution.
 */
export function setR2BucketProvider(next: (() => R2BucketLike | null) | null): void {
  provider = next ?? fromRequestContext;
}

/**
 * Resolve the R2 bucket binding, or null when unavailable (local dev /
 * outside a request context). Never throws.
 */
export function getR2Bucket(): R2BucketLike | null {
  try {
    return provider();
  } catch {
    // Not running in a CF Pages request context (local dev, unit tests)
    return null;
  }
}
