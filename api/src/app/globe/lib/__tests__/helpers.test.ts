import { describe, it, expect } from "vitest";
import { parseHash, buildHash, fmtTime, elevationColor, createRetryGuard } from "../helpers";
import { DEFAULT_LAYERS } from "../constants";

describe("parseHash", () => {
  it("returns empty object for empty hash", () => {
    expect(parseHash("")).toEqual({});
    expect(parseHash("#")).toEqual({});
  });

  it("parses position from path segments", () => {
    const result = parseHash("#2.0/30.0000/-10.0000");
    expect(result.zoom).toBe(2);
    expect(result.center).toEqual([-10, 30]);
  });

  it("parses basemap option", () => {
    const result = parseHash("#2.0/30.0000/-10.0000&bm=dark");
    expect(result.basemap).toBe("dark");
  });

  it("parses theme option", () => {
    const result = parseHash("#2.0/30.0000/-10.0000&theme=classified");
    expect(result.theme).toBe("classified");
  });

  it("parses view mode", () => {
    expect(parseHash("#2/30/-10&view=2d").viewMode).toBe("2d");
    expect(parseHash("#2/30/-10&view=columbus").viewMode).toBe("columbus");
    expect(parseHash("#2/30/-10&view=3d").viewMode).toBe("3d");
  });

  it("parses individual layers", () => {
    const result = parseHash("#2/30/-10&l=earthquakes+flights");
    expect(result.layers?.earthquakes).toBe(true);
    expect(result.layers?.flights).toBe(true);
    expect(result.layers?.satellites).toBe(false);
  });

  it("ignores unknown layer names", () => {
    const result = parseHash("#2/30/-10&l=earthquakes+nonexistent");
    expect(result.layers?.earthquakes).toBe(true);
    expect(result.layers?.nonexistent).toBeUndefined();
  });

  it("returns object with layers on malformed hash", () => {
    const result = parseHash("#invalid");
    expect(result.layers).toBeDefined();
    expect(result.zoom).toBeNaN();
  });
});

describe("buildHash", () => {
  const baseState = {
    center: [-10, 30] as [number, number],
    zoom: 2,
    basemap: "satellite",
    layers: { ...DEFAULT_LAYERS },
    theme: "default",
    viewMode: "3d" as const,
  };

  it("builds basic position hash with default layers", () => {
    const hash = buildHash(baseState);
    expect(hash).toContain("#2.0/30.0000/-10.0000");
    expect(hash).toContain("l="); // Default layers are active
  });

  it("includes non-default basemap", () => {
    const hash = buildHash({ ...baseState, basemap: "dark" });
    expect(hash).toContain("bm=dark");
  });

  it("includes non-default theme", () => {
    const hash = buildHash({ ...baseState, theme: "classified" });
    expect(hash).toContain("theme=classified");
  });

  it("includes active layers", () => {
    const state = { ...baseState, layers: { ...DEFAULT_LAYERS, earthquakes: true } };
    const hash = buildHash(state);
    expect(hash).toContain("l=earthquakes");
  });

  it("round-trips with parseHash", () => {
    const original = {
      center: [12.3456, -45.6789] as [number, number],
      zoom: 5.5,
      basemap: "dark",
      layers: { ...DEFAULT_LAYERS, earthquakes: true, flights: true },
      theme: "crimson",
      viewMode: "2d" as const,
    };
    const hash = buildHash(original);
    const parsed = parseHash(hash);

    expect(parsed.zoom).toBeCloseTo(original.zoom);
    expect(parsed.basemap).toBe(original.basemap);
    expect(parsed.theme).toBe(original.theme);
    expect(parsed.viewMode).toBe(original.viewMode);
    expect(parsed.layers?.earthquakes).toBe(true);
    expect(parsed.layers?.flights).toBe(true);
  });
});

describe("fmtTime", () => {
  it("returns placeholder for null/zero", () => {
    expect(fmtTime(null)).toBe("--:--:--");
    expect(fmtTime(0)).toBe("--:--:--");
  });

  it("formats a valid timestamp", () => {
    // 2024-01-01T12:30:45Z
    const ts = new Date("2024-01-01T12:30:45Z").getTime();
    const result = fmtTime(ts);
    // Format depends on locale, just check it's not placeholder
    expect(result).not.toBe("--:--:--");
  });
});

describe("elevationColor", () => {
  it("returns deep blue for negative elevation (ocean)", () => {
    expect(elevationColor(-100)).toBe("#1a5276");
  });

  it("returns green for low elevation", () => {
    expect(elevationColor(100)).toBe("#1e8449");
  });

  it("returns yellow-green for medium elevation", () => {
    expect(elevationColor(300)).toBe("#27ae60");
  });

  it("returns yellow for moderate elevation", () => {
    expect(elevationColor(700)).toBe("#f4d03f");
  });

  it("returns orange for high elevation", () => {
    expect(elevationColor(1500)).toBe("#e67e22");
  });

  it("returns dark orange for very high elevation", () => {
    expect(elevationColor(3000)).toBe("#d35400");
  });

  it("returns dark red for extreme elevation", () => {
    expect(elevationColor(5000)).toBe("#922b21");
  });
});

describe("createRetryGuard", () => {
  it("allows retrying initially", () => {
    const guard = createRetryGuard();
    expect(guard.shouldRetry).toBe(true);
    expect(guard.failureCount).toBe(0);
  });

  it("stops retrying after max failures", () => {
    const guard = createRetryGuard({ maxFailures: 3, baseDelay: 0 });
    guard.recordFailure();
    guard.recordFailure();
    guard.recordFailure();
    expect(guard.failureCount).toBe(3);
    expect(guard.shouldRetry).toBe(false);
  });

  it("resets on success", () => {
    const guard = createRetryGuard();
    guard.recordFailure();
    guard.recordFailure();
    expect(guard.failureCount).toBe(2);
    guard.recordSuccess();
    expect(guard.failureCount).toBe(0);
    expect(guard.shouldRetry).toBe(true);
  });

  it("uses exponential backoff", () => {
    const guard = createRetryGuard({ maxFailures: 10, baseDelay: 100 });
    guard.recordFailure(); // 1st failure — needs 100ms delay
    // Date.now() - lastFailureTime ≈ 0 < 100, so should not retry yet
    expect(guard.shouldRetry).toBe(false);
    expect(guard.failureCount).toBe(1);
  });
});
