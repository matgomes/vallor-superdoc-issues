import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx, exportDocx, countTags } from "../harness/lib/sdk.mjs";
import { startServer, launchBrowser, openDoc, callDoc, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "term-clause-plain.docx");
const FIXTURE_REPO_PATH = "SD-10/term-clause-plain.docx";

async function headlessSdkCheck() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;
  const blocks = (await doc.blocks.list({ includeText: true })).blocks;
  const targetParagraph = blocks.find((block) => (block.text ?? "").startsWith("This Agreement"));

  const before = (await doc.trackChanges.list({})).total;
  const outcome = await doc
    .blocks.delete({ changeMode: "tracked", target: { kind: "block", nodeType: targetParagraph.nodeType, nodeId: targetParagraph.nodeId } })
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, code: error.code, message: error.message }));
  const after = (await doc.trackChanges.list({})).total;

  const { buffer } = await exportDocx(doc, "review-preserving");
  const tagCounts = await countTags(buffer, ["w:del", "w:ins"]);

  await closeDocx(opened);
  return { before, after, outcome, tagCounts };
}

async function browserUiCheck() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "suggesting" });

  const totalBefore = await callDoc(page, "trackChanges.list", { offset: 0, limit: 50 }).then((list) => list.total ?? list.items?.length ?? 0);

  await screenshot(page, HERE, "screenshots/01-before-selection.png");

  const paragraphBox = await page.getByText("This Agreement will govern", { exact: false }).first().boundingBox();
  const nextHeadingBox = await page.getByText("Volume", { exact: true }).first().boundingBox();
  if (!paragraphBox || !nextHeadingBox) {
    throw new Error("could not locate the target paragraph / next heading in the rendered page");
  }

  await page.mouse.move(paragraphBox.x + 2, paragraphBox.y + 3);
  await page.mouse.down();
  await page.mouse.move(nextHeadingBox.x + 2, nextHeadingBox.y + 3, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await screenshot(page, HERE, "screenshots/02-after-drag-selection.png");

  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);

  await screenshot(page, HERE, "screenshots/03-after-backspace.png");

  const errorsAfterBackspace = await readErrors(page);
  const totalAfter = await callDoc(page, "trackChanges.list", { offset: 0, limit: 50 }).then((list) => list.total ?? list.items?.length ?? 0);

  await browser.close();
  server.stop();

  return { totalBefore, totalAfter, errorsAfterBackspace };
}

const headless = await headlessSdkCheck();
console.log("\n=== headless SDK result (blocks.delete on whole paragraph) ===");
console.log(JSON.stringify(headless, null, 2));

const browserUi = await browserUiCheck().catch((error) => {
  console.log("browser UI check failed:", error.message);
  return { failed: true, message: error.message };
});
console.log("\n=== browser UI result (margin-style drag across the paragraph mark + Backspace) ===");
console.log(JSON.stringify(browserUi, null, 2));

assert.equal(headless.outcome.ok, true, "expected blocks.delete on the whole paragraph to succeed on 2.23.0 (was COMMAND_FAILED paragraph-tracked-wrapper-unsupported on 2.20/2.21)");
assert.equal(headless.after, headless.before + 1, "expected exactly one new tracked change");

assert.deepEqual(browserUi.errorsAfterBackspace, [], "expected no onException/console errors from the UI Backspace (was edit-rejected/backspace-context-unsupported on 2.20/2.21)");
assert.equal(browserUi.totalAfter, browserUi.totalBefore + 1, "expected the UI Backspace to produce exactly one new tracked change");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "FIXED", headless, browserUi }, null, 2),
);

console.log(
  "\nRESULT: SD-10 — FIXED on 2.23.0. Both doc.blocks.delete on the whole paragraph (headless) and a real mouse-drag selection spanning the paragraph mark + Backspace (browser, suggesting mode) now produce a single correct tracked paragraph deletion, with no rejection.",
);
