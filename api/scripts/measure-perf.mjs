// CDP cold-load performance measurement for OpenZenith prod (or BASE).
// Usage: node scripts/measure-perf.mjs   (BASE env overrides the URL)
// Per route: wire bytes by type/host, FCP/LCP/CLS, long-task census,
// request counts; plus a landing idle/scroll jank census. See
// docs/planning/PERFORMANCE_PLAN_2026-10-02.md for the baseline table.
// Runtime perf measurement against prod via CDP (Playwright chromium).
// Per route: wire bytes by type, request counts, FCP/LCP, long tasks,
// heap, DOM nodes, listeners. Plus a landing idle/scroll jank census.
import { createRequire } from "module";
const require = createRequire("/nas/Temp/repos/OpenZenith/api/package.json");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://openzenith.cyopsys.com";
const ROUTES = ["/", "/map", "/globe", "/explore", "/studio", "/demo", "/wasm-demo"];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});

async function measureRoute(route) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  const byType = {};
  let reqs = 0;
  let thirdParty = {};
  const respMeta = new Map();
  cdp.on("Network.responseReceived", (e) => {
    respMeta.set(e.requestId, {
      type: e.type,
      url: e.response.url,
      status: e.response.status,
      mime: e.response.mimeType,
      host: new URL(e.response.url).host,
      fromDiskCache: e.response.fromDiskCache,
    });
  });
  cdp.on("Network.loadingFinished", (e) => {
    reqs++;
    const m = respMeta.get(e.requestId);
    if (!m) return;
    const b = e.encodedDataLength || 0;
    const t = m.type || "Other";
    byType[t] = (byType[t] || 0) + b;
    if (!m.host.includes("openzenith.cyopsys.com")) thirdParty[m.host] = (thirdParty[m.host] || 0) + b;
  });

  await page.addInitScript(() => {
    window.__oz = { longTasks: [], fcp: 0, lcp: 0, cls: 0, entries: [] };
    try {
      new PerformanceObserver((l) => {
        for (const t of l.getEntries()) window.__oz.longTasks.push({ start: t.startTime, dur: t.duration });
      }).observe({ entryTypes: ["longtask"] });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__oz.fcp = e.startTime;
      }).observe({ entryTypes: ["paint"] });
      new PerformanceObserver((l) => {
        const es = l.getEntries();
        if (es.length) window.__oz.lcp = es[es.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__oz.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });

  const t0 = Date.now();
  await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(4000); // settle: late chunks, hydration, idle fetches

  const m = await cdp.send("Performance.getMetrics");
  const oz = await page.evaluate(() => window.__oz);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n
      ? { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, transferDoc: n.transferSize, domBytes: n.encodedBodySize }
      : {};
  });
  const idleLong = oz.longTasks.filter((t) => t.start > nav.load).reduce((a, t) => a + t.dur, 0);

  const metrics = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify(
      {
        route,
        loadMs,
        ttfbMs: Math.round(nav.ttfb || 0),
        fcpMs: Math.round(oz.fcp),
        lcpMs: Math.round(oz.lcp),
        cls: +oz.cls.toFixed(4),
        wireKB: +(total / 1024).toFixed(1),
        docKB: +((nav.transferDoc || 0) / 1024).toFixed(1),
        byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
        thirdPartyKB: Object.fromEntries(Object.entries(thirdParty).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
        requests: reqs,
        longTasks: oz.longTasks.length,
        longTaskMsTotal: Math.round(oz.longTasks.reduce((a, t) => a + t.dur, 0)),
        longTaskMsAfterLoad: Math.round(idleLong),
        heapMB: +((metrics.JSHeapUsedSize || 0) / 1048576).toFixed(1),
        nodes: metrics.Nodes,
        listeners: metrics.JSEventListeners,
        documents: metrics.Documents,
      },
      null,
      1,
    ),
  );
  await page.close();
}

for (const r of ROUTES) {
  try {
    await measureRoute(r);
  } catch (e) {
    console.log(JSON.stringify({ route: r, error: String(e).slice(0, 200) }));
  }
}

// Landing jank census: 5s idle, then a full-page scroll pass.
{
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const t of l.getEntries()) window.__lt.push({ start: Math.round(t.startTime), dur: Math.round(t.duration) });
    }).observe({ entryTypes: ["longtask"] });
  });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(5000);
  const idle = await page.evaluate(() => ({ lt: window.__lt.length, ms: window.__lt.reduce((a, t) => a + t.dur, 0) }));
  await page.evaluate(async () => {
    const step = 700;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ lt: window.__lt.length, ms: window.__lt.reduce((a, t) => a + t.dur, 0) }));
  console.log(JSON.stringify({ census: "landing", idle5s: idle, afterScroll: after, worst: (await page.evaluate(() => window.__lt.slice().sort((a, b) => b.dur - a.dur).slice(0, 8))) }));
  await page.close();
}

await browser.close();
