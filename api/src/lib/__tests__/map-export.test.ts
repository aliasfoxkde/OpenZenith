import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DOM for map-export tests
beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "a") {
        return {
          download: "",
          href: "",
          click: vi.fn(),
        };
      }
      return {};
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exportMapScreenshot", () => {
  it("returns early when getCanvas is undefined", async () => {
    const { exportMapScreenshot } = await import("../map-export");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = exportMapScreenshot({} as any);
    expect(result).toBeUndefined();
  });

  it("returns early when canvas is null", async () => {
    const { exportMapScreenshot } = await import("../map-export");
    const result = exportMapScreenshot({ getCanvas: () => null as unknown as HTMLCanvasElement });
    expect(result).toBeUndefined();
  });
});
