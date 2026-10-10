import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { computeProfileInWorker, propagateCatalogueInWorker } from "../worker-utils";

/**
 * computeProfileInWorker spins up an inline Web Worker from a Blob URL, which
 * Node does not execute. The fake below resolves the blob it is handed, runs
 * the worker script against a stub `self`, and replays the worker lifecycle
 * (message in -> result out -> terminate). That keeps the haversine/sampling
 * logic inside the generated worker source under real test.
 */

interface FakeMessageEvent {
  data: unknown;
}

type MessageHandler = (e: FakeMessageEvent) => void;

interface FakeSelf {
  onmessage: MessageHandler | null;
  postMessage: (msg: unknown) => void;
  satellite?: unknown;
}

const workerBlobs = new Map<string, Blob>();
const urlCalls: string[] = [];
let lastBlob: Blob | null = null;
/** Lets a test swap in a malformed worker script for the next worker. */
let overrideBlob: Blob | null = null;
/**
 * Seeds the worker's fake scope the way the vendored satellite.js UMD build
 * would: importScripts runs at evaluation time and populates self.satellite.
 * Null means importScripts is absent from the scope entirely (ReferenceError
 * inside the worker's try/catch); a function may seed nothing (vendor script
 * missing) or install a fake satellite.js.
 */
let importScriptsImpl: ((selfObj: FakeSelf) => void) | null | undefined;

class FakeWorker {
  /** When set, the next worker reports an error instead of a result. */
  static failureMessage: string | null = null;
  static instances: FakeWorker[] = [];

