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
  return Object.assign(req, overrides);
}

/**
 * Read a route response body as the shape the suite asserts on. Raw
 * `resp.json()` types the body as `any`, which poisons every later member
 * access with no-unsafe-* lint warnings — each test file declares its own
 * body interface and passes it here instead.
 *
 * Usage:
 *   const data = await bodyAs<CollectionBody>(resp);
 */
export async function bodyAs<T>(resp: Response): Promise<T> {
  return (await resp.json()) as T;
}
