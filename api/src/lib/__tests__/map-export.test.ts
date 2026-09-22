import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportMapScreenshot } from "../map-export";

interface FakeLink {
  download: string;
  href: string;
  click: ReturnType<typeof vi.fn>;
}

const createdLinks: FakeLink[] = [];

/** Minimal canvas stand-in: exportMapScreenshot only calls toDataURL(). */
function fakeCanvas(): HTMLCanvasElement {
  return {
    toDataURL: (type?: string) => `data:${type ?? "image/png"};base64,AAAA`,
  } as unknown as HTMLCanvasElement;
}

// Mock DOM for map-export tests
beforeEach(() => {
  createdLinks.length = 0;
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "a") {
        const link: FakeLink = { download: "", href: "", click: vi.fn() };
        createdLinks.push(link);
        return link;
      }
      return {};
    },
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T13:45:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("exportMapScreenshot", () => {
  it("returns early when getCanvas is undefined", () => {
    const map: { getCanvas?: () => HTMLCanvasElement } = {};
    // void return — assert the observable effect instead of the return value
    exportMapScreenshot(map);
    expect(createdLinks).toHaveLength(0);
  });

  it("returns early when canvas is null", () => {
    exportMapScreenshot({ getCanvas: () => null as unknown as HTMLCanvasElement });
    expect(createdLinks).toHaveLength(0);
  });

  it("downloads a png named after the map and today's date", () => {
    exportMapScreenshot({ getCanvas: () => fakeCanvas() }, "expedition");

    expect(createdLinks).toHaveLength(1);
    expect(createdLinks[0]?.download).toBe("expedition-2026-09-22.png");
    expect(createdLinks[0]?.href).toBe("data:image/png;base64,AAAA");
    expect(createdLinks[0]?.click).toHaveBeenCalledTimes(1);
  });

  it("encodes the canvas as png", () => {
    const canvas = fakeCanvas();
    const toDataURL = vi.spyOn(canvas, "toDataURL");

    exportMapScreenshot({ getCanvas: () => canvas });

    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(createdLinks[0]?.href).toContain("image/png");
  });

  it("falls back to the openzenith-map filename", () => {
    exportMapScreenshot({ getCanvas: () => fakeCanvas() });

    expect(createdLinks[0]?.download).toBe("openzenith-map-2026-09-22.png");
  });

  it("appends the date to arbitrary filenames including dashes", () => {
    exportMapScreenshot({ getCanvas: () => fakeCanvas() }, "survey-grid-2024");

    expect(createdLinks[0]?.download).toBe("survey-grid-2024-2026-09-22.png");
  });
});
