/**
 * Shared error-response tail for the API routes.
 *
 * Ten routes' catch blocks returned the same body — `{ error: message }` with
 * the CORS headers — via the same three inline lines; this builder is that
 * tail extracted (cycle VI, D3) so the error contract has one definition.
 * The message extraction is verbatim from the routes: Error → .message,
 * anything else → "Unknown error". Routes with a different error-body
 * contract (e.g. /api/elevation's { ok:false, error:{code,...} }) keep their
 * own shaping.
 */

import { NextResponse } from "next/server";
import { CORS_HEADERS } from "./cors";

/** The routes' shared catch tail: `{ error: message }` with the CORS headers. */
export function errorResponse(err: unknown, status = 502): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}
