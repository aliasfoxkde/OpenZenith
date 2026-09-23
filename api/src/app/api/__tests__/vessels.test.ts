import { afterEach, describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

interface VesselsBody {
  error?: string;
  configured?: boolean;
  wsUrl?: string | null;
  apiKey?: string;
  messageTypes?: string[];
}

afterEach(() => {
  delete process.env.AISSTREAM_KEY;
});

describe("Vessels API", () => {
  it("returns 200 when AISSTREAM_KEY not set", async () => {
    const { GET } = await import("@/app/api/vessels/route");
    const resp = GET(mockRequest("/api/vessels"));
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as VesselsBody;
    expect(data.error).toContain("not configured");
    expect(data.wsUrl).toBeNull();
  });

  it("returns the stream config when AISSTREAM_KEY is set", async () => {
    process.env.AISSTREAM_KEY = "test-key-123";
    const { GET } = await import("@/app/api/vessels/route");
    const resp = GET(mockRequest("/api/vessels"));
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as VesselsBody;
    expect(data.configured).toBe(true);
    expect(data.wsUrl).toBe("wss://stream.aisstream.io/v0/stream");
    expect(data.apiKey).toBe("test-key-123");
    expect(data.messageTypes).toContain("PositionReport");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("handles OPTIONS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/vessels/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
  });
});
