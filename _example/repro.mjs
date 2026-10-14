import { strict as assert } from "node:assert";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, callDoc, screenshot, readErrors } from "../harness/lib/browser.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO_PATH = "_example/sample.docx";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "sample.docx");

async function checkInBrowser() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });
  const list = await callDoc(page, "trackChanges.list", { offset: 0, limit: 10 });
  const total = list.total ?? list.items?.length ?? 0;
  await screenshot(page, HERE, "screenshot.png");
  const errors = await readErrors(page);
  await browser.close();
  server.stop();
  assert.equal(total, 2, `expected 2 tracked changes in the browser, got ${total}`);
  assert.deepEqual(errors, [], `expected no onException/console errors, got ${JSON.stringify(errors)}`);
  console.log(`browser check passed: trackChanges.list() total = ${total}, screenshot written`);
}

async function checkHeadlessSdk() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const list = await opened.document.trackChanges.list();
  await closeDocx(opened);
  assert.equal(list.total, 2, `expected 2 tracked changes via the SDK, got ${list.total}`);
  console.log(`headless SDK check passed: trackChanges.list() total = ${list.total}`);
}

await checkInBrowser();
await checkHeadlessSdk();
console.log("SMOKE OK");
