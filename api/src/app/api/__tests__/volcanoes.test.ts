import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The volcanoes layer previously fetched volcano.si.edu directly from the
 * browser — the upstream sends no Access-Control-Allow-Origin, so every
 * client-side fetch was CORS-blocked and the layer could never load. These
 * pin the proxy contract: same URL upstream, XML content type, and the
 * codebase's silent-200-with-empty-body convention for upstream failures.
 */

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss">
  <channel>
    <item>
      <title>Kilauea, Hawaii — Erupting</title>
      <georss:point>19.421 -155.287</georss:point>
    </item>
  </channel>
</rss>`;

let capturedUpstream = "";

/** Fetch the route once with `upstream` standing in for the GVP RSS call. */
async function withUpstream(upstream: () => Promise<Response>): Promise<Response> {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce((input: RequestInfo | URL) => {
    capturedUpstream = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return upstream();
  });
  const { GET } = await import("@/app/api/volcanoes/route");
  return GET();
}

describe("Volcanoes proxy endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    capturedUpstream = "";
  });

  it("proxies the Smithsonian GVP weekly RSS with XML + CORS headers", async () => {
    const resp = await withUpstream(() => Promise.resolve(new Response(RSS_SAMPLE, { status: 200 })));
    expect(capturedUpstream).toBe("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/xml");
    expect(resp.headers.get("Access-Control-Allow-Origin")).not.toBeNull();
    expect(await resp.text()).toContain("<georss:point>");
  });

  it("returns a silent 200 with an empty body when the upstream is unavailable", async () => {
    const resp = await withUpstream(() => Promise.resolve(new Response("", { status: 503 })));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/xml");
    expect(await resp.text()).toBe("");
  });

  it("returns a silent 200 when the upstream request throws", async () => {
    const resp = await withUpstream(() => Promise.reject(new Error("boom")));
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("");
  });

  it("answers CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/volcanoes/route");
    const resp = OPTIONS();
    expect(resp.headers.get("Access-Control-Allow-Origin")).not.toBeNull();
  });
});
