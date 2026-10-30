import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware for rate limiting and CORS headers.
 *
 * Rate limiting: Simple sliding window per IP using in-memory Map.
 * On Cloudflare Pages/Workers, each request may hit a different isolate,
 * so this provides best-effort per-instance limiting. For production
 * rate limiting, use Cloudflare Rate Limiting rules.
 *
 * CORS: Adds Access-Control headers to all API responses.
 */

// In-memory rate limit store (per isolate)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // requests per window (generous for data-heavy app)
let nextRateLimitCleanupAt = 0;

function cleanupExpiredRateLimits(now: number): void {
  if (now < nextRateLimitCleanupAt) return;

  nextRateLimitCleanupAt = now + RATE_LIMIT_WINDOW;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/**
 * Edge middleware that applies per-IP rate limiting and CORS headers to API requests.
 *
 * The middleware only runs for `/api/*` paths (see the `config` matcher below).
 * Anything that is not an API route, and `/api/health` in particular, is
 * returned untouched and is never rate limited.
 *
 * CORS: `Access-Control-Allow-Origin` is echoed back only when the request's
 * `Origin` is listed in the comma-separated `ALLOWED_ORIGINS` environment
 * variable, or when that variable is unset, in which case `*` is allowed.
 * `Access-Control-Allow-Methods` (GET, HEAD, OPTIONS),
 * `Access-Control-Allow-Headers` (Content-Type, Range) and an
 * `Access-Control-Max-Age` of 86400 seconds are always set. An `OPTIONS`
 * preflight is answered with 204 and an empty body.
 *
 * Rate limiting: a sliding 60 second window per client IP allows 120 requests.
 * The client IP is taken from `CF-Connecting-IP`, then the first entry of
 * `X-Forwarded-For`, then the literal `"unknown"`. Over the limit the request
 * is answered with 429, a JSON `{ error }` body and a `Retry-After: 60` header.
 * The counter lives in an in-memory Map, so on Cloudflare each isolate keeps
 * its own counters and the limit is best-effort per instance.
 *
 * Tile endpoints (`/api/dem-tile/`, `/api/tile/`, `/api/gebco-tile/`,
 * `/api/elevation-accuracy/`, `/api/elevation-color/`, `/api/floods-tile/`
 * and `/api/contours/`) are exempt from rate limiting, because a single map
 * view bursts dozens of immutable, CDN-cached tile requests.
 *
 * @param request - The incoming Next.js request; its URL path, method, headers
 *   and `Origin` drive the CORS, preflight and rate-limit decisions.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Skip health check (never rate limited)
  if (pathname === "/api/health") return NextResponse.next();

  // CORS headers — restrict to known origins in production
  const allowedOrigins = process.env["ALLOWED_ORIGINS"]?.split(",") || ["*"];
  const origin = request.headers.get("origin");
  const response = NextResponse.next();
  if (allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin))) {
    response.headers.set("Access-Control-Allow-Origin", origin || "*");
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Range");
  response.headers.set("Access-Control-Max-Age", "86400");

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  // Rate limiting (skip for tile endpoints — map views burst dozens of these
  // per load, they are immutable and CDN-cached, and Cloudflare's own rate
  // limiting rules are the right place to throttle abuse)
  if (/^\/api\/(dem-tile|tile|gebco-tile|elevation-accuracy|elevation-color|floods-tile|contours)\//.test(pathname)) {
    return response;
  }

  // Sweep at most once per rate-limit window, and only on requests that are
  // actually rate limited. CDN-cached tile traffic bypasses this work too.
  cleanupExpiredRateLimits(Date.now());

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  if (isRateLimited(ip)) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
        ...Object.fromEntries(response.headers),
      },
    });
  }

  return response;
}

/**
 * Next.js middleware matcher restricting this middleware to every `/api/*` path.
 *
 * The `*` wildcard matches nested segments, so all API routes (including
 * dynamic ones such as `/api/dem-tile/10/163/395`) are covered.
 */
export const config = {
  matcher: ["/api/:path*"],
};
