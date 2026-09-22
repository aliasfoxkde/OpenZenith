/**
 * Vitest stand-in for `@cloudflare/next-on-pages`.
 *
 * The real module only loads inside a Next.js edge build (it imports
 * "server-only", which throws outside the react-server condition), so unit
 * tests alias it here via vitest's resolve.alias. Storage code under test
 * should inject a fake bucket through setR2BucketProvider() and never rely on
 * this throwing.
 */
export function getRequestContext(): never {
  throw new Error(
    "getRequestContext is unavailable outside a Cloudflare Pages request context",
  );
}
