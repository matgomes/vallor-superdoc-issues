import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_REPO_PATH = "SD-11/indemnification-cross-reference.docx";

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK ${JSON.stringify(result).slice(0, 250)}`);
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

async function findRefParagraphAndNext(doc) {
  const blocks = (await doc.blocks.list({ includeText: true })).blocks;
  const refParagraphIndex = blocks.findIndex((block) => (block.text ?? "").startsWith("As provided"));
  return { refParagraph: blocks[refParagraphIndex], nextParagraph: blocks[refParagraphIndex + 1] };
}

async function blockDeleteTracked() {
  const opened = await openDocx(FIXTURE_REPO_PATH);
  const { refParagraph } = await findRefParagraphAndNext(opened.document);
  const outcome = await attempt("blocks.delete REF-bearing paragraph (tracked)", () =>
    opened.document.blocks.delete({ changeMode: "tracked", target: { kind: "block", nodeType: refParagraph.nodeType, nodeId: refParagraph.nodeId } }),
  );
  await closeDocx(opened);
  return outcome;
}

async function blockDeleteDirect() {
  const opened = await openDocx(FIXTURE_REPO_PATH);
  const { refParagraph } = await findRefParagraphAndNext(opened.document);
  const outcome = await attempt("blocks.delete REF-bearing paragraph (direct)", () =>
    opened.document.blocks.delete({ changeMode: "direct", target: { kind: "block", nodeType: refParagraph.nodeType, nodeId: refParagraph.nodeId } }),
  );
  await closeDocx(opened);
  return outcome;
}

async function blockDeleteRangeTracked() {
  const opened = await openDocx(FIXTURE_REPO_PATH);
  const { refParagraph, nextParagraph } = await findRefParagraphAndNext(opened.document);
  const outcome = await attempt("blocks.deleteRange REF-paragraph..next (tracked)", () =>
    opened.document.blocks.deleteRange({
      changeMode: "tracked",
      start: { kind: "block", nodeType: refParagraph.nodeType, nodeId: refParagraph.nodeId },
      end: { kind: "block", nodeType: nextParagraph.nodeType, nodeId: nextParagraph.nodeId },
    }),
  );
  await closeDocx(opened);
  return outcome;
}

async function fieldResultTextDeleteAndReject() {
  const opened = await openDocx(FIXTURE_REPO_PATH);
  const doc = opened.document;
  const { refParagraph } = await findRefParagraphAndNext(doc);
  const fieldResultStart = refParagraph.text.indexOf("Indemnification");
  const fieldResultEnd = fieldResultStart + "Indemnification".length;
  const target = {
    kind: "selection",
    start: { kind: "text", blockId: refParagraph.nodeId, offset: fieldResultStart },
    end: { kind: "text", blockId: refParagraph.nodeId, offset: fieldResultEnd },
  };

  const deleteOutcome = await attempt("tracked delete of the field RESULT text only (not the paragraph)", () =>
    doc.delete({ target, behavior: "exact" }, { changeMode: "tracked" }),
  );
  const trackedChanges = await doc.trackChanges.list({});
  const rejectOutcome = trackedChanges.items?.[0]
    ? await attempt("reject that tracked deletion", () => doc.trackChanges.decide({ decision: "reject", target: { kind: "id", id: trackedChanges.items[0].id } }))
    : { ok: false, message: "no tracked change to reject" };

  await closeDocx(opened);
  return { deleteOutcome, rejectOutcome };
}

const results = {
  blockDeleteTracked: await blockDeleteTracked(),
  blockDeleteDirect: await blockDeleteDirect(),
  blockDeleteRangeTracked: await blockDeleteRangeTracked(),
  fieldResultTextDeleteAndReject: await fieldResultTextDeleteAndReject(),
};

console.log("\n=== SD-11 summary ===");
console.log(JSON.stringify(results, null, 2));

assert.equal(results.blockDeleteTracked.ok, false, "expected tracked blocks.delete on the REF-bearing paragraph to be refused");
assert.equal(results.blockDeleteTracked.code, "COMMAND_FAILED", "expected COMMAND_FAILED for tracked blocks.delete");
assert.equal(results.blockDeleteDirect.ok, false, "expected direct (non-tracked) blocks.delete on the REF-bearing paragraph to also be refused");
assert.equal(results.blockDeleteRangeTracked.ok, false, "expected blocks.deleteRange across the REF-bearing paragraph to be refused");

assert.equal(results.fieldResultTextDeleteAndReject.deleteOutcome.ok, true, "expected a tracked delete of only the field's result text (not the whole paragraph) to succeed");
assert.equal(results.fieldResultTextDeleteAndReject.rejectOutcome.ok, true, "expected that tracked deletion to be rejectable");

const repoRootPrefix = `${resolvePath(HERE, "..")}/`;
const reportJson = JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", results }, null, 2).replaceAll(repoRootPrefix, "");

writeFileSync(resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`), reportJson);

console.log(
  "\nBUG REPRODUCED: SD-11 — a paragraph containing a genuine Word REF cross-reference field still cannot be block-deleted, tracked or direct (COMMAND_FAILED paragraph-tracked-wrapper-unsupported), and blocks.deleteRange across it is still refused (now COMMAND_FAILED unsupported-context, a different code than the 2.20/2.21 text-range-in-field). Deleting only the field's rendered result text (not the paragraph) works fine and is rejectable — the restriction is specifically about block-level deletion of a field-bearing paragraph.",
);
