import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeProfileInWorker } from "../worker-utils";

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
}

const workerBlobs = new Map<string, Blob>();
const urlCalls: string[] = [];
let lastBlob: Blob | null = null;
/** Lets a test swap in a malformed worker script for the next worker. */
let overrideBlob: Blob | null = null;

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
      // handler on `self` and answers via self.postMessage().
      new Function("self", script)(selfObj);
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
    expect(result.points[200][0]).toBeCloseTo(1, 10);
    expect(result.points[200][1]).toBe(0);
    expect(result.points[100][0]).toBeCloseTo(0.5, 10);
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
    expect(result.points[result.points.length - 1][0]).toBeCloseTo(46, 10);
    expect(result.points[result.points.length - 1][1]).toBeCloseTo(-121, 10);

    const lons = result.points.map((p) => p[0]);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]).toBeGreaterThanOrEqual(lons[i - 1]);
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
