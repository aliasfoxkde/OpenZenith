import { test, expect } from "@playwright/test";

const PROD = "https://openzenith.cyopsys.com";

test("globe deep diagnostic", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push("PAGE:" + err.message + "\n  Stack:" + (err.stack || "none")));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("CONSOLE:" + msg.text());
  });

  await page.goto(`${PROD}/globe`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(8000);

  const diag = await page.evaluate(() => {
    const C = (window as any).Cesium;
    if (!C) return { cesiumLoaded: false };
    const viewer = (window as any).__ozViewer;
    const container = document.querySelector(".wv-map");
    return {
      cesiumLoaded: true,
      cesiumVersion: C.VERSION,
      viewerExists: !!viewer,
      containerExists: !!container,
      containerHTML: container ? container.innerHTML.substring(0, 300) : "none",
      childCount: container ? container.children.length : 0,
      canvasCount: container ? container.querySelectorAll("canvas").length : 0,
      cesiumBaseURL: (window as any).CESIUM_BASE_URL,
      deferExists: !!(window as any).DEFER,
    };
  });

  console.log("Diag:", JSON.stringify(diag, null, 2));
  console.log("Errors:", errors);

  expect(diag.cesiumLoaded).toBe(true);
  expect(diag.containerExists).toBe(true);
});
