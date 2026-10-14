import { writeFileSync } from "node:fs";
import { startServer, launchBrowser, openDoc, screenshot, jsHeapMB } from "../harness/lib/browser.mjs";

const here = new URL(".", import.meta.url).pathname;
const server = await startServer();
const browser = await launchBrowser();

async function measureClick(doc) {
  const page = await openDoc(browser, server.url, { doc, mode: "editing" }, { timeoutMs: 120000 });
  await page.waitForTimeout(3000);
  const target = await page.evaluate(async () => {
    const pick = () => {
      const candidates = [...document.querySelectorAll("[data-track-change-ids]")]
        .map((element) => ({ element, ids: element.getAttribute("data-track-change-ids").split(/[\s,]+/).filter(Boolean).length }))
        .filter((entry) => entry.element.closest("td, [data-block-type='tableCell'], .superdoc-table-cell") || entry.ids >= 20)
        .sort((a, b) => b.ids - a.ids);
      return candidates[0];
    };
    for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const best = pick();
      if (best && best.ids >= 20) {
        best.element.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const settled = pick() ?? best;
        const rect = settled.element.getBoundingClientRect();
        return { x: rect.x + Math.min(20, rect.width / 2), y: rect.y + rect.height / 2, ids: settled.ids, scrollY: window.scrollY };
      }
    }
    return null;
  });
  if (!target) return { doc, error: "no table tracked-change element with >=20 aliases found" };
  await page.evaluate(() => {
    window.__clickLongTasks = [];
    window.__clickFrames = [];
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__clickLongTasks.push(Math.round(entry.duration)))).observe({ type: "longtask" });
    let last = performance.now();
    const loop = (now) => { window.__clickFrames.push(Math.round(now - last)); last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const heapBefore = await jsHeapMB(page);
  const started = Date.now();
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(250);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const firstPaintAfterClickMs = Date.now() - started;
  await page.waitForTimeout(5000);
  const stats = await page.evaluate(() => ({
    longTasks: window.__clickLongTasks,
    maxFrameMs: Math.max(0, ...window.__clickFrames),
    visibility: document.visibilityState,
  }));
  await screenshot(page, `${here}screenshots`, `click-table-change-${doc.split("/").pop().replace(".docx", "")}.png`);
  const result = {
    doc,
    aliasesOnClickedElement: target.ids,
    firstPaintAfterClickMs,
    maxFrameMs: stats.maxFrameMs,
    longTaskCount: stats.longTasks.length,
    longTaskTotalMs: stats.longTasks.reduce((sum, value) => sum + value, 0),
    heapBeforeMB: heapBefore,
    heapAfterMB: await jsHeapMB(page),
    visibility: stats.visibility,
  };
  await page.close();
  return result;
}

const results = [];
for (const doc of ["SD-105/tracked-paste-schedule.docx"]) results.push(await measureClick(doc));
await browser.close();
await server.stop();
writeFileSync(`${here}results-click-2.23.0.json`, JSON.stringify(results, null, 2));
for (const r of results) console.log(JSON.stringify(r));
const bad = results.find((r) => r.firstPaintAfterClickMs > 1000 || r.maxFrameMs > 1000);
console.log(bad ? "PASS (bug reproduced): clicking a change in the pasted table stalls the main thread" : "FAIL: no stall on click");
