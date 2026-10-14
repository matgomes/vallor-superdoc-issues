import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "SD-18/fixture-dpa-table-cell-revisions.docx";
const MODES = ["final", "original", "off", "review"];

function readMarkupState(page) {
  return evalSd(page, () => {
    const editorRoot = document.querySelector("#editor");
    const fullText = editorRoot?.textContent ?? "";
    const insertionVisible = fullText.includes("OUTSIDE");
    const markedAsTracked = Boolean(editorRoot?.querySelector(".track-insert-dec"));
    return {
      layoutEngineOptionsMode: window.__sd?.config?.layoutEngineOptions?.trackedChanges?.mode ?? null,
      insertionTextVisible: insertionVisible,
      insertionStillMarkedAsTracked: markedAsTracked,
    };
  });
}

async function setMode(page, mode) {
  return evalSd(page, (m) => {
    try {
      window.__sd.setTrackedChangesPreferences({ mode: m });
      return { threw: false };
    } catch (error) {
      return { threw: true, message: String(error?.message ?? error) };
    }
  }, mode);
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });

  const defaultState = await readMarkupState(page);
  await screenshot(page, HERE, "screenshots/00-default-review.png");

  const results = [];
  for (const mode of MODES) {
    const callResult = await setMode(page, mode);
    await page.waitForTimeout(400);
    const stateAfterCall = await readMarkupState(page);
    await screenshot(page, HERE, `screenshots/mode-${mode}.png`);
    results.push({ mode, callResult, stateAfterCall });
  }

  const errors = await readErrors(page);
  await browser.close();
  server.stop();

  const finalMode = results.find((entry) => entry.mode === "final");
  const originalMode = results.find((entry) => entry.mode === "original");

  const finalStillShowsTrackedMarkup = finalMode.stateAfterCall.insertionTextVisible && finalMode.stateAfterCall.insertionStillMarkedAsTracked;
  const originalCorrectlyHidesInsertion = !originalMode.stateAfterCall.insertionTextVisible;

  const summary = {
    version: "superdoc 2.23.0 / @superdoc/sdk 2.20.0",
    defaultState,
    results,
    errors,
    findings: {
      configFieldAlwaysUpdates: results.every((entry) => entry.stateAfterCall.layoutEngineOptionsMode === entry.mode),
      modeFinalIsVisualNoop: finalStillShowsTrackedMarkup,
      modeOriginalWorksCorrectly: originalCorrectlyHidesInsertion,
    },
    verdict:
      "PARTIAL REPRODUCTION: config.layoutEngineOptions.trackedChanges.mode updates for every call (not a no-op at the config layer, contradicting the prior static-analysis claim), and mode:\"original\" correctly hides the tracked insertion from rendered text/markdown. But mode:\"final\" (the production-relevant \"clean view\" mode) is a visual no-op: the inserted text stays rendered with the same track-insert-dec/highlighted markup as the default review mode — no visual distinction from an unresolved tracked change.",
  };

  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    finalStillShowsTrackedMarkup
      ? "PASS (bug reproduced for mode:\"final\" - markup/highlight unchanged)"
      : "FAIL (mode:\"final\" now visually resolves tracked markup)",
  );

  assert.equal(errors.length, 0, "expected no onException/console errors while calling setTrackedChangesPreferences");
  assert.equal(finalStillShowsTrackedMarkup, true, "expected mode:\"final\" to still leave tracked-insert markup visible (the reproduced bug)");
}

await run();
