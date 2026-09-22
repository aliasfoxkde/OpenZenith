/**
 * Tests for src/lib/diagnostics.ts — shared layer-failure logging.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { warnLayerError, domEventCause } from "@/lib/diagnostics";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warnLayerError", () => {
  it("logs Error messages with the layer id and default scope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnLayerError("wildfires", new Error("boom"));
    expect(warn).toHaveBeenCalledWith("[layer:wildfires] fetch failed: boom");
  });

  it("coerces non-Error throwables to strings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnLayerError("vessels", "websocket closed", "websocket");
    expect(warn).toHaveBeenCalledWith("[layer:vessels] websocket failed: websocket closed");
  });

  it("handles thrown non-Error objects with a custom scope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnLayerError("elevation", { code: 429 }, "batch fetch");
    expect(warn).toHaveBeenCalledWith("[layer:elevation] batch fetch failed: [object Object]");
  });
});

describe("domEventCause", () => {
  it("prefers the ErrorEvent's underlying error", () => {
    const cause = new Error("tls handshake failed");
    const ev = { error: cause, message: "websocket error" } as unknown as ErrorEvent;
    expect(domEventCause(ev)).toBe(cause);
  });

  it("falls back to the event message, then the event itself", () => {
    const messageOnly = { message: "connection refused" } as unknown as ErrorEvent;
    expect(domEventCause(messageOnly)).toBe("connection refused");
    const plain = new Event("error");
    expect(domEventCause(plain)).toBe(plain);
  });
});
