import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startServer,
  launchBrowser,
  openDoc as openDocOnce,
  readErrors,
  screenshot,
  installTimingObservers,
  readTiming,
  jsHeapMB,
} from "../harness/lib/browser.mjs";

// This machine runs several other Playwright/Vite-heavy repro agents concurrently, which makes
// the harness's own openDoc() (a page.goto + a wait on window.__ready) occasionally race the
// page's module script or the dev server itself (ERR_CONNECTION_REFUSED, or window.__ready read
// before main.js has run). Retry the whole page open rather than patching the shared harness.
async function openDoc(browser, baseUrl, queryParams, options) {
  const attempt = (remaining) =>
    openDocOnce(browser, baseUrl, queryParams, options).catch((error) => {
      if (remaining <= 0) throw error;
      console.log(`  (openDoc retry after: ${error.message.split("\n")[0]})`);
      return new Promise((r) => setTimeout(r, 2000)).then(() => attempt(remaining - 1));
    });
  return attempt(3);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACKED = "SD-105/tracked-paste-schedule.docx";
const ACCEPTED = "SD-105/tracked-paste-schedule-accepted.docx";
const CONTROL = "SD-105/synthetic-control-no-tracking.docx";
const SYNTHETIC = "SD-105/synthetic-2000-tracked-insertions.docx";

const SUMMARY = [];

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function cdpMetrics(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const read = async () => {
    const { metrics } = await client.send("Performance.getMetrics");
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    return {
      nodes: byName.Nodes,
      layoutCount: byName.LayoutCount,
      recalcStyleCount: byName.RecalcStyleCount,
    };
  };
  return { read, detach: () => client.detach() };
}

async function domCounts(page) {
  return page.evaluate(() => ({
    pages: document.querySelectorAll("[data-page-number], .superdoc-page, .pagination-section-header").length,
    trackedEls: document.querySelectorAll("[data-track-change-id],[data-track-change-ids]").length,
    trackedElsWithIdList: document.querySelectorAll("[data-track-change-ids]").length,
    maxIdsOnOneElement: Math.max(
      0,
      ...[...document.querySelectorAll("[data-track-change-ids]")].map(
        (el) => (el.dataset.trackChangeIds ?? "").split(",").filter(Boolean).length,
      ),
    ),
  }));
}

// --- 1. Full top-to-bottom scroll ---------------------------------------
async function scrollTest(browser, baseUrl, doc, label, { steps = 60 } = {}) {
  const page = await openDoc(browser, baseUrl, { doc, mode: "editing" }, { timeoutMs: 120000 });
  await installTimingObservers(page);
  await page.waitForTimeout(1500);
  const metrics = await cdpMetrics(page);
  const heapBefore = await jsHeapMB(page);
  const before = await metrics.read();
  const t0 = Date.now();
  const frames = await page.evaluate(async (stepCount) => {
    const el = document.scrollingElement;
    const max = el.scrollHeight - el.clientHeight;
    const out = [];
    for (let i = 1; i <= stepCount; i++) {
      const t = performance.now();
      el.scrollTop = (max * i) / stepCount;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(performance.now() - t);
    }
    return out;
  }, steps);
  const totalMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const after = await metrics.read();
  const heapAfter = await jsHeapMB(page);
  const timing = await readTiming(page);
  const counts = await domCounts(page);
  await metrics.detach();
  const sortedFrames = [...frames].sort((a, b) => a - b);
  const result = {
    doc,
    label,
    totalMs,
    frame: {
      p50: Math.round(percentile(sortedFrames, 0.5)),
      p95: Math.round(percentile(sortedFrames, 0.95)),
      max: Math.round(sortedFrames.at(-1)),
    },
    longTasks: {
      count: timing.longTasks.length,
      totalMs: Math.round(timing.longTasks.reduce((a, b) => a + b.duration, 0)),
      max: Math.round(Math.max(0, ...timing.longTasks.map((t) => t.duration))),
    },
    heapMB: { before: Math.round(heapBefore), after: Math.round(heapAfter) },
    domNodes: { before: before.nodes, after: after.nodes },
    layoutCount: after.layoutCount - before.layoutCount,
    recalcStyleCount: after.recalcStyleCount - before.recalcStyleCount,
    ...counts,
  };
  console.log(`[scroll] ${label}: ${totalMs}ms total, p95 frame ${result.frame.p95}ms, ${result.longTasks.count} long tasks (${result.longTasks.totalMs}ms), heap ${result.heapMB.before}->${result.heapMB.after}MB`);
  await page.close();
  return result;
}

// --- 2. Edit inside another author's tracked insertion -------------------
async function editTest(browser, baseUrl, doc, label) {
  const page = await openDoc(browser, baseUrl, { doc, mode: "suggesting" }, { timeoutMs: 180000 });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(async () => {
    const total = (await window.__sd.activeEditor.doc.trackChanges.list({ offset: 0, limit: 1 })).total;
    return { trackedChanges: total };
  });
  // A generic length-only selector can land on a header/footer banner (not part of the
  // editable body); anchor on real body content instead ("Disclosure", inside the pasted
  // schedule table, present in both the tracked and the accepted-baseline fixture).
  const located = await page.evaluate(async () => {
    const find = () => [...document.querySelectorAll(".superdoc-text-run")].find((el) => /Disclosure/.test(el.textContent ?? ""));
    const scroller = document.scrollingElement;
    const target = await (async () => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const found = find();
        if (found) return found;
        scroller.scrollTop = ((scroller.scrollHeight - scroller.clientHeight) * (attempt % 60)) / 60;
        await new Promise((r) => setTimeout(r, 500));
      }
      return find();
    })();
    if (!target) return null;
    target.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 2000));
    const rect = target.getBoundingClientRect();
    const host = target.closest("[data-track-change-ids]") ?? target;
    return {
      x: rect.right - 2,
      y: rect.top + rect.height / 2,
      idsOnElement: (host.dataset.trackChangeIds ?? "").split(",").filter(Boolean).length,
    };
  });
  if (!located) {
    console.log(`[edit] ${label}: could not locate editable tracked text`);
    await page.close();
    return { doc, label, error: "no editable target found" };
  }
  await page.mouse.click(located.x, located.y);
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__echo = { keys: [], paints: [] };
    document.addEventListener("keydown", () => window.__echo.keys.push(performance.now()), true);
    new MutationObserver(() => window.__echo.paints.push(performance.now())).observe(document.querySelector("#editor"), {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const measure = async (action, settleMs) => {
    await page.evaluate(() => {
      window.__echo.keys = [];
      window.__echo.paints = [];
    });
    await action();
    await page.waitForTimeout(settleMs);
    return page.evaluate(() => {
      const { keys, paints } = window.__echo;
      return {
        settledAfterFirstKeyMs: paints.length && keys.length ? Math.round(paints.at(-1) - keys[0]) : null,
      };
    });
  };
  const typing = await measure(() => page.keyboard.type("abcdefghij", { delay: 60 }), 9000);
  const deleting = await measure(async () => {
    for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace", { delay: 60 });
  }, 12000);
  const errors = await readErrors(page);
  await page.close();
  const result = { doc, label, ...info, idsOnElement: located.idsOnElement, typing, deleting, errors };
  console.log(`[edit] ${label}: typing settle ${typing.settledAfterFirstKeyMs}ms, backspace settle ${deleting.settledAfterFirstKeyMs}ms`);
  return result;
}

// --- 3. Click a change at the bottom of the document ----------------------
async function clickBottomTest(browser, baseUrl, doc, label) {
  const page = await openDoc(browser, baseUrl, { doc, mode: "editing", commentsDisplay: "auto" }, { timeoutMs: 120000 });
  await installTimingObservers(page);
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const el = document.scrollingElement;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(1500);
  // Prefer a grouped change (more than one aliased revision id) over a lone single-id element:
  // the grouped/table-insertion change is the one implicated in the "click stalls" root cause.
  const target = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("[data-track-change-id],[data-track-change-ids]")];
    const visible = candidates.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
    });
    const pool = visible.length ? visible : candidates;
    const grouped = pool.filter((el) => (el.dataset.trackChangeIds ?? "").split(",").filter(Boolean).length > 1);
    const el = (grouped.length ? grouped : pool).at(-1);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, idCount: (el.dataset.trackChangeIds ?? "").split(",").filter(Boolean).length };
  });
  if (!target) {
    console.log(`[click-bottom] ${label}: no tracked-change element found near the bottom`);
    await page.close();
    return { doc, label, error: "no tracked-change element near the bottom" };
  }
  await page.evaluate(() => {
    window.__clickEcho = { clickAt: null, mutations: [] };
    new MutationObserver((records) => {
      const now = performance.now();
      for (const r of records) if (r.target instanceof Element) window.__clickEcho.mutations.push(now);
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
    document.addEventListener("selectionchange", () => window.__clickEcho.mutations.push(performance.now()));
  });
  const timingBefore = await readTiming(page);
  const framesBefore = timingBefore.frameDurations.length;
  const longBefore = timingBefore.longTasks.length;
  const clickStart = Date.now();
  await page.evaluate(() => {
    window.__clickEcho.clickAt = performance.now();
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(8000);
  const clickWallMs = Date.now() - clickStart;
  const settle = await page.evaluate(() => {
    const { clickAt, mutations } = window.__clickEcho;
    const after = mutations.filter((m) => m >= clickAt);
    return { settleMs: after.length ? Math.round(after.at(-1) - clickAt) : null, mutationCount: after.length };
  });
  const timingAfter = await readTiming(page);
  const framesDuring = timingAfter.frameDurations.slice(framesBefore);
  const longDuring = timingAfter.longTasks.slice(longBefore);
  const errors = await readErrors(page);
  await screenshot(page, HERE, `click-bottom-${label.replace(/[^a-z0-9]+/gi, "-")}.png`);
  await page.close();
  const result = {
    doc,
    label,
    clickWallMs,
    settleMs: settle.settleMs,
    mutationCount: settle.mutationCount,
    maxFrameDuringWindow: Math.round(Math.max(0, ...framesDuring)),
    longTasksDuringWindow: { count: longDuring.length, totalMs: Math.round(longDuring.reduce((a, b) => a + b.duration, 0)) },
    errors,
  };
  console.log(`[click-bottom] ${label}: settle ${result.settleMs}ms, max frame ${result.maxFrameDuringWindow}ms, ${result.longTasksDuringWindow.count} long tasks during window`);
  return result;
}

// --- 4. Synthetic 2,000-revision file, stepped scroll with a time budget --
async function syntheticScrollTest(browser, baseUrl, { steps = 20, budgetMs = 180000 } = {}) {
  const page = await openDoc(browser, baseUrl, { doc: SYNTHETIC, mode: "editing" }, { timeoutMs: 120000 });
  const t0 = Date.now();
  const stepResults = [];
  for (let i = 1; i <= steps; i++) {
    const s = Date.now();
    try {
      await page.evaluate(
        (ii) => {
          const el = document.scrollingElement;
          el.scrollTop = ((el.scrollHeight - el.clientHeight) * ii) / 20;
          return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        i,
      );
    } catch (e) {
      stepResults.push({ step: i, failed: true, error: String(e.message).split("\n")[0] });
      break;
    }
    const heapMB = Math.round(await jsHeapMB(page));
    stepResults.push({ step: i, frameMs: Date.now() - s, heapMB });
    if (Date.now() - t0 > budgetMs) {
      stepResults.push({ stoppedEarly: true, reason: "time budget" });
      break;
    }
  }
  await page.close();
  const worstStep = stepResults.filter((s) => s.frameMs).sort((a, b) => b.frameMs - a.frameMs)[0];
  console.log(`[synthetic-scroll] ${stepResults.length} steps run, worst frame ${worstStep?.frameMs}ms at step ${worstStep?.step}, heap reached ${Math.max(0, ...stepResults.map((s) => s.heapMB ?? 0))}MB`);
  return { doc: SYNTHETIC, label: "synthetic-2000-insertions", steps: stepResults };
}

async function withPhase(run) {
  // Each phase gets its own fresh Vite server + browser: this machine runs several other
  // Playwright/Vite-heavy repro agents concurrently, and reusing one server/browser across
  // every heavy scroll+profiling pass made later phases' virtualized-DOM lookups flaky and,
  // once, lost the shared dev server outright (ERR_CONNECTION_REFUSED).
  const server = await startServer();
  const browser = await launchBrowser();
  try {
    return await run(browser, server.url);
  } finally {
    await browser.close();
    server.stop();
  }
}

async function main() {
  try {
    console.log("=== Scroll, top to bottom (60 steps) ===");
    const scrollResults = await withPhase(async (browser, url) => [
      await scrollTest(browser, url, TRACKED, "tracked (158 review items)"),
      await scrollTest(browser, url, ACCEPTED, "accepted baseline"),
      await scrollTest(browser, url, CONTROL, "untracked control"),
    ]);
    SUMMARY.push(...scrollResults);

    console.log("\n=== Edit inside tracked text (suggesting mode) ===");
    const [editTracked, editAccepted] = await withPhase(async (browser, url) => [
      await editTest(browser, url, TRACKED, "tracked"),
      await editTest(browser, url, ACCEPTED, "accepted baseline"),
    ]);
    SUMMARY.push(editTracked, editAccepted);

    console.log("\n=== Click a tracked change near the bottom ===");
    const [clickTracked, clickAccepted] = await withPhase(async (browser, url) => [
      await clickBottomTest(browser, url, TRACKED, "tracked"),
      await clickBottomTest(browser, url, ACCEPTED, "accepted baseline"),
    ]);
    SUMMARY.push(clickTracked, clickAccepted);

    console.log("\n=== Synthetic 2,000-revision file, stepped scroll ===");
    const syntheticResult = await withPhase((browser, url) => syntheticScrollTest(browser, url));
    SUMMARY.push(syntheticResult);

    writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(SUMMARY, null, 2));

    const trackedScroll = SUMMARY.find((r) => r.doc === TRACKED && r.totalMs);
    const acceptedScroll = SUMMARY.find((r) => r.doc === ACCEPTED && r.totalMs);
    const controlScroll = SUMMARY.find((r) => r.doc === CONTROL && r.totalMs);

    console.log("\n=== PASS/FAIL (bug reproduces on 2.23.0 if tracked is far slower than accepted/control) ===");
    const scrollRegression = trackedScroll.totalMs > acceptedScroll.totalMs * 5 && trackedScroll.totalMs > controlScroll.totalMs * 5;
    const editRegression = (editTracked.typing.settledAfterFirstKeyMs ?? 0) > (editAccepted.typing.settledAfterFirstKeyMs ?? 1) * 10;
    const clickRegression = (clickTracked.settleMs ?? clickTracked.maxFrameDuringWindow ?? 0) > 2000;
    console.log(`scroll: tracked ${trackedScroll.totalMs}ms vs accepted ${acceptedScroll.totalMs}ms vs control ${controlScroll.totalMs}ms -> ${scrollRegression ? "REGRESSION CONFIRMED" : "no regression observed"}`);
    console.log(`edit: tracked typing-settle ${editTracked.typing.settledAfterFirstKeyMs}ms vs accepted ${editAccepted.typing.settledAfterFirstKeyMs}ms -> ${editRegression ? "REGRESSION CONFIRMED" : "no regression observed"}`);
    console.log(`click-bottom: tracked settle ${clickTracked.settleMs}ms, max frame ${clickTracked.maxFrameDuringWindow}ms -> ${clickRegression ? "REGRESSION CONFIRMED" : "no regression observed"}`);

    const bugReproduces = scrollRegression || editRegression || clickRegression;
    console.log(bugReproduces ? "\nPASS (bug reproduced on 2.23.0)" : "\nFAIL (bug did not reproduce on 2.23.0)");
    assert.ok(bugReproduces, "expected tracked-changes performance regression to reproduce on 2.23.0");
  } catch (error) {
    writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(SUMMARY, null, 2));
    throw error;
  }
}

await main();
