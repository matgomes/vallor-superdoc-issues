import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
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

// (a) includeDeletedText:true is documented to surface tracked-deleted text
// in find() results. Confirm it never does, on two independent fixtures.
async function includeDeletedTextPass() {
  const simpleDeletion = await openDocx(resolvePath(HERE, "../_fixtures/tc-probe-sd06-fixture.docx"));
  const simpleFindDefault = await attempt("find 'whole paragraph' (default)", () =>
    simpleDeletion.document.find({ type: "text", pattern: "whole paragraph" }),
  );
  const simpleFindIncluded = await attempt("find 'whole paragraph' (includeDeletedText:true)", () =>
    simpleDeletion.document.find({ type: "text", pattern: "whole paragraph", includeDeletedText: true }),
  );
  await closeDocx(simpleDeletion);

  const replacement = await openDocx(resolvePath(HERE, "ambiguous-visible-text.docx"));
  const replacementFindIncluded = await attempt("find '100' (includeDeletedText:true) over a tracked replacement", () =>
    replacement.document.find({ type: "text", pattern: "100", includeDeletedText: true }),
  );
  await closeDocx(replacement);

  return { simpleFindDefault, simpleFindIncluded, replacementFindIncluded };
}

// (b) Real-world consequence: a hidden tracked edit is the ONLY thing that
// distinguishes two otherwise-identical visible paragraphs. Since deleted
// text is never matchable (part a), a selector can never use it to
// disambiguate, so a plan step requiring exactly one match fails.
async function ambiguousMatchPass() {
  const opened = await openDocx(resolvePath(HERE, "ambiguous-visible-text.docx"));
  const doc = opened.document;
  const text = await doc.getText({});
  const trackChanges = await doc.trackChanges.list({});

  const findBoth = await attempt("find 'Widget A costs 150 dollars.' (plain, matches both paragraphs)", () =>
    doc.find({ type: "text", pattern: "Widget A costs 150 dollars." }),
  );

  const planRequireExactlyOne = await attempt("mutations.apply select-by-text require:'exactlyOne' over the ambiguous pattern", () =>
    doc.mutations.apply({
      atomic: true,
      changeMode: "tracked",
      steps: [
        {
          id: "rewrite-one",
          op: "text.rewrite",
          where: { by: "select", select: { type: "text", pattern: "Widget A costs 150 dollars." }, require: "exactlyOne" },
          args: { replacement: { text: "Widget A costs 200 dollars." } },
        },
      ],
    }),
  );

  await closeDocx(opened);
  return { text, trackedChangeCount: trackChanges.total, findBoth, planRequireExactlyOne };
}

const includeDeletedText = await includeDeletedTextPass();
const ambiguousMatch = await ambiguousMatchPass();

console.log("\n=== SD-25 summary ===");
console.log(JSON.stringify({ includeDeletedText, ambiguousMatch }, null, 2));

assert.equal(includeDeletedText.simpleFindDefault.ok, true, "expected find() to resolve (not throw)");
assert.equal(includeDeletedText.simpleFindDefault.result.total, 0, "expected default find() to miss deleted-only text");
assert.equal(includeDeletedText.simpleFindIncluded.ok, true, "expected find(includeDeletedText:true) to resolve (not throw)");
assert.equal(includeDeletedText.simpleFindIncluded.result.total, 0, "expected includeDeletedText:true to STILL miss deleted-only text");
assert.equal(includeDeletedText.replacementFindIncluded.result.total, 0, "expected includeDeletedText:true to miss the deleted side of a tracked replacement too");

assert.equal(ambiguousMatch.trackedChangeCount, 1, "expected exactly 1 tracked change (the hidden replacement) in the fixture");
assert.equal(ambiguousMatch.findBoth.result.total, 2, "expected the plain-text selector to match both visually-identical paragraphs");
assert.equal(ambiguousMatch.planRequireExactlyOne.ok, false, "expected the exactlyOne-required plan step to be refused");
assert.equal(ambiguousMatch.planRequireExactlyOne.code, "COMMAND_FAILED");
assert.match(ambiguousMatch.planRequireExactlyOne.message, /matched 2 ranges, expected exactly one/);

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", includeDeletedText, ambiguousMatch }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-25 — `includeDeletedText:true` never actually surfaces tracked-deleted text in " +
    "find()/selector-based mutation steps (confirmed on 2 fixtures), so a hidden tracked edit can never be " +
    "used to disambiguate otherwise-identical visible text. A mutation-plan step with `require:'exactlyOne'` " +
    "over text whose only two occurrences differ solely by a hidden deletion fails `COMMAND_FAILED: selector " +
    `matched 2 ranges, expected exactly one.` + ` — on ${SUPERDOC_VERSION}.`,
);
