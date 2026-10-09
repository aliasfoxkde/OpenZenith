import { NextRequest } from "next/server";
import { vi, type Mock } from "vitest";

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

/** Extract the URL from whatever `fetch` was handed. */
export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export interface FetchRoute {
  /** Substring matched against the request URL. */
  match: string;
  /** Build the response for a matching request. */
  respond: () => Response;
}

/**
 * Stub `fetch` with a route table. The first route whose `match` is a
 * substring of the request URL answers the call; anything else throws so
 * a test fails loudly instead of silently hitting the network.
 *
 * Unstub with `vi.unstubAllGlobals()` (typically in `afterEach`).
 */
export function stubFetchRoutes(routes: FetchRoute[]): Mock {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve().then(() => {
      const url = requestUrl(input);
      const hit = routes.find((r) => url.includes(r.match));
      if (!hit) throw new Error(`unexpected fetch: ${url}`);
      return hit.respond();
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * One-shot fetch stub that hands the recorded request to `onCaptured` and
 * answers with a JSON body (default `{}`).
 */
export function stubFetchRecording(
  onCaptured: (url: string, init: RequestInit | undefined) => void,
  body = "{}",
): void {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce((input: RequestInfo | URL, init?: RequestInit) => {
    onCaptured(requestUrl(input), init);
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}
