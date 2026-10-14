import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "whole-paragraph-deleted.docx");

// Fixture: P1 (kept, blockId 00000001) / P2 (tracked-deleted whole paragraph,
// blockId 00000002, visible length 0) / P3 (kept, blockId 00000003).

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

async function run() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const doc = opened.document;

  const sanityBoldVisible = await attempt("sanity: bold a plain visible selection in P1", () =>
    doc.format.bold({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 0 },
        end: { kind: "text", blockId: "00000001", offset: 5 },
      },
    }),
  );

  const boldSingleParagraphTracked = await attempt("bold, single paragraph, tracked coordinates (purely deleted text)", () =>
    doc.format.bold({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000002", offset: 0 },
        end: { kind: "text", blockId: "00000002", offset: 10 },
        coordinateSpace: "tracked",
      },
    }),
  );

  const boldCrossParagraphTracked = await attempt("bold, crossing P1 -> deleted P2, tracked coordinates", () =>
    doc.format.bold({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 2 },
        end: { kind: "text", blockId: "00000002", offset: 10 },
        coordinateSpace: "tracked",
      },
    }),
  );

  const highlightCrossParagraphTracked = await attempt("highlight, crossing P1 -> deleted P2, tracked coordinates", () =>
    doc.format.apply({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 2 },
        end: { kind: "text", blockId: "00000002", offset: 10 },
        coordinateSpace: "tracked",
      },
      inline: { highlight: "#FFFF00" },
    }),
  );

  const clearFormattingCrossParagraphTracked = await attempt("clear several inline properties, crossing P1 -> deleted P2, tracked coordinates", () =>
    doc.format.apply({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000001", offset: 2 },
        end: { kind: "text", blockId: "00000002", offset: 10 },
        coordinateSpace: "tracked",
      },
      inline: { bold: null, italic: null, underline: null, highlight: null, color: null },
    }),
  );

  const boldSingleParagraphVisibleCoords = await attempt("bold, single paragraph, DEFAULT (visible) coordinates over the same deleted text", () =>
    doc.format.bold({
      target: {
        kind: "selection",
        start: { kind: "text", blockId: "00000002", offset: 0 },
        end: { kind: "text", blockId: "00000002", offset: 10 },
      },
    }),
  );

  await closeDocx(opened);

  return {
    sanityBoldVisible,
    boldSingleParagraphTracked,
    boldCrossParagraphTracked,
    highlightCrossParagraphTracked,
    clearFormattingCrossParagraphTracked,
    boldSingleParagraphVisibleCoords,
  };
}

const result = await run();

console.log("\n=== SD-08 summary ===");
console.log(JSON.stringify(result, null, 2));

assert.equal(result.sanityBoldVisible.ok, true, "expected a plain visible-coordinate bold to succeed");

assert.equal(result.boldSingleParagraphTracked.ok, false, "expected single-paragraph tracked-coordinate bold to be refused");
assert.equal(result.boldSingleParagraphTracked.code, "TRACK_CHANGE_COMMAND_UNAVAILABLE");
assert.match(result.boldSingleParagraphTracked.message, /resolve the target in visible coordinates/);

assert.equal(result.boldCrossParagraphTracked.ok, false, "expected cross-paragraph tracked-coordinate bold to be refused");
assert.equal(result.boldCrossParagraphTracked.code, "TRACK_CHANGE_COMMAND_UNAVAILABLE");
assert.equal(result.boldCrossParagraphTracked.message, "text-range-cross-paragraph-tracked-coordinate-unsupported");

assert.equal(result.highlightCrossParagraphTracked.ok, false, "expected cross-paragraph tracked-coordinate highlight to be refused");
assert.equal(result.highlightCrossParagraphTracked.message, "text-range-cross-paragraph-tracked-coordinate-unsupported");

assert.equal(result.clearFormattingCrossParagraphTracked.ok, false, "expected cross-paragraph tracked-coordinate clear-formatting to be refused the same way");
assert.equal(result.clearFormattingCrossParagraphTracked.message, "text-range-cross-paragraph-tracked-coordinate-unsupported");

assert.equal(result.boldSingleParagraphVisibleCoords.ok, false, "expected default/visible coordinates over purely-deleted text to fail differently (no visible text to address)");
assert.equal(result.boldSingleParagraphVisibleCoords.code, "INVALID_ARGUMENT");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", ...result }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-08 — inline formatting (bold, highlight, a multi-property clear) on a selection in " +
    "`coordinateSpace:'tracked'` that crosses a paragraph boundary into tracked-deleted text is refused with " +
    "`TRACK_CHANGE_COMMAND_UNAVAILABLE text-range-cross-paragraph-tracked-coordinate-unsupported`, and the " +
    "same single-paragraph tracked selection is refused with 'resolve the target in visible coordinates " +
    "instead' — advice that cannot be followed because the visible text there has length 0. There is no " +
    `coordinate space in which this formatting can be expressed, on ${SUPERDOC_VERSION}.`,
);
