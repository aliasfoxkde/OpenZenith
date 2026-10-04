/**
 * Contract tests for the OpenZenith MCP server.
 *
 * The real server is exercised end-to-end over an in-memory transport pair:
 * tools are listed and called exactly as a client would, with global fetch
 * mocked so the assertions pin the wire contract — endpoint paths and query
 * parameters must match what the OpenZenith API actually accepts (see
 * api/src/app/api/<route>/route.ts and the generated OpenAPI spec).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { server, clearCache } from "./index.js";

const BASE = "https://openzenith.pages.dev/api";

async function connectClient(): Promise<Client> {
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Extract the URL the mocked fetch saw, failing loudly if it was not called. */
function calledUrl(fetchMock: Mock<typeof fetch>): string {
  expect(fetchMock).toHaveBeenCalled();
  const input = fetchMock.mock.calls[0]?.[0];
  if (typeof input !== "string") {
    throw new Error("expected fetch to have been called with a URL string");
  }
  return input;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("openzenith mcp server", () => {
  let client: Client;
  let fetchMock: Mock<typeof fetch>;

  beforeEach(async () => {
    clearCache();
    client = await connectClient();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await client.close();
  });

  it("exposes the shipped tool set", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "api_docs",
        "bathymetry",
        "elevation",
        "geocode",
        "query",
        "reverse_geocode",
        "tides",
        "weather",
      ].sort(),
    );
  });

  it("query calls /query with the declared include values", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 10 }));
    await client.callTool({ name: "query", arguments: { lat: 40.7, lon: -74.0 } });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/query`);
    expect(url.searchParams.get("lat")).toBe("40.7");
    expect(url.searchParams.get("lon")).toBe("-74");
    expect(url.searchParams.get("include")).toBe("elevation");
  });

  it("elevation sends only lat/lon — no dead dataset parameter", async () => {
    // The API reads just lat and lon; the removed `dataset` parameter must
    // stay gone so the tool contract matches the server contract.
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 8848 }));
    await client.callTool({ name: "elevation", arguments: { lat: 27.9, lon: 86.9 } });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/elevation`);
    expect([...url.searchParams.keys()].sort()).toEqual(["lat", "lon"]);
  });

  it("geocode sends query and limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await client.callTool({
      name: "geocode",
      arguments: { query: "Lhotse", limit: 2 },
    });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/geocode`);
    expect(url.searchParams.get("query")).toBe("Lhotse");
    expect(url.searchParams.get("limit")).toBe("2");
  });

  it("reverse_geocode sends lat/lon/zoom", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ display_name: "x" }));
    await client.callTool({
      name: "reverse_geocode",
      arguments: { lat: 40.7, lon: -74.0, zoom: 14 },
    });

    const url = new URL(calledUrl(fetchMock));
    expect(url.origin + url.pathname).toBe(`${BASE}/reverse-geocode`);
    expect(url.searchParams.get("zoom")).toBe("14");
  });

  it("caches repeated identical queries within the TTL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ elevation: 10 }));
    await client.callTool({ name: "elevation", arguments: { lat: 1, lon: 2 } });
    await client.callTool({ name: "elevation", arguments: { lat: 1, lon: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different location is a different cache key.
    await client.callTool({ name: "elevation", arguments: { lat: 3, lon: 4 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces API failures as tool errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const result = await client.callTool({
      name: "elevation",
      arguments: { lat: 1, lon: 2 },
    });
    expect(result.isError).toBe(true);
  });

  it("api_docs passes the markdown through as text", async () => {
    // Exact-equality on a body with a tail marker: the pre-fix behavior
    // (JSON.parsing a text/markdown response) surfaced a SyntaxError whose
    // message embeds only a truncated body prefix, so a toContain() on the
    // head of the body passed even while the tool was broken in production.
    const body = "# OpenZenith API\n\nREGRESSION-TAIL-9f2e7c";
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    // Client#callTool's result type unions the backwards-compatibility variant,
    // which degrades `content` to `unknown`. Re-validate against the SDK's own
    // schema to recover the typed shape instead of asserting it.
    const result = CallToolResultSchema.parse(await client.callTool({ name: "api_docs", arguments: {} }));
    const block = result.content[0];
    if (!block || block.type !== "text") {
      throw new Error(`expected a text content block, saw ${JSON.stringify(block)}`);
    }
    expect(block.text).toBe(body);
  });
});
