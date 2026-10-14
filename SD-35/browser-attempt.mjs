// SD-35 — browser-path attempt (requested follow-up): the headless-SDK matrix in repro.mjs could
// not reach the live browser editor's own save/autosave pipeline. This drives the real harness
// page, joined to a live collaboration room, in "suggesting" mode: triggers a cross-cell edit (the
// known refusal class), then keeps editing and saving in the same room, watching
// window.__errors / onException for "structural projection", "span drift", "save-failed", or
// "projection-session-sync-failed" at every step.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, readErrors, screenshot, callDoc, evalSd } from "../harness/lib/browser.mjs";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..");
const FIXTURE_REPO_PATH = "SD-35/fixture-table-bearing.docx";
const FIXTURE_ABS = resolvePath(HERE, "fixture-table-bearing.docx");
const SCREENSHOTS_DIR = resolvePath(HERE, "screenshots");
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function redact(value) {
  return JSON.parse(JSON.stringify(value).split(REPO_ROOT).join("."));
}

function watchHit(errors) {
  const text = JSON.stringify(errors).toLowerCase();
  return ["structural projection", "span drift", "save-failed", "projection-session-sync-failed"].filter((needle) =>
    text.includes(needle),
  );
}

async function recordStep(page, steps, label) {
  const errors = await readErrors(page);
  await screenshot(page, SCREENSHOTS_DIR, `${label}.png`);
  const hits = watchHit(errors);
  steps.push({ label, errors, watchHits: hits });
  console.log(`[${label}] errors=${errors.length} watchHits=${JSON.stringify(hits)}`);
}

async function pressRepeatedly(page, key, times) {
  await Array.from({ length: times }).reduce(
    (chain) => chain.then(() => page.keyboard.press(key)).then(() => page.waitForTimeout(300)),
    Promise.resolve(),
  );
}

// NOTE: v2-stage is a virtualized renderer with no semantic <table>/<td> DOM, and the fixture's
// table sits deep inside an 11-page document, so this scrolls page-by-page until the cell text is
// actually painted (a real, non-zero-width bounding box, as opposed to the hidden full-document
// accessibility mirror, which matches every getByText query at a zero-width box regardless of scroll).
async function paintedBoundingBox(page, text) {
  const box = await page
    .getByText(text, { exact: false })
    .first()
    .boundingBox()
    .catch((error) => {
      console.log(`boundingBox probe for "${text}" failed (non-fatal): ${String(error?.message ?? error)}`);
      return null;
    });
  return box && box.width > 5 ? box : null;
}

async function scrollUntilPainted(page, text, maxPresses) {
  const attempts = Array.from({ length: maxPresses }, (unused, index) => index);
  return attempts.reduce(async (accPromise) => {
    const found = await accPromise;
    if (found) return found;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(200);
    return paintedBoundingBox(page, text);
  }, Promise.resolve(null));
}

// Trigger (a): select across the row-0 cell boundary ("CORRAN:" / "CUSTOMER:") and press Backspace
// — the known cross-cell refusal class this issue's background report names as one way to reach
// "This edit couldn't be completed. Adjust the selection and try again."
async function attemptUiCrossCellBackspace(page) {
  const stage = page.locator('[data-role="v2-stage"]');
  if ((await stage.count()) === 0) return { attempted: false };
  await stage.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.waitForTimeout(300);
  const cellABox = await scrollUntilPainted(page, "CORRAN:", 25);
  if (!cellABox) {
    return { attempted: false, reason: "could not scroll the table's row-0 cell text into a painted (non-mirror) state within the attempt budget" };
  }
  await page.mouse.click(cellABox.x + 5, cellABox.y + cellABox.height / 2);
  const cellBBox = await paintedBoundingBox(page, "CUSTOMER:");
  if (!cellBBox) return { attempted: false, reason: "row-0 col-1 cell text never painted after row-0 col-0 did" };
  await page.mouse.click(cellBBox.x + 5, cellBBox.y + cellBBox.height / 2, { modifiers: ["Shift"] });
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(800);
  return { attempted: true };
}

async function deleteCellText(page, cell) {
  const result = await callDoc(
    page,
    "delete",
    {
      target: {
        kind: "selection",
        start: { kind: "text", blockId: cell.firstParagraphNodeId, offset: 0 },
        end: { kind: "text", blockId: cell.firstParagraphNodeId, offset: 3 },
      },
    },
    { changeMode: "tracked" },
  ).catch((error) => ({ threw: true, message: String(error?.message ?? error) }));
  return { cell: cell.nodeId, columnIndex: cell.columnIndex, result };
}

async function replayPerCellTrackedDeletes(page) {
  // row 1, a different row than trigger (a) used, exercising fresh, untouched cell content
  const row1Cells = await evalSd(page, async () => {
    const doc = window.__sd.activeEditor.doc;
    const tables = await doc.blocks.list({ nodeTypes: ["table"] });
    const table = tables.blocks[0];
    const { cells } = await doc.tables.getCells({ nodeId: table.nodeId });
    return cells.filter((c) => c.rowIndex === 1).sort((a, b) => a.columnIndex - b.columnIndex);
  });
  return Promise.all(row1Cells.map((cell) => deleteCellText(page, cell)));
}

