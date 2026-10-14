// SD-29: doc.diff.compare({sourceSnapshot, targetSnapshot}) directionality.
// The generated client.d.ts's DocDiffCompareParams only declares
// `targetSnapshot` (no `sourceSnapshot` field exists in the type) -- this
// checks what actually happens at runtime on superdoc@2.23.0 /
// @superdoc/sdk@2.20.0, since extra properties aren't type-checked at runtime.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "../_fixtures/bookmark-x1-plain.docx");

async function tryCompare(document, label, params) {
  try {
    const compareResult = await document.diff.compare(params);
    return { label, outcome: "resolved", hasChanges: compareResult.summary?.hasChanges, baseFingerprint: compareResult.baseFingerprint, targetFingerprint: compareResult.targetFingerprint };
  } catch (error) {
    return { label, outcome: "threw", message: String(error.message ?? error).slice(0, 200) };
  }
}

async function run() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const { document } = opened;

  const beforeSnapshot = await document.diff.capture();

  const blocks = await document.blocks.list({ includeText: true });
  const closingParagraph = blocks.blocks.find((block) => /stays/.test(block.text ?? ""));
  assert.ok(closingParagraph, "expected to find a paragraph to edit in the fixture");

  await document.replace({
    target: { kind: "selection", start: { kind: "text", blockId: closingParagraph.nodeId, offset: 0 }, end: { kind: "text", blockId: closingParagraph.nodeId, offset: closingParagraph.text.length } },
    text: "This paragraph was changed for the diff direction test.",
  });

  const afterSnapshot = await document.diff.capture();
  const fingerprintsDiffer = beforeSnapshot.fingerprint !== afterSnapshot.fingerprint;

  const attempts = [
    await tryCompare(document, "natural {sourceSnapshot:before, targetSnapshot:after} (live doc is AFTER-state)", { sourceSnapshot: beforeSnapshot, targetSnapshot: afterSnapshot }),
    await tryCompare(document, "reversed {sourceSnapshot:after, targetSnapshot:before} (live doc is AFTER-state)", { sourceSnapshot: afterSnapshot, targetSnapshot: beforeSnapshot }),
    await tryCompare(document, "spec-shape {targetSnapshot:before} only (implicit source = live AFTER-state)", { targetSnapshot: beforeSnapshot }),
    await tryCompare(document, "spec-shape {targetSnapshot:after} only (implicit source = live AFTER-state)", { targetSnapshot: afterSnapshot }),
  ];

  await closeDocx(opened);

  const result = { version: "2.23.0", fixture: "_fixtures/bookmark-x1-plain.docx", editedBlockId: closingParagraph.nodeId, fingerprintsDiffer, attempts };
  writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(result, null, 2));

  console.log("fingerprints differ after a real edit:", fingerprintsDiffer);
  for (const attempt of attempts) console.log(attempt.label, "->", JSON.stringify(attempt));

  const naturalOrder = attempts[0];
  const reproduces = fingerprintsDiffer && naturalOrder.outcome === "resolved" && naturalOrder.hasChanges === false;
  if (reproduces) {
    console.log("REPRODUCES on 2.23.0: natural {sourceSnapshot, targetSnapshot} order reports hasChanges:false after a real edit -- sourceSnapshot is silently ignored.");
    return;
  }
  console.log("Could not confirm the natural-order bug -- see results-2.23.0.json.");
}

await run();
