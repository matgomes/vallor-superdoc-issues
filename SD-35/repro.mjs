// SD-35: after a rejected edit in a v2 collaboration room, does the session desync so that
// save/export fails with "projection-session-sync-failed" ("save barrier")?
//
// Tries three trigger candidates, each in its own fresh room (so one trigger can't confound
// another): (a) cross-cell tracked delete in one shot, (b) whole-paragraph tracked delete,
// (c) tracked-mode list conversion in collaboration. After each trigger, attempts a benign
// tracked edit elsewhere in the document, then an export, and reports whether that now fails.

import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE_FIXTURE = resolvePath(HERE, "fixture-table-bearing.docx");
const PLAIN_FIXTURE = resolvePath(HERE, "fixture-plain-paragraphs.docx");

function describeError(error) {
  if (!error || typeof error !== "object") return String(error);
  const own = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "stack") continue; // omit: only local absolute file:// frames, no diagnostic value
    own[key] = error[key];
  }
  return JSON.stringify(own);
}

function logCleanupFailure(label) {
  return (error) => console.error(`${label} failed:`, describeError(error));
}

async function withFreshRoom(fixturePath, fn) {
  const collab = await startCollabServer();
  const documentId = `sd35-${Math.random().toString(36).slice(2)}`;
  const seed = await seedRoomFromDocx(collab.url, documentId, fixturePath);
  const joined = await openDocx(fixturePath, {
    collaboration: { url: collab.url, documentId, roomMode: "join" },
  });
  let result;
  try {
    result = await fn(joined.document);
  } finally {
    await closeDocx(joined).catch(logCleanupFailure("close joiner"));
    await seed.release().catch(logCleanupFailure("release seed"));
    collab.stop();
  }
  return result;
}

async function getTableCells(document) {
  const tables = await document.blocks.list({ limit: 5, nodeTypes: ["table"] });
  const tableId = tables.blocks[0].nodeId;
  const { cells } = await document.tables.getCells({ target: { kind: "block", nodeType: "table", nodeId: tableId } });
  return cells;
}

async function attemptBenignEditThenSave(document, label, benignBlockId) {
  const benign = await document
    .insert(
      { target: { kind: "text", blockId: benignBlockId, range: { start: 0, end: 0 } }, value: "PROBE-BENIGN " },
      { changeMode: "tracked", author: { name: "Probe" } },
    )
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  // export.toDocx is refused unconditionally in any collaboration session per SD-33
  // (CAPABILITY_UNSUPPORTED/COLLABORATION_ACTIVE), independent of any prior edit — it is not a
  // specific signal for SD-35's save-barrier desync, but is recorded alongside each trigger anyway.
  const exportToDocx = await document.export
    .toDocx({ mode: "review-preserving" })
    .then((r) => ({ ok: true, byteLength: r.byteLength }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  // document.save({mode:"review-preserving"}) is the call that SD-33 found actually succeeds
  // in a live room — it is the real save path a desync could manifest through, so it's the
  // one that matters for this issue (export.toDocx above always fails regardless of history).
  const documentSave = await document
    .save({ mode: "review-preserving", out: resolvePath(HERE, `sd35-save-${label}.docx`), force: true })
    .then((r) => ({ ok: true, byteLength: r?.output?.byteLength, warnings: r?.output?.report?.warnings ?? [] }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  return { label, benignInsert: benign, saveAfter: { exportToDocx, documentSave } };
}

function pickRowZeroCells(cells) {
  return cells.filter((c) => c.rowIndex === 0).sort((a, b) => a.columnIndex - b.columnIndex);
}

// --- Trigger (a): cross-cell tracked delete, one shot ---
async function triggerCrossCellDelete(document) {
  const cells = await getTableCells(document);
  const [cellA, cellB] = pickRowZeroCells(cells);
  if (!cellA?.firstParagraphNodeId || !cellB?.firstParagraphNodeId) {
    return { trigger: "cross-cell-delete", error: "fixture has no two addressable cells in row 0" };
  }
  const deleteResult = await document
    .delete(
      {
        target: {
          kind: "selection",
          start: { kind: "text", blockId: cellA.firstParagraphNodeId, offset: 1 },
          end: { kind: "text", blockId: cellB.firstParagraphNodeId, offset: 1 },
        },
      },
      { changeMode: "tracked", author: { name: "Probe" } },
    )
    .then((r) => ({ ok: true, receipt: r }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const after = await attemptBenignEditThenSave(document, "cross-cell-delete", "57A4D0A6");
  return { trigger: "cross-cell-delete", deleteResult, ...after };
}

// --- Trigger (b): whole-paragraph tracked delete ---
async function triggerWholeParagraphDelete(document) {
  const deleteResult = await document.blocks
    .delete({ target: { kind: "block", nodeType: "paragraph", nodeId: "00000002" } }, { changeMode: "tracked" })
    .then((r) => ({ ok: true, receipt: r }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const after = await attemptBenignEditThenSave(document, "whole-paragraph-delete", "00000001");
  return { trigger: "whole-paragraph-delete", deleteResult, ...after };
}

// --- Trigger (c): list conversion in tracked mode, in collaboration ---
async function triggerListConversion(document) {
  const createResult = await document.lists
    .create(
      { mode: "fromParagraphs", target: { kind: "block", nodeType: "paragraph", nodeId: "00000004" }, kind: "bullet" },
      { changeMode: "tracked" },
    )
    .then((r) => ({ ok: true, receipt: r }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const after = await attemptBenignEditThenSave(document, "list-conversion", "00000001");
  return { trigger: "list-conversion", createResult, ...after };
}

async function runTrigger(fixturePath, triggerFn, triggerName) {
  return withFreshRoom(fixturePath, triggerFn).catch((error) => ({
    trigger: triggerName,
    fatalError: describeError(error),
  }));
}

const results = {
  crossCellDelete: await runTrigger(TABLE_FIXTURE, triggerCrossCellDelete, "cross-cell-delete"),
  wholeParagraphDelete: await runTrigger(PLAIN_FIXTURE, triggerWholeParagraphDelete, "whole-paragraph-delete"),
  listConversion: await runTrigger(PLAIN_FIXTURE, triggerListConversion, "list-conversion"),
};

console.log(JSON.stringify(results, null, 2));

function mentionsSaveBarrier(entry) {
  const text = JSON.stringify(entry ?? {});
  return /projection-session-sync-failed|save barrier|save-failed/i.test(text);
}

const anySaveBarrier = Object.values(results).some((r) => mentionsSaveBarrier(r?.saveAfter));
const REPO_ROOT = resolvePath(HERE, "..");
const serialized = JSON.stringify(
  { version: "superdoc 2.23.0 / @superdoc/sdk 2.20.0", results, verdict: anySaveBarrier ? "REPRODUCES" : "NEEDS REPRO" },
  null,
  2,
).split(REPO_ROOT).join("."); // redact local absolute path, keep repo-relative
writeFileSync(resolvePath(HERE, "results-2.23.0.json"), serialized);

console.log(
  anySaveBarrier
    ? "PASS (bug reproduced): a trigger produced a save-barrier failure"
    : "FAIL (not reproduced): no trigger desynced the save path on 2.23.0",
);
