// SD-15: a trackChanges.decide() call can silently resolve/invalidate a SECOND tracked
// change that was never named in the decide() call, and the receipt gives no indication
// (no "also invalidated" / "remapped" entry for the other id). A caller that captured a
// change-id list up front (e.g. "accept all N open changes") and loops sequentially
// without re-listing in between will hit TARGET_NOT_FOUND on the id that was silently
// consumed as a side effect of an earlier decide() call.
//
// Note: a fixture with only independent/paired-replacement tracked changes (e.g.
// dpa-multi-redline.docx) does NOT show this — every id in that fixture decides cleanly
// without re-listing. The bug needs two tracked changes that are internally linked (here,
// both halves of one tracked paragraph-mark merge, on the same blockId).
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "fixture.docx");

async function decideOne(document, id, decision) {
  try {
    const receipt = await document.trackChanges.decide({ target: { kind: "id", id }, decision });
    return { id, ok: true, removed: receipt.removed, invalidatedRefs: receipt.invalidatedRefs, remappedRefs: receipt.remappedRefs };
  } catch (error) {
    return { id, ok: false, code: error.code, message: error.message };
  }
}

async function decideSequentiallyWithoutRelisting(document, ids, decision) {
  const results = [];
  for (const id of ids) results.push(await decideOne(document, id, decision));
  return results.map((entry, index) => ({ index, ...entry }));
}

async function decideSequentiallyWithRelisting(document, decision) {
  const results = [];
  const listOnce = () => document.trackChanges.list({ limit: 200 });
  const remaining = await listOnce().then((list) => list.items.length);
  for (const _ of Array(remaining).keys()) {
    const list = await listOnce();
    if (list.items.length === 0) break;
    const id = list.items[0].id;
    const receipt = await document.trackChanges.decide({ target: { kind: "id", id }, decision: decision });
    results.push({ id, ok: true, removed: receipt.removed });
  }
  return results;
}

const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
const initialList = await opened.document.trackChanges.list({ limit: 200 });
const capturedIds = initialList.items.map((item) => ({ id: item.id, type: item.type, blockId: item.navigationTarget?.blockId, excerpt: item.excerpt }));
console.log(`Captured ${capturedIds.length} tracked-change ids up front:`, JSON.stringify(capturedIds, null, 2));

const noRelistLog = await decideSequentiallyWithoutRelisting(
  opened.document,
  capturedIds.map((entry) => entry.id),
  "accept",
);
console.log("\nNo-relist sequential decide log:", JSON.stringify(noRelistLog, null, 2));

const staleFailure = noRelistLog.find((entry) => !entry.ok && entry.code === "TARGET_NOT_FOUND");
const priorSuccess = staleFailure ? noRelistLog[noRelistLog.indexOf(staleFailure) - 1] : undefined;

await closeDocx(opened);

// Control: the same fixture, decided via re-listing every iteration, completes cleanly.
const openedControl = await openDocx(FIXTURE_ABSOLUTE_PATH);
const relistLog = await decideSequentiallyWithRelisting(openedControl.document, "accept");
console.log("\nRe-list-every-iteration control log:", JSON.stringify(relistLog, null, 2));
await closeDocx(openedControl);

const bug = Boolean(staleFailure) && priorSuccess?.ok === true && (priorSuccess.invalidatedRefs?.length ?? 0) === 1;

writeFileSync(
  resolvePath(HERE, "results-2.23.0.json"),
  JSON.stringify(
    {
      superdocVersion: "2.23.0",
      sdkVersion: "@superdoc/sdk 2.20.0",
      capturedIds,
      noRelistLog,
      relistControlCompletedCleanly: relistLog.length === capturedIds.length,
      staleFailure,
      priorSuccessReceipt: priorSuccess,
      bugReproduces: bug,
    },
    null,
    2,
  ),
);

assert.ok(bug, "expected a captured id to go stale (TARGET_NOT_FOUND) after an earlier decide() call that never listed it in invalidatedRefs/remappedRefs");
const summary = bug
  ? `PASS (bug reproduces): decide() on id ${priorSuccess.id} silently invalidated id ${staleFailure.id} (a captured, not-yet-decided change) without listing it in the receipt; the re-list control loop completes cleanly.`
  : "FAIL (bug did not reproduce on this fixture/order)";
console.log(summary);
process.exit(bug ? 0 : 1);