async function findSaveShapedMethods(page) {
  return page.evaluate(() => {
    const prototypeChain = (object) => (!object || object === Object.prototype ? [] : [object, ...prototypeChain(Object.getPrototypeOf(object))]);
    const keysOf = (object) => [...new Set(prototypeChain(object).flatMap((entry) => Object.getOwnPropertyNames(entry)))];
    const sdKeys = keysOf(window.__sd).filter((key) => /save|persist|sync|collab/i.test(key));
    const uiKeys = keysOf(window.__ui).filter((key) => /save|persist|sync|collab/i.test(key));
    return { sdKeys, uiKeys };
  });
}

async function main() {
  const collab = await startCollabServer();
  const documentId = `sd35-browser-${Date.now()}`;
  const seed = await seedRoomFromDocx(collab.url, documentId, FIXTURE_ABS);

  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, {
    doc: FIXTURE_REPO_PATH,
    mode: "suggesting",
    collab: `${collab.url},${documentId},join`,
  });

  const steps = [];
  await recordStep(page, steps, "00-initial");

  const uiCrossCellAttempted = await attemptUiCrossCellBackspace(page);
  await recordStep(page, steps, "01-after-ui-cross-cell-backspace");

  // Keep editing in the room after the trigger: replay as per-cell tracked deletes via the live
  // editor's own doc API, then continue with undo/redo and more typing, then keep saving.
  const perCellDeletes = await replayPerCellTrackedDeletes(page);
  await recordStep(page, steps, "02-after-doc-api-per-cell-replay");

  await pressRepeatedly(page, "ControlOrMeta+z", 2);
  await pressRepeatedly(page, "ControlOrMeta+Shift+z", 2);
  await recordStep(page, steps, "03-after-undo-redo");

  await page.keyboard.type("PROBE-TYPED-TEXT");
  const didType = true;
  await recordStep(page, steps, "04-after-typing-in-cell");

  const exportResult = await page
    .evaluate(async () => {
      const blob = await window.__sd.export({ exportType: ["docx"], triggerDownload: false });
      return { ok: true, byteLength: blob.size };
    })
    .catch((error) => ({ ok: false, message: String(error?.message ?? error) }));
  const saveShapedMethods = await findSaveShapedMethods(page);
  await recordStep(page, steps, "05-after-export");

  // window.__sd.save() is a save-shaped method on the browser instance itself (distinct from
  // .export()) — call it directly, racing a 15s timeout, as a second save attempt in the same
  // room after the trigger, since a permanently desynced save barrier should fail here too.
  const sdSaveResult = saveShapedMethods.sdKeys.includes("save")
    ? await page.evaluate(() =>
        Promise.race([
          window.__sd.save().then((value) => ({ outcome: "resolved", value })),
          new Promise((resolve) => setTimeout(() => resolve({ outcome: "timed-out-after-15s" }), 15000)),
        ]).catch((error) => ({ outcome: "threw", message: String(error?.message ?? error) })),
      )
    : { outcome: "not-available" };
  await recordStep(page, steps, "06-after-sd-save-call");

  // A second save round-trip: a further benign edit followed by another window.__sd.save() call,
  // to check whether the room is permanently desynced (fails every time after) vs. transiently so.
  await page.keyboard.type(" PROBE-SECOND-EDIT");
  await recordStep(page, steps, "07-after-second-edit");
  const secondSaveResult = saveShapedMethods.sdKeys.includes("save")
    ? await page.evaluate(() =>
        Promise.race([
          window.__sd.save().then((value) => ({ outcome: "resolved", value })),
          new Promise((resolve) => setTimeout(() => resolve({ outcome: "timed-out-after-15s" }), 15000)),
        ]).catch((error) => ({ outcome: "threw", message: String(error?.message ?? error) })),
      )
    : { outcome: "not-available" };
  await recordStep(page, steps, "08-after-second-sd-save-call");

  await browser.close();
  server.stop();
  await seed.release();
  collab.stop();

  const allWatchHits = steps.flatMap((step) => step.watchHits);
  const triggered = allWatchHits.length > 0;

  const results = {
    superdocTarget: "2.23.0",
    sdkTarget: "@superdoc/sdk 2.20.0",
    timestamp: new Date().toISOString(),
    mode: "suggesting (live collaboration room, bare Hocuspocus)",
    uiCrossCellAttempted,
    perCellDeletes,
    typedInCell: didType,
    exportResult,
    saveShapedMethodsFound: saveShapedMethods,
    sdSaveResult,
    secondSaveResult,
    steps,
    watchHitsAnywhere: allWatchHits,
  };
  writeFileSync(resolvePath(HERE, "browser-attempt-results.json"), JSON.stringify(redact(results), null, 2));
  console.log(JSON.stringify(redact(results), null, 2));
  console.log(
    triggered
      ? `PASS (bug reproduced in browser): watch strings seen: ${JSON.stringify(allWatchHits)}`
      : "FAIL (NEEDS REPRO in browser too): no structural-projection/save-barrier text observed at any step",
  );
}

await main();