  onmessage: MessageHandler | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  received: unknown = null;
  terminated = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWorker.instances.push(this);
  }

  async postMessage(data: unknown): Promise<void> {
    this.received = data;

    const failure = FakeWorker.failureMessage;
    if (failure !== null) {
      this.onerror?.({ message: failure });
      return;
    }

    const blob = workerBlobs.get(this.url);
    if (!blob) {
      this.onerror?.({ message: `no blob registered for ${this.url}` });
      return;
    }

    const script = await blob.text();
    const selfObj: FakeSelf = {
      onmessage: null,
      postMessage: (msg: unknown) => this.onmessage?.({ data: msg }),
    };

    try {
      // Evaluate the worker source the way a real worker would: it registers a
      // handler on `self` and answers via self.postMessage(). A fresh vm context
      // gives the script its own globals, mirroring a dedicated worker scope.
      const sandbox: Record<string, unknown> = { self: selfObj };
      const seed = importScriptsImpl;
      if (seed != null) {
        sandbox.importScripts = () => {
          seed(selfObj);
        };
      }
      vm.runInNewContext(script, sandbox);
    } catch (err) {
      this.onerror?.({ message: err instanceof Error ? err.message : String(err) });
      return;
    }

    if (selfObj.onmessage === null) {
      this.onerror?.({ message: "worker never registered an onmessage handler" });
      return;
    }
    selfObj.onmessage({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.failureMessage = null;
  lastBlob = null;
  overrideBlob = null;
  importScriptsImpl = undefined;
  workerBlobs.clear();
  urlCalls.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    const registered = overrideBlob ?? (blob as Blob);
    lastBlob = registered;
    urlCalls.push("create");
    const url = `blob:worker-${workerBlobs.size}`;
    workerBlobs.set(url, registered);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {
    urlCalls.push("revoke");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function workerScript(): Promise<string> {
  const blob = workerBlobs.get(FakeWorker.instances[0]?.url ?? "");
  return (await blob?.text()) ?? "";
}

describe("computeProfileInWorker", () => {
  it("is exported", () => {
    expect(typeof computeProfileInWorker).toBe("function");
  });

  it("creates an inline worker from a script blob", async () => {
    await computeProfileInWorker([0, 0], [1, 0]);

    expect(FakeWorker.instances).toHaveLength(1);
    const script = await workerScript();
    expect(script).toContain("haversine");
    expect(script).toContain("self.onmessage");
    expect(lastBlob).toBeInstanceOf(Blob);
    expect(lastBlob?.type).toBe("application/javascript");
    expect(lastBlob?.size).toBe(script.length);
    expect(urlCalls).toEqual(["create", "revoke"]);
  });

  it("sends the start/end payload to the worker", async () => {
    await computeProfileInWorker([10, 20], [30, 40]);

    expect(FakeWorker.instances[0]?.received).toEqual({ start: [10, 20], end: [30, 40] });
  });

  it("returns interpolated points over a long profile", async () => {
    // One degree of longitude at the equator is ~111.19 km -> clamped to 200 samples.
    const result = await computeProfileInWorker([0, 0], [1, 0]);

    expect(result.points).toHaveLength(201);
    expect(result.points[0]).toEqual([0, 0]);
    expect(result.points[200]![0]).toBeCloseTo(1, 10);
    expect(result.points[200]![1]).toBe(0);
    expect(result.points[100]![0]).toBeCloseTo(0.5, 10);
    expect(result.totalDistance).toBeGreaterThan(110000);
    expect(result.totalDistance).toBeLessThan(112000);
  });

  it("clamps short profiles to the 50-sample minimum", async () => {
    // ~11 m apart -> round(dist/100) is 0, so the floor of 50 applies.
    const result = await computeProfileInWorker([0, 0], [0, 0.0001]);

    expect(result.points).toHaveLength(51);
    expect(result.totalDistance).toBeGreaterThan(0);
    expect(result.totalDistance).toBeLessThan(20);
  });

  it("measures a half-circumference profile", async () => {
    const result = await computeProfileInWorker([0, 0], [0, 180]);

    expect(result.totalDistance).toBeGreaterThan(20_000_000 * 0.99);
    expect(result.totalDistance).toBeLessThan(20_015_000 * 1.01);
    expect(result.points).toHaveLength(201);
  });

  it("interpolates latitude and longitude together", async () => {
    const result = await computeProfileInWorker([45, -122], [46, -121]);

    expect(result.points[0]).toEqual([45, -122]);
    expect(result.points[result.points.length - 1]![0]).toBeCloseTo(46, 10);
    expect(result.points[result.points.length - 1]![1]).toBeCloseTo(-121, 10);

    const lons = result.points.map((p) => p[0]);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]).toBeGreaterThanOrEqual(lons[i - 1]!);
    }
  });

  it("terminates the worker once a result arrives", async () => {
    await computeProfileInWorker([0, 0], [1, 0]);

    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("rejects and terminates when the worker errors", async () => {
    FakeWorker.failureMessage = "out of memory";

    await expect(computeProfileInWorker([0, 0], [1, 0])).rejects.toThrow("out of memory");
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("rejects when the worker script cannot be evaluated", async () => {
    overrideBlob = new Blob(["not valid js ("], { type: "application/javascript" });

    await expect(computeProfileInWorker([0, 0], [1, 0])).rejects.toThrow();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("rejects when the worker script registers no message handler", async () => {
    overrideBlob = new Blob(["// no self.onmessage here"], { type: "application/javascript" });

    await expect(computeProfileInWorker([0, 0], [1, 0])).rejects.toThrow(
      "worker never registered an onmessage handler",
    );
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});

/**
 * The SGP4 worker sources satellite.js itself via importScripts, so the fake
 * below seeds a deterministic stand-in: for TLE line "L1-<idx>" every derived
 * quantity is a pure function of idx, and ground-track longitudes move 1
 * degree per elapsed minute — exact expectations with no orbital mechanics.
 */

/** TLE pair tagged with index `i`: fixes come back as [i, 2i, 3i], v = 5. */
function tle(i: number): [string, string] {
  return [`L1-${i}`, `L2-${i}`];
}

function seedFakeSatellite(selfObj: FakeSelf): void {
  selfObj.satellite = {
    twoline2satrec: (l1: string) => {
      const idx = Number(l1.replace("L1-", ""));
      if (Number.isNaN(idx)) throw new Error("malformed TLE");
      return { idx };
    },
    propagate: (rec: { idx: number }, at: Date) => {
      if (rec.idx === 2) return {}; // "decayed": no position/velocity
      return {
        position: { x: rec.idx === 0 ? rec.idx : at.getTime() / 60000, y: 0, z: 0 },
        velocity: { x: 3, y: 4, z: 0 },
      };
    },
    gstime: () => 0,
    eciToGeodetic: (p: { x: number }) => ({ longitude: p.x, latitude: 2 * p.x, height: 3 * p.x }),
    degreesLong: (r: number) => r,
    degreesLat: (r: number) => r,
  };
}

describe("propagateCatalogueInWorker", () => {
  it("is exported", () => {
    expect(typeof propagateCatalogueInWorker).toBe("function");
  });

  it("creates an inline worker sourcing the vendored satellite.js", async () => {
    importScriptsImpl = seedFakeSatellite;
    await propagateCatalogueInWorker([tle(0)], 6_000_000);

    expect(FakeWorker.instances).toHaveLength(1);
    const script = await workerScript();
    expect(script).toContain("importScripts");
    expect(script).toContain('"/vendor/satellite.min.js"');
    expect(script).toContain("self.onmessage");
    expect(lastBlob?.type).toBe("application/javascript");
  });

  it("sends the catalogue payload with an empty default track list", async () => {
    importScriptsImpl = seedFakeSatellite;
    await propagateCatalogueInWorker([tle(0), tle(1)], 6_000_000);

    expect(FakeWorker.instances[0]?.received).toEqual({
      tles: [
        ["L1-0", "L2-0"],
        ["L1-1", "L2-1"],
      ],
      atMs: 6_000_000,
      trackIdx: [],
    });
  });

  it("propagates fixes in catalogue order", async () => {
    importScriptsImpl = seedFakeSatellite;
    const result = await propagateCatalogueInWorker([tle(0), tle(1)], 6_000_000);

    expect(result.fixes).toHaveLength(2);
    expect(result.fixes[0]).toEqual({ coords: [0, 0, 0], velocity: 5 });
    // idx 1 propagates at the catalogue epoch: 6,000,000 ms = 100 min.
    expect(result.fixes[1]).toEqual({ coords: [100, 200, 300], velocity: 5 });
    expect(result.tracks).toEqual([]);
  });

  it("returns null for malformed and decayed TLEs without dropping order", async () => {
    importScriptsImpl = seedFakeSatellite;
    const result = await propagateCatalogueInWorker(
      [tle(1), ["garbage", "garbage"], tle(2), tle(3)],
      6_000_000,
    );

    // fixes[1] (malformed -> throw) and fixes[2] (decayed -> no position) are
    // null IN PLACE; the healthy entries keep their catalogue positions and
    // the epoch-derived fix (the fake moves 1 degree per elapsed minute).
    expect(result.fixes[0]).toEqual({ coords: [100, 200, 300], velocity: 5 });
    expect(result.fixes[1]).toBeNull();
    expect(result.fixes[2]).toBeNull();
    expect(result.fixes[3]).toEqual({ coords: [100, 200, 300], velocity: 5 });
  });

  it("batch-propagates ground tracks at 2-minute steps across ±90 minutes", async () => {
    importScriptsImpl = seedFakeSatellite;
    const result = await propagateCatalogueInWorker([tle(0), tle(1)], 6_000_000, [1]);

    // 91 samples of one degree-per-minute longitude, flat [lon, lat, ...].
    expect(result.tracks).toHaveLength(1);
    const pts = result.tracks[0]!;
    expect(pts).toHaveLength(182);
    expect(pts[0]).toBe(10); // 100 min - 90
    expect(pts[1]).toBe(20);
    expect(pts[2]).toBe(12); // 2 minutes later
    expect(pts[180]).toBe(190); // 100 min + 90
    expect(pts[181]).toBe(380);
  });

  it("rejects when the vendor script seeds no satellite.js", async () => {
    // importScripts runs but the vendor file is missing: self.satellite stays
    // undefined and the worker reports the failure as a rejection.
    importScriptsImpl = () => {};

    await expect(propagateCatalogueInWorker([tle(0)], 6_000_000)).rejects.toThrow(
      "satellite.js unavailable in worker",
    );
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("rejects when importScripts itself is unavailable", async () => {
    // importScriptsImpl null: the sandbox has no importScripts at all, so the
    // worker's top-level try/catch absorbs the ReferenceError and the guard
    // below reports the same failure.
    importScriptsImpl = null;

    await expect(propagateCatalogueInWorker([tle(0)], 6_000_000)).rejects.toThrow(
      "satellite.js unavailable in worker",
    );
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("terminates the worker once the propagation arrives", async () => {
    importScriptsImpl = seedFakeSatellite;
    await propagateCatalogueInWorker([tle(0), tle(5)], 6_000_000, [1]);

    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});
