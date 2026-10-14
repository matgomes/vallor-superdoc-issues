import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { getActionDispositions } from "@superdoc/sdk";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";
import { superdocPerformAction } from "../node_modules/@superdoc/sdk/dist/agent/actions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";
const SDK_VERSION = "2.20.0";
const ACTIONS_SOURCE_PATH = resolvePath(HERE, "../node_modules/@superdoc/sdk/dist/agent/actions.js");

const CHECKED_ACTION_NAMES = [
  "split_list",
  "apply_style",
  "style_table",
  "move_table",
  "set_paragraph_spacing",
  "insert_page_break",
  "add_hyperlink",
  "move_range",
  "replace_text",
  "delete_text",
  "insert_toc",
  "normalize_body_font_size",
];

function staticPass() {
  const dispositions = getActionDispositions();
  const checked = Object.fromEntries(CHECKED_ACTION_NAMES.map((name) => [name, dispositions[name]]));
  const source = readFileSync(ACTIONS_SOURCE_PATH, "utf8");
  const fallbackLines = source
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => entry.text.includes("?? 'direct'"));
  return {
    totalActionCount: Object.keys(dispositions).length,
    checkedDispositions: checked,
    fallbackLineNumbers: fallbackLines.map((entry) => entry.line),
  };
}

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK`, JSON.stringify(result).slice(0, 250));
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

async function applyStyleRun(fixturePath, changeMode) {
  const opened = await openDocx(fixturePath);
  const doc = opened.document;
  const before = await doc.trackChanges.list({});
  const receipt = await superdocPerformAction(doc, {
    action: "apply_style",
    selector: { kind: "ordinal", ordinalKind: "bodyParagraphOrdinal", value: 1 },
    headingLevel: 2,
    ...(changeMode ? { changeMode } : {}),
  });
  const after = await doc.trackChanges.list({});
  const carrierSummary = after.items[0]?.formattingDeltaSummary ?? null;
  await closeDocx(opened);
  return { status: receipt.status, trackedChangesBefore: before.total, trackedChangesAfter: after.total, carrierSummary };
}

async function moveTableRun(fixturePath) {
  const opened = await openDocx(fixturePath);
  const doc = opened.document;
  const receipt = await attempt("move_table on an annotation-bearing table, changeMode:'tracked'", () =>
    superdocPerformAction(doc, {
      action: "move_table",
      selector: { kind: "ordinal", ordinalKind: "tableOrdinal", value: 1 },
      placement: { at: "after", selector: { kind: "ordinal", ordinalKind: "bodyParagraphOrdinal", value: 1 } },
      changeMode: "tracked",
    }),
  );
  await closeDocx(opened);
  return receipt;
}

const staticResult = staticPass();
const explicitTracked = await applyStyleRun(resolvePath(HERE, "plain-paragraph.docx"), "tracked");
const omittedChangeMode = await applyStyleRun(resolvePath(HERE, "plain-paragraph.docx"), undefined);
const moveTable = await moveTableRun(resolvePath(HERE, "multi-redline-table.docx"));

console.log("\n=== SD-20 summary ===");
console.log(JSON.stringify({ staticResult, explicitTracked, omittedChangeMode, moveTable }, null, 2));

assert.equal(staticResult.totalActionCount, 41, "expected 41 actions in getActionDispositions()");
assert.deepEqual(
  Object.values(staticResult.checkedDispositions),
  CHECKED_ACTION_NAMES.map(() => "tracked"),
  "expected every checked action to report disposition 'tracked'",
);
assert.deepEqual(staticResult.fallbackLineNumbers, [944, 956, 1439, 4772, 4869], "expected the '?? \"direct\"' fallback at the same 5 line numbers as previously observed on sdk 2.17.0/2.18.0");

assert.equal(explicitTracked.trackedChangesBefore, 0);
assert.equal(explicitTracked.trackedChangesAfter, 1, "expected explicit changeMode:'tracked' to produce a real tracked change");
assert.ok(explicitTracked.carrierSummary, "expected a real formatting-delta carrier summary for the tracked change");

assert.equal(omittedChangeMode.trackedChangesBefore, 0);
assert.equal(omittedChangeMode.trackedChangesAfter, 0, "expected omitting changeMode to produce NO tracked change (silent direct edit)");
assert.equal(omittedChangeMode.status, "ok", "expected the omitted-changeMode call to report success despite being untracked");

assert.equal(moveTable.ok, true, "expected the call itself to resolve (not throw)");
assert.equal(moveTable.result.status, "failed", "expected move_table on an annotation-bearing table to report status:'failed'");
assert.equal(moveTable.result.errors?.[0]?.code, "CAPABILITY_UNAVAILABLE");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, sdkVersion: SDK_VERSION, verdict: "REPRODUCES", staticResult, explicitTracked, omittedChangeMode, moveTable }, null, 2),
);

console.log(
  "\nBUG REPRODUCED: SD-20 — on sdk 2.20.0, getActionDispositions() reports apply_style (and 40 other actions) " +
    "as disposition 'tracked', and `changeMode ?? 'direct'` is still present at the identical 5 line numbers " +
    "seen on sdk 2.17.0/2.18.0. Calling apply_style with an explicit changeMode:'tracked' produces a real " +
    "tracked change (0->1, a genuine paragraph-formatting carrier); calling the SAME action with changeMode " +
    "omitted entirely reports status:'ok' but produces NO tracked change (0->0) — a silent, untracked edit on " +
    "a host whose defaultChangeMode may be 'tracked'. move_table on a table carrying comment/bookmark/" +
    "permission anchors is refused with the same explicit CAPABILITY_UNAVAILABLE gate as before (not a silent " +
    `fallback) — unchanged on ${SUPERDOC_VERSION}.`,
);
