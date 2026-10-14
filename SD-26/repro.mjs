import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";
import { superdocPerformAction } from "../node_modules/@superdoc/sdk/dist/agent/actions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const SDK_VERSION = "2.20.0";
const BASE_FIXTURE = resolvePath(HERE, "../_fixtures/tc-probe-00-clean-backspace-base.docx");

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK`, JSON.stringify(result).slice(0, 300));
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

async function run() {
  const opened = await openDocx(BASE_FIXTURE);
  const doc = opened.document;

  await doc.replace({
    target: { kind: "selection", start: { kind: "text", blockId: "00000001", offset: 0 }, end: { kind: "text", blockId: "00000001", offset: 27 } },
    text: "The Provider shall deliver the goods on time.",
  });
  const before = await doc.getText({});

  const scopedReplace = await attempt("replace_text, selector:{kind:'nodeId'} + edits array, changeMode:'tracked'", () =>
    superdocPerformAction(doc, {
      action: "replace_text",
      selector: { kind: "nodeId", nodeId: "00000001" },
      edits: [{ find: "Provider", replace: "Vendor" }],
      changeMode: "tracked",
    }),
  );

  const legacyShape = await attempt("replace_text, selector + top-level find/replace strings (pre-edits-array shape)", () =>
    superdocPerformAction(doc, {
      action: "replace_text",
      selector: { kind: "nodeId", nodeId: "00000001" },
      find: "Vendor",
      replace: "Supplier",
      changeMode: "tracked",
    }),
  );

  const after = await doc.getText({});
  const changes = await doc.trackChanges.list({});

  await closeDocx(opened);
  return {
    before,
    scopedReplace,
    legacyShape,
    after,
    trackedChanges: changes.items.map((item) => ({ type: item.type, subtype: item.subtype, deletedText: item.deletedText, insertedText: item.insertedText })),
  };
}

const result = await run();

console.log("\n=== SD-26 summary ===");
console.log(JSON.stringify(result, null, 2));

assert.equal(result.scopedReplace.ok, true, "expected the selector + edits-array scoped replace to succeed (no DISPATCH_ERROR)");
assert.equal(result.scopedReplace.result.status, "ok");
assert.equal(result.scopedReplace.result.editsApplied?.[0]?.occurrences, 1, "expected exactly 1 occurrence of 'Provider' replaced");
assert.equal(result.after.includes("The Vendor shall deliver the goods on time."), true, "expected only the single word to change, not the whole sentence");
assert.equal(result.trackedChanges.length, 1, "expected exactly 1 tracked change");
assert.equal(result.trackedChanges[0].deletedText, "Provider", "expected the tracked deletion to be the single word 'Provider', not the whole sentence");
assert.equal(result.trackedChanges[0].insertedText, "Vendor", "expected the tracked insertion to be the single word 'Vendor', not the whole sentence");

assert.equal(result.legacyShape.ok, false, "expected the pre-edits-array legacy shape to be rejected");
assert.equal(result.legacyShape.code, "INVALID_ARGUMENT");
assert.match(result.legacyShape.message, /requires a non-empty "edits" array/);

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, sdkVersion: SDK_VERSION, verdict: "FIXED", ...result }, null, 2),
);

console.log(
  `\nFIXED on superdoc ${SUPERDOC_VERSION} / @superdoc/sdk ${SDK_VERSION}: the agent "replace_text" action, given ` +
    "a selector plus an edits array (selector:{kind:'nodeId',...}, edits:[{find,replace}]), performs a real " +
    "word-level scoped replace — 1 occurrence matched, tracked change deletedText/insertedText are exactly " +
    "'Provider'/'Vendor', and the rest of the sentence is untouched. No DISPATCH_ERROR. The old pre-edits-array " +
    "argument shape (top-level find/replace strings) is now rejected outright with a clear INVALID_ARGUMENT " +
    "rather than silently falling through to a whole-paragraph rewrite.",
);
