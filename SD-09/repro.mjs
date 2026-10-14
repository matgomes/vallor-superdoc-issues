import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";
import { startServer, launchBrowser, openDoc, callDoc, screenshot, readErrors } from "../harness/lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "schedule-of-fees.docx");
const FIXTURE_REPO_PATH = "SD-09/schedule-of-fees.docx";

function crossCellSelection(startBlockId, startOffset, endBlockId, endOffset) {
  return {
    kind: "selection",
    start: { kind: "text", blockId: startBlockId, offset: startOffset },
    end: { kind: "text", blockId: endBlockId, offset: endOffset },
  };
}

async function cellsByRowCol(doc) {
  const cells = (await doc.extract()).blocks.filter((block) => block.tableContext);
  return (row, column) => cells.find((cell) => cell.tableContext.rowIndex === row && cell.tableContext.columnIndex === column);
}

async function attemptCrossCellDelete(label, startRow, startCol, startOffset, endRow, endCol) {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;
  const byRowCol = await cellsByRowCol(doc);
  const start = byRowCol(startRow, startCol);
  const end = byRowCol(endRow, endCol);
  const target = crossCellSelection(start.nodeId, startOffset, end.nodeId, end.text.length);

  const outcome = await doc
    .delete({ target, behavior: "exact" }, { changeMode: "tracked" })
    .then((result) => ({ ok: true, deletedText: result.receipt?.resolution?.text, txId: result.receipt?.txId }))
    .catch((error) => ({ ok: false, code: error.code, message: error.message }));

  const trackedChangeTotal = (await doc.trackChanges.list({})).total;
  await closeDocx(opened);

  console.log(`${label}: ${JSON.stringify(outcome)} | trackChanges.total=${trackedChangeTotal}`);
  return { ...outcome, trackedChangeTotal };
}

async function headlessSdkCheck() {
  const sameRowPartial = await attemptCrossCellDelete("same-row, partial range (Hosting[1:] -> Fee[:-1])", 1, 0, 1, 1, 1);
  const sameRowFull = await attemptCrossCellDelete("same-row, full cell-to-cell range (Hosting[0:] -> Fee[:])", 1, 0, 0, 1, 1);
  const crossRowSameColumn = await attemptCrossCellDelete("cross-row, same column (Hosting[0:] -> Support[:])", 1, 0, 0, 2, 0);
  return { sameRowPartial, sameRowFull, crossRowSameColumn };
}

async function browserUiCheck() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "suggesting" });

  const totalBefore = await callDoc(page, "trackChanges.list", { offset: 0, limit: 50 }).then((list) => list.total ?? list.items?.length ?? 0);

  const hostingBox = await page.getByText("Hosting", { exact: true }).first().boundingBox();
  const feeBox = await page.getByText("900 per month", { exact: true }).first().boundingBox();
  if (!hostingBox || !feeBox) {
    throw new Error("could not locate the Hosting / 900 per month table cells in the rendered page");
  }

  await screenshot(page, HERE, "screenshots/01-before-selection.png");

  await page.mouse.move(hostingBox.x + 5, hostingBox.y + hostingBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(feeBox.x + feeBox.width - 5, feeBox.y + feeBox.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await screenshot(page, HERE, "screenshots/02-after-cross-cell-selection.png");

  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);

  await screenshot(page, HERE, "screenshots/03-after-backspace.png");

  const errorsAfterBackspace = await readErrors(page);
  const totalAfter = await callDoc(page, "trackChanges.list", { offset: 0, limit: 50 }).then((list) => list.total ?? list.items?.length ?? 0);
  const cellTextAfter = await page.evaluate(() => Array.from(document.querySelectorAll("td")).map((cell) => cell.textContent));

  await browser.close();
  server.stop();

  return { totalBefore, totalAfter, errorsAfterBackspace, cellTextAfter };
}

const headless = await headlessSdkCheck();
console.log("\n=== headless SDK result (doc.delete text-range API) ===");
console.log(JSON.stringify(headless, null, 2));

const browserUi = await browserUiCheck().catch((error) => {
  console.log("browser UI check failed:", error.message);
  return { failed: true, message: error.message };
});
console.log("\n=== browser UI result (mouse drag + Backspace, suggesting mode) ===");
console.log(JSON.stringify(browserUi, null, 2));

assert.equal(headless.sameRowPartial.ok, true, "expected the SDK-level same-row cross-cell delete to succeed on 2.23.0");
assert.equal(headless.sameRowFull.ok, true, "expected the SDK-level same-row full cross-cell delete to succeed on 2.23.0");
assert.equal(headless.crossRowSameColumn.ok, true, "expected the SDK-level cross-row same-column delete to succeed on 2.23.0");

assert.ok(
  browserUi.errorsAfterBackspace?.some((error) => error.code === "edit-rejected"),
  "expected the browser UI Backspace-across-cells path to still be rejected with edit-rejected",
);
assert.equal(browserUi.totalBefore, browserUi.totalAfter, "expected no tracked change to be written by the rejected UI edit");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify(
    {
      superdocVersion: SUPERDOC_VERSION,
      verdict: "REPRODUCES (UI/editor path) / FIXED (headless SDK text-range path)",
      headless,
      browserUi,
    },
    null,
    2,
  ),
);

console.log(
  "\nRESULT: SD-09 — the engine-level doc.delete() text-range API now performs a correct cross-cell tracked delete on 2.23.0 (FIXED vs. the 2.20/2.21 COMMAND_FAILED text-range-cross-table-cell). The editor's own mouse-drag-select + Backspace path still rejects the exact same edit with edit-rejected (\"This edit couldn't be completed. Adjust the selection and try again.\") — the end-user-visible bug persists.",
);
