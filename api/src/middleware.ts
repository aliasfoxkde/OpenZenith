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

export function middleware(request: NextRequest) {
  // Lazy cleanup of expired rate limit entries (runs inline, no timers)
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }

  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Skip health check (never rate limited)
  if (pathname === "/api/health") return NextResponse.next();

  // CORS headers
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", "*");
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

  // Rate limiting (skip for static tile endpoints)
  if (
    pathname.startsWith("/api/dem-tile/") ||
    pathname.startsWith("/api/tile/") ||
    pathname.startsWith("/api/gebco-tile/")
  ) {
    return response;
  }

  const ip = request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  if (isRateLimited(ip)) {
    return new NextResponse(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
          ...Object.fromEntries(response.headers),
        },
      },
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
