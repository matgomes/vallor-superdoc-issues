// SD-34: table structural-projection drift after cross-cell tracked deletes replayed
// one block at a time inside a table, inside a collaboration room. "Try to reproduce" issue —
// NEEDS REPRO with the full matrix is an acceptable outcome if nothing triggers it.
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..");
const FIXTURE = resolvePath(HERE, "fixture-table-bearing-agreement.docx");

// The SDK echoes the absolute fixture path (and absolute file:// stack frames into
// node_modules) back into receipts and error objects. Redact the local filesystem
// prefix before anything is written to disk or printed, per the repo's no-absolute-
// local-paths rule.
function redactLocalPaths(value) {
  return JSON.parse(JSON.stringify(value).split(REPO_ROOT).join("."));
}

function describeError(error) {
  const plain = { message: String(error?.message ?? error), name: error?.name, code: error?.code, reason: error?.reason };
  try {
    plain.raw = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  } catch {
    // ignore non-serializable error shapes
  }
  return plain;
}

function textPoint(blockId, offset) {
  return { kind: "text", blockId, offset };
}

async function getFirstTwoCells(document) {
  const tables = await document.blocks.list({ nodeTypes: ["table"] });
  const table = tables.blocks[0];
  if (!table) throw new Error("fixture has no table block");
  const cellsResult = await document.tables.getCells({ nodeId: table.nodeId });
  const cellA = cellsResult.cells.find((c) => c.rowIndex === 0 && c.columnIndex === 0);
  const cellB = cellsResult.cells.find((c) => c.rowIndex === 0 && c.columnIndex === 1);
  if (!cellA || !cellB) throw new Error(`could not find row-0 col-0/col-1 cells; got ${JSON.stringify(cellsResult.cells)}`);
  const paraIds = [cellA.firstParagraphNodeId, cellB.firstParagraphNodeId];
  const paras = await document.blocks.list({ nodeIds: paraIds, includeText: true });
  const lengths = Object.fromEntries(paras.blocks.map((b) => [b.nodeId, (b.text ?? "").length]));
  return { cellA, cellB, lengthA: lengths[cellA.firstParagraphNodeId] ?? 1, lengthB: lengths[cellB.firstParagraphNodeId] ?? 1 };
}

// NOTE: in a live collaboration room, document.export.toDocx is refused unconditionally
// (CAPABILITY_UNSUPPORTED/COLLABORATION_ACTIVE, per SD-33) regardless of edit history, so it
// can't distinguish a healthy room from a projection-drift-desynced one. document.save({mode:
// "review-preserving"}) is the call SD-33 confirmed actually succeeds from inside a room, so it's
// the one that matters for detecting a save-barrier/projection failure there; exportToDocx is
// still attempted (and will still work) for the standalone (non-collaboration) cases.
async function attemptSave(document, outPath) {
  const exportToDocx = await document.export
    .toDocx({ mode: "review-preserving" })
    .then((result) => ({ ok: true, byteLength: result.byteLength ?? result.contentBase64?.length, warnings: result.report?.warnings ?? [] }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const documentSave = await document
    .save({ mode: "review-preserving", out: outPath, force: true })
    .then((result) => ({ ok: true, byteLength: result?.output?.byteLength, warnings: result?.output?.report?.warnings ?? [] }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  return { exportToDocx, documentSave };
}

async function caseA(document) {
  const { cellA, cellB, lengthB } = await getFirstTwoCells(document);
  try {
    const result = await document.delete({
      changeMode: "tracked",
      target: { kind: "selection", start: textPoint(cellA.firstParagraphNodeId, 0), end: textPoint(cellB.firstParagraphNodeId, lengthB) },
    });
    return { attempted: "one-shot cross-cell delete", ok: true, result };
  } catch (error) {
    return { attempted: "one-shot cross-cell delete", ok: false, error: describeError(error) };
  }
}

async function caseB(document) {
  const { cellA, cellB, lengthA, lengthB } = await getFirstTwoCells(document);
  const perCell = [];
  for (const [label, blockId, length] of [
    ["cellA", cellA.firstParagraphNodeId, lengthA],
    ["cellB", cellB.firstParagraphNodeId, lengthB],
  ]) {
    try {
      const result = await document.delete({
        changeMode: "tracked",
        target: { kind: "selection", start: textPoint(blockId, 0), end: textPoint(blockId, length) },
      });
      perCell.push({ cell: label, ok: true, result });
    } catch (error) {
      perCell.push({ cell: label, ok: false, error: describeError(error) });
    }
  }
  const save = await attemptSave(document, resolvePath(HERE, "sd34-save-caseB.docx"));
  return { attempted: "sequential per-cell tracked delete, then save", perCell, save };
}

async function caseC(document) {
  const { cellA } = await getFirstTwoCells(document);
  const target = { kind: "block", nodeType: "paragraph", nodeId: cellA.firstParagraphNodeId };
  const edit = await document.blocks
    .delete({ target, changeMode: "tracked" })
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const undo = await document.history
    .undo()
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const redo = await document.history
    .redo()
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error: describeError(error) }));
  const save = await attemptSave(document, resolvePath(HERE, "sd34-save-caseC.docx"));
  return { attempted: "edit table cell, undo, redo, then save", edit, undo, redo, save };
}

async function runStandalone(name, fn) {
  const opened = await openDocx(FIXTURE);
  try {
    return { case: name, mode: "standalone", result: await fn(opened.document) };
  } finally {
    await closeDocx(opened).catch((error) => console.error(`close failed for ${name}:`, String(error?.message ?? error)));
  }
}

async function runInRoom(name, fn, collab) {
  const documentId = `sd-34-${name}-${Date.now()}`;
  const seed = await seedRoomFromDocx(collab.url, documentId, FIXTURE);
  const opened = await openDocx(FIXTURE, { collaboration: { url: collab.url, documentId, roomMode: "join" } });
  try {
    return { case: name, mode: "room", result: await fn(opened.document) };
  } finally {
    await closeDocx(opened).catch((error) => console.error(`close failed for ${name}:`, String(error?.message ?? error)));
    await seed.release().catch((error) => console.error(`seed release failed for ${name}:`, String(error?.message ?? error)));
  }
}

const results = { superdocTarget: "2.23.0", sdkTarget: "@superdoc/sdk 2.20.0", timestamp: new Date().toISOString(), cases: [] };
const collab = await startCollabServer();

results.cases.push(await runStandalone("A-oneshot-cross-cell", caseA));
results.cases.push(await runInRoom("A-oneshot-cross-cell", caseA, collab));
results.cases.push(await runStandalone("B-sequential-percell", caseB));
results.cases.push(await runInRoom("B-sequential-percell", caseB, collab));
results.cases.push(await runStandalone("C-undo-redo", caseC));
results.cases.push(await runInRoom("C-undo-redo", caseC, collab));

collab.stop();

const blob = JSON.stringify(results);
const triggered =
  blob.includes("structural projection") || blob.includes("projected story") || blob.includes("table span") || blob.includes("V2EditorHostError");

const sanitizedResults = redactLocalPaths(results);
writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(sanitizedResults, null, 2));
console.log(JSON.stringify(sanitizedResults, null, 2));
console.log(
  triggered
    ? "PASS (bug reproduced: table structural projection error observed)"
    : "FAIL (NEEDS REPRO: no table structural projection error observed across the matrix)",
);
