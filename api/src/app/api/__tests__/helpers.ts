import { NextRequest } from "next/server";

/**
 * Create a mock NextRequest for unit testing route handlers.
 *
 * Usage:
 *   const req = mockRequest("/api/health");
 *   const req = mockRequest("/api/elevation?lat=28&lon=86.9");
 *   const req = mockRequest("/api/overpass", "POST", JSON.stringify({ query: "..." }));
 *   const req = mockRequest("/api/gebco-tile/test.tif", "GET", null, { params: Promise.resolve({ name: "test.tif" }) });
 */
export function mockRequest(
  path: string,
  method = "GET",
  body?: string | null,
  overrides: Record<string, unknown> = {},
): NextRequest {
  const url = `http://localhost:8788${path}`;
  const req = new NextRequest(url, { method, body: body ?? undefined });
  return Object.assign(req, overrides) as NextRequest;
}
