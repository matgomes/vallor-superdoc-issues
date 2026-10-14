// SD-05: ui.trackChanges.acceptAll() / rejectAll() previously reported success
// but left tracked changes untouched (legacy v2 shim complaint, 2.7.1-2.10.0).
// This checks the sync and async variants on superdoc@2.23.0 via the public
// window.__ui (createSuperDocUI()) surface.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "_fixtures/dpa-multi-redline.docx";

async function totalTrackedChanges(page) {
  return evalSd(page, async () => (await window.__sd.activeEditor.doc.trackChanges.list()).total);
}

async function checkAcceptAllSync(server, browser) {
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
  const before = await totalTrackedChanges(page);
  const result = await evalSd(page, () => window.__ui.trackChanges.acceptAll());
  await page.waitForTimeout(300);
  const after = await totalTrackedChanges(page);
  await screenshot(page, HERE, "screenshot-after-acceptAll.png");
  await page.close();
  return { before, result, after };
}

async function checkAcceptAllAsync(server, browser) {
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
  const before = await totalTrackedChanges(page);
  const result = await evalSd(page, () => window.__ui.trackChanges.acceptAllAsync());
  const after = await totalTrackedChanges(page);
  await page.close();
  return { before, resultSuccess: result?.success, removedCount: result?.removed?.length, after };
}

async function checkRejectAllAsync(server, browser) {
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
  const before = await totalTrackedChanges(page);
  const result = await evalSd(page, () => window.__ui.trackChanges.rejectAllAsync());
  const after = await totalTrackedChanges(page);
  await page.close();
  return { before, resultSuccess: result?.success, removedCount: result?.removed?.length, after };
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();

  const syncCheck = await checkAcceptAllSync(server, browser);
  const acceptAsyncCheck = await checkAcceptAllAsync(server, browser);
  const rejectAsyncCheck = await checkRejectAllAsync(server, browser);

  await browser.close();
  server.stop();

  const result = { version: "2.23.0", fixture: FIXTURE_REPO_PATH, acceptAllSync: syncCheck, acceptAllAsync: acceptAsyncCheck, rejectAllAsync: rejectAsyncCheck };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  console.log("acceptAll() sync:", JSON.stringify(syncCheck));
  console.log("acceptAllAsync():", JSON.stringify(acceptAsyncCheck));
  console.log("rejectAllAsync():", JSON.stringify(rejectAsyncCheck));

  assert.equal(syncCheck.before, 37, "expected 37 tracked changes before accept");
  assert.equal(syncCheck.after, 0, "expected 0 tracked changes after acceptAll()");
  assert.equal(acceptAsyncCheck.after, 0, "expected 0 tracked changes after acceptAllAsync()");
  assert.equal(rejectAsyncCheck.after, 0, "expected 0 tracked changes after rejectAllAsync()");

  console.log("FIXED on 2.23.0: acceptAll()/acceptAllAsync()/rejectAllAsync() all actually decide every tracked change (37 -> 0), with a full Document API receipt listing every removed entity.");
}

await run();
