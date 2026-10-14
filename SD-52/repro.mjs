import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
const FIXTURE_REPO_PATH = "SD-52/long-doc-early-comment.docx";

async function readCommentsSnapshot(page) {
  return evalSd(page, () => window.__ui.comments.getSnapshot());
}

async function readTrackChangesSnapshot(page) {
  return evalSd(page, () => window.__ui.trackChanges.getSnapshot());
}

async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.mouse.wheel(0, 2_000_000);
  await page.waitForTimeout(1500);
}

async function scrollToTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, -2_000_000);
  await page.waitForTimeout(1500);
}

async function run() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "editing",
    commentsDisplay: "sidebar",
  });
  await page.waitForTimeout(1500);

  const atTop = await readCommentsSnapshot(page);
  const trackChangesAtTop = await readTrackChangesSnapshot(page);
  await screenshot(page, SCREENSHOTS_DIR, "01-at-top.png");

  await scrollToBottom(page);
  const atBottom = await readCommentsSnapshot(page);
  const trackChangesAtBottom = await readTrackChangesSnapshot(page);
  await screenshot(page, SCREENSHOTS_DIR, "02-at-bottom.png");

  await scrollToTop(page);
  const backAtTop = await readCommentsSnapshot(page);
  await screenshot(page, SCREENSHOTS_DIR, "03-back-at-top.png");

  const errors = await readErrors(page);
  await browser.close();
  server.stop();

  const result = {
    atTop: { total: atTop.total, listStatus: atTop.listStatus },
    atBottom: { total: atBottom.total, listStatus: atBottom.listStatus },
    backAtTop: { total: backAtTop.total, listStatus: backAtTop.listStatus },
    trackChangesAtTop: { total: trackChangesAtTop.total, listStatus: trackChangesAtTop.listStatus },
    trackChangesAtBottom: { total: trackChangesAtBottom.total, listStatus: trackChangesAtBottom.listStatus },
    errors,
  };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  const bugReproduces = atTop.total === 1 && atBottom.total === 0;
  assert.equal(errors.length, 0, `expected no onException/console errors, got ${JSON.stringify(errors)}`);
  console.log(
    bugReproduces
      ? "PASS (bug reproduced): ui.comments.getSnapshot().total drops from 1 to 0 once scrolled to the bottom of a long document, on 2.23.0"
      : `FAIL (bug not reproduced as expected): atTop.total=${atTop.total} atBottom.total=${atBottom.total}`,
  );
}

await run();
