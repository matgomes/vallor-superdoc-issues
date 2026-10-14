import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK`, JSON.stringify(result).slice(0, 200));
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

// (a) Raw revision ids vs. the logical change id `trackChanges.list()` reports.
async function rawIdPass(server, browser) {
  const page = await openDoc(browser, server.url, { doc: "SD-07/whole-paragraph-deleted.docx", mode: "editing" });

  const result = await evalSd(page, async () => {
    const editor = window.__sd.activeEditor;
    await editor.authoring.setSelectionTarget({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 2 },
        end: { kind: "text", blockId: "00000003", offset: 2 },
      },
    });
    const snapshot = await editor.doc.selection.current({ includeText: true });
    const list = await editor.doc.trackChanges.list({});
    return { activeChangeIds: snapshot.activeChangeIds, listIds: list.items.map((item) => item.id) };
  });

  await screenshot(page, resolvePath(HERE, "screenshots"), "raw-id-split.png");
  const errors = await readErrors(page);
  await page.close();
  return { ...result, errors };
}

// (b) A paragraph-level tracked change (structural paragraph-mark-deletion,
// produced by SuperDoc's own tracked `blocks.merge`, see make-fixture.mjs) is
// fully inside the selection but omitted from `activeChangeIds` entirely.
async function paragraphLevelPass(server, browser) {
  const page = await openDoc(browser, server.url, { doc: "SD-07/paragraph-mark-merge-tracked.docx", mode: "editing" });

  const result = await evalSd(page, async () => {
    const editor = window.__sd.activeEditor;
    await editor.authoring.setSelectionTarget({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 2 },
        end: { kind: "text", blockId: "00000003", offset: 2 },
      },
    });
    const snapshot = await editor.doc.selection.current({ includeText: true });
    const list = await editor.doc.trackChanges.list({});
    return {
      activeChangeIds: snapshot.activeChangeIds,
      listTotal: list.total,
      listTypes: list.items.map((item) => ({ type: item.type, subtype: item.subtype })),
      selectionSpansThreeBlocks: snapshot.target?.segments?.length === 3,
    };
  });

  await screenshot(page, resolvePath(HERE, "screenshots"), "paragraph-level-change-omitted.png");
  const errors = await readErrors(page);
  await page.close();
  return { ...result, errors };
}

// (c) Headless sanity: the paragraph-mark change is acceptable by its real
// `trackChanges.list()` id, but not by an empty ids array (what a caller gets
// if it blindly forwards the selection's activeChangeIds).
async function headlessSanity() {
  const opened = await openDocx(resolvePath(HERE, "paragraph-mark-merge-tracked.docx"));
  const doc = opened.document;
  const before = await doc.trackChanges.list({});
  const changeId = before.items[0].id;

  const emptyIdsDecide = await attempt("decide({kind:'ids', ids:[]}) — what the empty activeChangeIds gives a caller", () =>
    doc.trackChanges.decide({ decision: "accept", target: { kind: "ids", ids: [] } }),
  );
  const byRealId = await attempt("decide({kind:'id'}) by the real trackChanges.list() id", () =>
    doc.trackChanges.decide({ decision: "accept", target: { kind: "id", id: changeId } }),
  );
  const after = await doc.trackChanges.list({});
  await closeDocx(opened);
  return { listedType: before.items[0].type, listedSubtype: before.items[0].subtype, emptyIdsDecide, byRealId, trackedChangesAfter: after.total };
}

const server = await startServer();
const browser = await launchBrowser();
const rawIds = await rawIdPass(server, browser);
const paragraphLevel = await paragraphLevelPass(server, browser);
await browser.close();
server.stop();
const sanity = await headlessSanity();

console.log("\n=== SD-07 summary ===");
console.log(JSON.stringify({ rawIds, paragraphLevel, sanity }, null, 2));

assert.equal(rawIds.activeChangeIds.length, 2, "expected 2 raw activeChangeIds for the 1 logical deletion");
assert.equal(rawIds.listIds.length, 1, "expected trackChanges.list() to report 1 logical change");
const matchingIds = rawIds.activeChangeIds.filter((id) => rawIds.listIds.includes(id));
assert.equal(matchingIds.length, 1, "expected exactly 1 of the 2 raw activeChangeIds to match the logical list() id — the other is a non-canonical per-revision alias list() never reports");
assert.deepEqual(rawIds.errors, [], "expected no errors in the raw-id pass");

assert.equal(paragraphLevel.selectionSpansThreeBlocks, true, "expected the selection to span all 3 blocks");
assert.equal(paragraphLevel.listTotal, 1, "expected trackChanges.list() to report the paragraph-mark deletion");
assert.deepEqual(paragraphLevel.listTypes, [{ type: "structural", subtype: "paragraph-mark-deletion" }], "expected a structural paragraph-mark-deletion change");
assert.deepEqual(paragraphLevel.activeChangeIds, [], "expected activeChangeIds to OMIT the paragraph-level change entirely");
assert.deepEqual(paragraphLevel.errors, [], "expected no errors in the paragraph-level pass");

assert.equal(sanity.emptyIdsDecide.ok, false, "expected decide({kind:'ids', ids:[]}) to be refused");
assert.equal(sanity.byRealId.ok, true, "expected decide by the real trackChanges.list() id to succeed");
assert.equal(sanity.trackedChangesAfter, 0, "expected the paragraph-mark change to be removable by its real id");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", rawIds, paragraphLevel, sanity }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-07 — selection.current().activeChangeIds (a) reports 2 raw per-revision ids for 1 " +
    "logical text deletion, only 1 of which matches the id trackChanges.list() reports (the other is a " +
    "non-canonical per-revision alias list() never surfaces), and (b) omits paragraph-level changes entirely " +
    "(a structural paragraph-mark-deletion fully inside the selection yields activeChangeIds:[] even though " +
    `trackChanges.list() reports it) — on ${SUPERDOC_VERSION}.`,
);
