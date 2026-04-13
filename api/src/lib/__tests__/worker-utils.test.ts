import { describe, it, expect } from "vitest";

// Worker API is not available in vitest (Node.js) environment.
// computeProfileInWorker is tested via integration in studio/page.tsx.
describe("computeProfileInWorker", () => {
  it("is exported", async () => {
    const { computeProfileInWorker } = await import("../worker-utils");
    expect(typeof computeProfileInWorker).toBe("function");
  });
});
