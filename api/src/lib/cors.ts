/** Standard CORS headers for all API responses. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // POST is listed because seven routes export POST handlers
  // (elevation/batch, overpass, profile, streams, trace, twi, watershed) and
  // Allow-Methods is a permission grant, not an enumeration of this route.
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Return a CORS preflight response. */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Return a JSON error response with CORS headers. */
export function corsError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: CORS_HEADERS });
}
