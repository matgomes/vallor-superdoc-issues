import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "table-cell-replacement.docx");

// Table-cell paragraph 00000003 carries one tracked replacement:
// deletedText "{{Supplier Legal Description}}" (30 chars) -> insertedText
// "TEST " (5 chars), immediately followed by the untouched kept text
// "TEST - MIRA Consulting Company" (30 chars). Visible text (35 chars):
// "TEST TEST - MIRA Consulting Company".

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

// (a) A bookmark can be placed purely inside the deletion, and purely inside
// the kept text, but its END marker cannot be placed in tracked coordinates
// once it needs to cross from the deletion into the kept text (or vice
// versa) — so no single bookmark can wrap the whole logical clause
// (deleted lead-in + kept value) via tracked coordinates.
async function coordinateSpacePass() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;

  const deletedOnly = await attempt("tracked 0..30 — exactly the deleted placeholder", () =>
    doc.bookmarks.insert({ name: "DeletedOnly", at: { kind: "text", segments: [{ blockId: "00000003", range: { start: 0, end: 30 } }], coordinateSpace: "tracked" } }),
  );
  const keptOnlyVisible = await attempt("visible 0..35 — exactly the kept value, default coordinates", () =>
    doc.bookmarks.insert({ name: "KeptVisible", at: { kind: "text", segments: [{ blockId: "00000003", range: { start: 0, end: 35 } }] } }),
  );
  const fullClauseTracked = await attempt("tracked 0..65 — whole logical clause (deleted + kept)", () =>
    doc.bookmarks.insert({ name: "FullClause", at: { kind: "text", segments: [{ blockId: "00000003", range: { start: 0, end: 65 } }], coordinateSpace: "tracked" } }),
  );
  const crossBoundaryTracked = await attempt("tracked 25..40 — crossing the deleted/kept boundary at offset 30", () =>
    doc.bookmarks.insert({ name: "CrossBoundary", at: { kind: "text", segments: [{ blockId: "00000003", range: { start: 25, end: 40 } }], coordinateSpace: "tracked" } }),
  );

  await closeDocx(opened);
  return { deletedOnly, keptOnlyVisible, fullClauseTracked, crossBoundaryTracked };
}

// (b) Real-world consequence: bookmark the whole visible value (which
// includes the tracked-inserted replacement text), then REJECT that
// replacement. The bookmark survives but silently shrinks to exclude the
// just-restored (previously deleted) text instead of growing to include it.
async function rejectConsequencePass() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;

  await doc.bookmarks.insert({ name: "ClauseValue", at: { kind: "text", segments: [{ blockId: "00000003", range: { start: 0, end: 35 } }] } });
  const beforeGet = await doc.bookmarks.get({ target: { kind: "entity", entityType: "bookmark", name: "ClauseValue" } });
  const textBefore = await doc.getNodeById({ id: "00000003" });
  const coveredTextBefore = textBefore.node.paragraph.inlines[0].run.text.slice(beforeGet.range.from.offset, beforeGet.range.to.offset);

  const changes = await doc.trackChanges.list({});
  const changeId = changes.items[0].id;
  const rejectResult = await attempt("reject the tracked replacement", () =>
    doc.trackChanges.decide({ decision: "reject", target: { kind: "id", id: changeId } }),
  );

  const afterGet = await doc.bookmarks.get({ target: { kind: "entity", entityType: "bookmark", name: "ClauseValue" } });
  const textAfter = await doc.getNodeById({ id: "00000003" });
  const coveredTextAfter = textAfter.node.paragraph.inlines[0].run.text.slice(afterGet.range.from.offset, afterGet.range.to.offset);

  await closeDocx(opened);
  return {
    rangeBefore: beforeGet.range,
    coveredTextBefore,
    rejectResult,
    rangeAfter: afterGet.range,
    coveredTextAfter,
    restoredPlaceholderExcluded: !coveredTextAfter.includes("{{Supplier Legal Description}}"),
  };
}

const coordinateSpace = await coordinateSpacePass();
const rejectConsequence = await rejectConsequencePass();

console.log("\n=== SD-40 summary ===");
console.log(JSON.stringify({ coordinateSpace, rejectConsequence }, null, 2));

assert.equal(coordinateSpace.deletedOnly.ok, true, "expected a bookmark purely inside the deletion to succeed");
assert.equal(coordinateSpace.keptOnlyVisible.ok, true, "expected a bookmark purely over the kept value (visible coords) to succeed");
assert.equal(coordinateSpace.fullClauseTracked.ok, false, "expected a bookmark spanning the whole clause in tracked coordinates to be refused");
assert.equal(coordinateSpace.fullClauseTracked.code, "COMMAND_FAILED");
assert.match(coordinateSpace.fullClauseTracked.message, /Unable to place the bookmark end marker/);
assert.equal(coordinateSpace.crossBoundaryTracked.ok, false, "expected a bookmark crossing the deleted/kept boundary in tracked coordinates to be refused the same way");

assert.equal(rejectConsequence.coveredTextBefore, "TEST TEST - MIRA Consulting Company", "expected the bookmark to cover the full visible value before reject");
assert.equal(rejectConsequence.rejectResult.ok, true, "expected the reject to succeed");
assert.equal(rejectConsequence.restoredPlaceholderExcluded, true, "expected the restored placeholder text to be excluded from the bookmark after reject");
assert.equal(rejectConsequence.coveredTextAfter, "TEST - MIRA Consulting Company", "expected the bookmark to silently shrink to only the originally-kept tail");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", coordinateSpace, rejectConsequence }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-40 — bookmarks.insert cannot place a tracked-coordinate end marker that crosses from " +
    "a tracked deletion into kept text (or vice versa) in a table cell, so no bookmark can wrap a whole " +
    "logical clause that starts with a tracked-deleted placeholder; and a bookmark placed over the visible " +
    "value before a reject silently shrinks to exclude the just-restored (previously deleted) text instead of " +
    `growing to include it — on ${SUPERDOC_VERSION}.`,
);
