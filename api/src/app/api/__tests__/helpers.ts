import { NextRequest } from "next/server";

/**
 * Create a mock NextRequest for unit testing route handlers.
 *
 * Usage:
 *   const req = mockRequest("/api/health");
 *   const req = mockRequest("/api/elevation?lat=28&lon=86.9");
 *   const req = mockRequest("/api/proxy/https://evil.com/data", "GET");
 */
export function mockRequest(
  path: string,
  method = "GET",
  overrides: Record<string, unknown> = {},
): NextRequest {
  const url = `http://localhost:8788${path}`;
  const req = new NextRequest(url, { method });
  return Object.assign(req, overrides) as NextRequest;
}
