import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser, openDoc, evalSd, screenshot, readErrors } from "../harness/lib/browser.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_REPO_PATH = "SD-06/whole-paragraph-deleted.docx";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "whole-paragraph-deleted.docx");

// Fixture: P1 (kept) / P2 (tracked-deleted, whole paragraph) / P3 (kept).
// Block ids confirmed via doc.blocks.list(): 00000001 / 00000002 / 00000003.
const INTRO_BLOCK_ID = "00000001";
const CLOSING_BLOCK_ID = "00000003";

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK ${JSON.stringify(result).slice(0, 200)}`);
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

// (a) Headless SDK: decide({kind:"range"}) across a selection that crosses a
// fully-deleted middle paragraph, vs. the sanity check that accept-by-id works.
async function headlessPass() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;
  const before = await doc.trackChanges.list({});
  const changeId = before.items[0].id;

  const rangeDecide = await attempt("decide({kind:'range'}) across P1..P3 (skips P2 segment)", () =>
    doc.trackChanges.decide({
      decision: "accept",
      target: {
        kind: "range",
        range: {
          kind: "text",
          segments: [
            { blockId: INTRO_BLOCK_ID, range: { start: 2, end: 27 } },
            { blockId: CLOSING_BLOCK_ID, range: { start: 0, end: 2 } },
          ],
        },
      },
    }),
  );

  await closeDocx(opened);

  // Sanity check on a fresh handle: accept-by-id works correctly.
  const sanityOpened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const sanityDecide = await attempt("sanity: decide({kind:'id'}) by explicit id", () =>
    sanityOpened.document.trackChanges.decide({ decision: "accept", target: { kind: "id", id: changeId } }),
  );
  const sanityAfter = await sanityOpened.document.trackChanges.list({});
  await closeDocx(sanityOpened);

  return {
    trackedChangesBefore: before.total,
    rangeDecide,
    sanityDecide,
    sanityTrackedChangesAfter: sanityAfter.total,
  };
}

// (b) Browser pass, using SuperDoc's own public selection + decide machinery:
// set a real cross-paragraph SelectionTarget via `editor.authoring.setSelectionTarget`
// (the same engine-level selection a toolbar button reads), read it back via
// `doc.selection.current()` (the exact object a toolbar button would build a
// decide() call from), then try deciding by that selection's own `range` vs. by
// its own `activeChangeIds`.
async function browserPass() {
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await openDoc(browser, server.url, { doc: FIXTURE_REPO_PATH, mode: "editing" });

  const result = await evalSd(page, async ({ introBlockId, closingBlockId }) => {
    const editor = window.__sd.activeEditor;
    const target = {
      kind: "selection",
      start: { kind: "text", blockId: introBlockId, offset: 2 },
      end: { kind: "text", blockId: closingBlockId, offset: 2 },
    };
    const setResult = await editor.authoring.setSelectionTarget({ target });
    const snapshotRaw = editor.doc.selection.current({ includeText: true });
    const snapshot = snapshotRaw && typeof snapshotRaw.then === "function" ? await snapshotRaw : snapshotRaw;

    const decideByRange = await (async () => {
      try {
        return { ok: true, result: await editor.doc.trackChanges.decide({
          decision: "accept",
          target: { kind: "range", range: snapshot.target },
        }) };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message };
      }
    })();

    const afterRangeAttempt = await editor.doc.trackChanges.list({});

    const decideByIds = await (async () => {
      try {
        return { ok: true, result: await editor.doc.trackChanges.decide({
          decision: "accept",
          target: { kind: "ids", ids: snapshot.activeChangeIds },
        }) };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message };
      }
    })();

    const afterIdsAttempt = await editor.doc.trackChanges.list({});
    const textAfter = await editor.doc.getText({});

    return {
      setResult,
      selectionSpansThreeBlocks: snapshot.target?.segments?.length === 3,
      activeChangeIds: snapshot.activeChangeIds,
      decideByRange,
      trackedChangesAfterRangeAttempt: afterRangeAttempt.total,
      decideByIds,
      trackedChangesAfterIdsAttempt: afterIdsAttempt.total,
      textAfter,
    };
  }, { introBlockId: INTRO_BLOCK_ID, closingBlockId: CLOSING_BLOCK_ID });

  await screenshot(page, resolvePath(HERE, "screenshots"), "after-decide-attempts.png");
  const errors = await readErrors(page);
  await browser.close();
  server.stop();

  return { ...result, errors };
}

const headless = await headlessPass();
const browserResult = await browserPass();

console.log("\n=== SD-06 summary ===");
console.log(JSON.stringify({ headless, browserResult }, null, 2));

assert.equal(headless.rangeDecide.ok, false, "expected decide({kind:'range'}) to be refused");
assert.equal(headless.rangeDecide.code, "TARGET_NOT_FOUND", "expected TARGET_NOT_FOUND");
assert.equal(headless.sanityDecide.ok, true, "expected accept-by-id to succeed");
assert.equal(headless.sanityTrackedChangesAfter, 0, "expected accept-by-id to remove the tracked change");

// The browser pass must reproduce the same failure using the engine's OWN
// selection snapshot (not a hand-built range), and the ids-based decide using
// that same snapshot's activeChangeIds must succeed instead.
assert.equal(browserResult.selectionSpansThreeBlocks, true, "expected the selection to span all 3 paragraphs (crossing the deleted one)");
assert.equal(browserResult.activeChangeIds.length, 2, "expected 2 raw activeChangeIds (paragraph-mark + run) for the 1 logical tracked change");
assert.equal(browserResult.decideByRange.ok, true, "expected decide({kind:'range'}) to resolve (not throw)");
assert.equal(browserResult.decideByRange.result.success, false, "expected decide({kind:'range'}) on the live selection to report success:false");
assert.equal(browserResult.decideByRange.result.failure.code, "TARGET_NOT_FOUND", "expected TARGET_NOT_FOUND on the live selection");
assert.equal(browserResult.trackedChangesAfterRangeAttempt, 1, "expected the tracked change to still be present after the failed range decide");
assert.equal(browserResult.decideByIds.ok, true, "expected decide({kind:'ids'}) using the selection's own activeChangeIds to succeed");
assert.equal(browserResult.decideByIds.result.success, true, "expected decide({kind:'ids'}) to report success:true");
assert.equal(browserResult.trackedChangesAfterIdsAttempt, 0, "expected the tracked change to be removed by the ids-based decide");
assert.deepEqual(browserResult.errors, [], `expected no onException/console errors, got ${JSON.stringify(browserResult.errors)}`);

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", headless, browserResult }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-06 — trackChanges.decide({kind:'range'}) is a silent-at-the-API-boundary no-op " +
    "(success:false TARGET_NOT_FOUND, no throw, no document change) for a selection that spans multiple " +
    "paragraphs but crosses exactly one tracked change whose middle paragraph is fully deleted — reproduced " +
    "both with a hand-built range and with the engine's own live selection snapshot. Deciding by the same " +
    "selection's activeChangeIds (kind:'ids') succeeds.",
);
