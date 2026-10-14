// SD-82: fit-to-width zoom measurement -- verify on 2.23.0 whether it still measures the
// wrong (already-zoomed) element and spirals, per the old claim against superdoc 2.9.0.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "_fixtures/numbering-nostart-fixture.docx";

function getZoomSnapshot() {
  return {
    zoomState: window.__sd.getZoomState?.() ?? null,
    viewportMetrics: window.__sd.getViewportMetrics?.() ?? null,
  };
}

async function settleAtWidth(page, width) {
  await page.setViewportSize({ width, height: 900 });
  // Let the resize watcher's nextTick() + any layout settle.
  await page.waitForTimeout(400);
  return evalSd(page, getZoomSnapshot);
}

const server = await startServer();
const browser = await launchBrowser();
const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" }, { viewport: { width: 1280, height: 900 } });

const hasZoomApi = await evalSd(page, () => typeof window.__sd.setZoomMode === "function" && typeof window.__sd.getZoomState === "function");
assert.equal(hasZoomApi, true, "expected window.__sd.setZoomMode / getZoomState to exist on 2.23.0");

await evalSd(page, () => window.__sd.setZoomMode("fit-width"));
await page.waitForTimeout(400);

// Re-evaluate several times AT THE SAME container width -- if the base width were being
// re-derived from the already-zoomed page (the old bug), each re-evaluation would drift the
// zoom value further from a stable point. With no change in container width, a correct
// implementation should report the exact same zoom value every time.
const repeatedAtSameWidth = [];
for (let i = 0; i < 5; i += 1) {
  // Nudge by 1px and back to force the containerWidth watcher to refire at the same final width.
  await page.setViewportSize({ width: 1280 - 1, height: 900 });
  await page.waitForTimeout(150);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  repeatedAtSameWidth.push(await evalSd(page, getZoomSnapshot));
}

const widthsBelowAndAbovePageWidth = [1280, 1000, 1280, 1500, 900, 600, 400, 816, 300];
const widths = widthsBelowAndAbovePageWidth;
const acrossWidths = [];
for (const width of widths) {
  acrossWidths.push({ width, ...(await settleAtWidth(page, width)) });
}

await screenshot(page, resolvePath(HERE, "screenshots"), "fit-width-1280.png");

// Direct repro of the reported steps: a pane narrower than the page, call
// setZoomMode('fit-width') explicitly, screenshot, call it again with no resize in between,
// screenshot again, then compare the resulting zoom against paneWidth / pageWidth. The old bug
// re-derived its base width from the already-zoomed page on each pass, so a second call at an
// unchanged width should have drifted the result if it were still present.
const narrowPaneWidth = 500;
await page.setViewportSize({ width: narrowPaneWidth, height: 900 });
await page.waitForTimeout(400);
await evalSd(page, () => window.__sd.setZoomMode("fit-width"));
await page.waitForTimeout(300);
const narrowPaneFirstCall = await evalSd(page, getZoomSnapshot);
await screenshot(page, resolvePath(HERE, "screenshots"), "fit-width-narrow-pane-call-1.png");

await evalSd(page, () => window.__sd.setZoomMode("fit-width"));
await page.waitForTimeout(300);
const narrowPaneSecondCall = await evalSd(page, getZoomSnapshot);
await screenshot(page, resolvePath(HERE, "screenshots"), "fit-width-narrow-pane-call-2.png");

const errors = await readErrors(page);
await browser.close();
server.stop();

const narrowPaneExpectedZoomPercent = Math.round((narrowPaneWidth / narrowPaneSecondCall.viewportMetrics.documentWidth) * 100);
const narrowPaneIdenticalAcrossCalls = narrowPaneFirstCall.zoomState.value === narrowPaneSecondCall.zoomState.value;
const narrowPaneMatchesRatio = Math.abs(narrowPaneSecondCall.zoomState.value - narrowPaneExpectedZoomPercent) <= 1;

const repeatedZoomValues = repeatedAtSameWidth.map((s) => s.zoomState?.value);
const stableAtSameWidth = repeatedZoomValues.every((value) => value === repeatedZoomValues[0]);

const zoomTracksWidth = acrossWidths.every((entry, index) => {
  if (index === 0) return true;
  const previous = acrossWidths[index - 1];
  // Narrower pane -> lower (or equal) zoom; wider pane -> higher (or equal) zoom. Allow equality
  // since two different widths can round to the same whole-percent zoom.
  if (entry.width < previous.width) return entry.zoomState.value <= previous.zoomState.value + 1;
  if (entry.width > previous.width) return entry.zoomState.value >= previous.zoomState.value - 1;
  return true;
});

const documentWidths = acrossWidths.map((entry) => entry.viewportMetrics.documentWidth);
const documentWidthStable = documentWidths.every((value) => value === documentWidths[0]);

const reproduces = !stableAtSameWidth || !zoomTracksWidth || !documentWidthStable || !narrowPaneIdenticalAcrossCalls || !narrowPaneMatchesRatio;

const results = {
  hasZoomApi,
  repeatedAtSameWidth: repeatedAtSameWidth.map((s) => s.zoomState),
  stableAtSameWidth,
  acrossWidths: acrossWidths.map((entry) => ({ width: entry.width, zoom: entry.zoomState, metrics: entry.viewportMetrics })),
  zoomTracksWidth,
  documentWidthStable,
  narrowPaneDoubleCall: {
    paneWidth: narrowPaneWidth,
    firstCall: narrowPaneFirstCall.zoomState,
    secondCall: narrowPaneSecondCall.zoomState,
    pageWidth: narrowPaneSecondCall.viewportMetrics.documentWidth,
    expectedZoomPercent: narrowPaneExpectedZoomPercent,
    identicalAcrossCalls: narrowPaneIdenticalAcrossCalls,
    matchesPaneWidthOverPageWidthRatio: narrowPaneMatchesRatio,
  },
  consoleErrors: errors,
  reproduces,
};
writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(results, null, 2));

console.log("repeated-at-same-width zoom values:", repeatedZoomValues);
console.log("stable at same width (no spiral):", stableAtSameWidth);
console.log("zoom tracks pane width across resizes:", zoomTracksWidth);
console.log("documentWidth constant across all resizes:", documentWidthStable, documentWidths);
console.log(
  `narrow pane (${narrowPaneWidth}px) double-call: call1=${narrowPaneFirstCall.zoomState.value}% call2=${narrowPaneSecondCall.zoomState.value}% expected(paneWidth/pageWidth)=${narrowPaneExpectedZoomPercent}% identical=${narrowPaneIdenticalAcrossCalls} matchesRatio=${narrowPaneMatchesRatio}`,
);
console.log("console/onException errors:", JSON.stringify(errors));
console.log(reproduces ? "FAIL: fit-width still spirals / mismeasures on 2.23.0 (REPRODUCES)" : "PASS: fit-width converges and tracks pane width on 2.23.0 (FIXED vs the 2.9.0 claim)");
