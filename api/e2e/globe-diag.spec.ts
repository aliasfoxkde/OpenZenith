import { test, expect } from "@playwright/test";

test("globe deep diagnostic", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push("PAGE:" + err.message + "\n  Stack:" + (err.stack || "none")));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("CONSOLE:" + msg.text());
  });

  await page.goto("/globe", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(8000);

  const diag = await page.evaluate(() => {
    const w = window as unknown as {
      Cesium?: { VERSION: string };
      __ozViewer?: unknown;
      CESIUM_BASE_URL?: string;
      DEFER?: unknown;
    };
    if (!w.Cesium) return { cesiumLoaded: false };
    const viewer = w.__ozViewer;
    const container = document.querySelector(".wv-map");
    return {
      cesiumLoaded: true,
      cesiumVersion: w.Cesium.VERSION,
      viewerExists: !!viewer,
      containerExists: !!container,
      containerHTML: container ? container.innerHTML.substring(0, 300) : "none",
      childCount: container ? container.children.length : 0,
      canvasCount: container ? container.querySelectorAll("canvas").length : 0,
      cesiumBaseURL: w.CESIUM_BASE_URL,
      deferExists: !!w.DEFER,
    };
  });

  console.log("Diag:", JSON.stringify(diag, null, 2));
  console.log("Errors:", errors);

  expect(diag.cesiumLoaded).toBe(true);
  expect(diag.containerExists).toBe(true);
});
