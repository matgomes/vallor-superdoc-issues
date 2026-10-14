import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const FIXTURE_REPO_PATH = "SD-17/fixture-paragraph-mark-deleted-twice.docx";

async function waitForTrackChangesReady(page) {
  await page.waitForFunction(() => window.__ui?.trackChanges?.getSnapshot()?.status === "ready", null, { timeout: 15000 });
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "suggesting" }, { timeoutMs: 60000 });
  await waitForTrackChangesReady(page);

  const items = await page.evaluate(() =>
    window.__ui.trackChanges.list().map((item) => ({ id: item.id, excerpt: item.excerpt, type: item.type, subtype: item.subtype })),
  );
  await screenshot(page, SCREENSHOTS_DIR, "card-before.png");

  const structuralItem = items.find((item) => item.subtype === "paragraph-mark-deletion");
  assert.ok(structuralItem, `expected a paragraph-mark-deletion change in the fixture, got ${JSON.stringify(items)}`);
  const controlResult = await page.evaluate((id) => window.__ui.trackChanges.acceptAsync(id), structuralItem.id);
  const errorsAfterControl = await readErrors(page);

  const secondPage = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "suggesting" }, { timeoutMs: 60000 });
  await waitForTrackChangesReady(secondPage);
  const beforeCount = await secondPage.evaluate(() => window.__ui.trackChanges.list().length);
  const refusedResult = await secondPage.evaluate(() => window.__ui.trackChanges.acceptAllAsync());
  const errorsAfterRefusal = await readErrors(secondPage);
  await secondPage.waitForTimeout(1500);
  const snapshotAfterRefusal = await secondPage.evaluate(() => window.__ui.trackChanges.getSnapshot());
  await screenshot(secondPage, SCREENSHOTS_DIR, "card-after-refused-acceptall.png");

  await browser.close();
  server.stop();

  const results = {
    control_single_accept_on_structural_change: { targetId: structuralItem.id, result: controlResult, errorsObserved: errorsAfterControl },
    refused_accept_all: {
      beforeCount,
      result: refusedResult,
      errorsObserved: errorsAfterRefusal,
      snapshotAfterRefusal,
    },
  };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(results, null, 2));

  assert.equal(controlResult?.success, true, `control: single accept on the structural change should succeed, got ${JSON.stringify(controlResult)}`);
  assert.deepEqual(errorsAfterControl, [], "control accept should not raise any error");

  assert.equal(refusedResult?.success, false, `expected acceptAllAsync() to be refused, got ${JSON.stringify(refusedResult)}`);
  assert.equal(refusedResult?.failure?.code, "INVALID_INPUT", `expected failure.code INVALID_INPUT, got ${JSON.stringify(refusedResult)}`);
  assert.deepEqual(errorsAfterRefusal, [], "the refused decision raised zero onException / window.error / console.error events");
  assert.equal(snapshotAfterRefusal.items.length, 0, "the reactive trackChanges snapshot also regresses to an empty list after the refusal, with no diagnostic");

  console.log("PASS: acceptAllAsync() on the doubled-paragraph-mark fixture returns a typed failure receipt");
  console.log(`  -> ${JSON.stringify(refusedResult)}`);
  console.log("PASS: zero observable events (onException / window.error / console.error) were raised by the refusal");
  console.log("PASS: the reactive ui.trackChanges snapshot regresses to an empty, unsettled list after the refusal, with no error surfaced there either");
  console.log("NOTE: the bare SuperDoc mount in this harness renders no Accept/Reject buttons on the inline tracked-change card itself (see README) -");
  console.log("      the failure was triggered through window.__ui.trackChanges.acceptAllAsync(), the public command surface a host app's own buttons call.");
}

await run();
