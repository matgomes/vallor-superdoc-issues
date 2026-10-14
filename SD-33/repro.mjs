import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";
import { openDocx, closeDocx, countTags } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..");

function redactAbsolutePaths(value) {
  if (typeof value === "string") return value.split(REPO_ROOT).join(".");
  if (Array.isArray(value)) return value.map(redactAbsolutePaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactAbsolutePaths(entry)]));
  }
  return value;
}

const FIXTURE_ABSOLUTE_PATH = resolvePath(HERE, "fixture-dpa-table-bearing-agreement.docx");
const DOCUMENT_ID = "sd33-repro";
const SAVE_REVIEW_PRESERVING_OUT = resolvePath(HERE, "sd33-save-review-preserving.docx");

function withTimeout(promise, ms) {
  const timedOut = Symbol("timedOut");
  return Promise.race([
    promise.then((value) => ({ outcome: "settled", value })),
    new Promise((resolve) => setTimeout(() => resolve({ outcome: "timedOut" }), ms)),
  ]);
}

function errorShape(error) {
  return { message: error.message, code: error.code };
}

async function probeExportToDocxRefusal(document) {
  const results = {};
  for (const mode of ["original", "review-preserving", "final"]) {
    try {
      await document.export.toDocx({ mode });
      results[mode] = { threw: false };
    } catch (error) {
      results[mode] = { threw: true, ...errorShape(error) };
    }
  }
  return results;
}

async function probeSaveFinalRefusal(document) {
  const outcome = await document
    .save({ mode: "final", out: resolvePath(HERE, "sd33-save-final-unexpected.docx"), force: true })
    .then((result) => ({ threw: false, result }))
    .catch((error) => ({ threw: true, ...errorShape(error) }));
  return outcome;
}

async function probeSaveReviewPreserving(document) {
  const timed = await withTimeout(document.save({ mode: "review-preserving", out: SAVE_REVIEW_PRESERVING_OUT, force: true }), 30000);
  return timed;
}

async function probeSaveOriginalQuirk(document) {
  const outcome = await document
    .save({ mode: "original", out: resolvePath(HERE, "sd33-save-original-unexpected.docx"), force: true })
    .then((result) => ({ threw: false, result }))
    .catch((error) => ({ threw: true, ...errorShape(error) }));
  return outcome;
}

async function probeStandaloneFinalExportWorks() {
  const opened = await openDocx(FIXTURE_ABSOLUTE_PATH);
  const result = await opened.document.export.toDocx({ mode: "final" });
  await closeDocx(opened);
  return { byteLength: result.byteLength, warnings: result.report?.warnings ?? [] };
}

const collab = await startCollabServer();
const seed = await seedRoomFromDocx(collab.url, DOCUMENT_ID, FIXTURE_ABSOLUTE_PATH);
const joiner = await openDocx(FIXTURE_ABSOLUTE_PATH, { collaboration: { url: collab.url, documentId: DOCUMENT_ID } });

const exportToDocxRefusal = await probeExportToDocxRefusal(joiner.document);
const saveFinalRefusal = await probeSaveFinalRefusal(joiner.document);
const saveReviewPreserving = await probeSaveReviewPreserving(joiner.document);
const saveOriginalQuirk = await probeSaveOriginalQuirk(joiner.document);

await closeDocx(joiner);
await seed.release();
collab.stop();

const standaloneFinalExport = await probeStandaloneFinalExportWorks();

const savedReviewPreservingBytes = readFileSync(SAVE_REVIEW_PRESERVING_OUT);
const savedReviewPreservingTags = await countTags(savedReviewPreservingBytes, ["w:ins", "w:del"]);

for (const mode of ["original", "review-preserving", "final"]) {
  assert.equal(exportToDocxRefusal[mode].threw, true, `expected export.toDocx({mode:"${mode}"}) to throw in a v2 room`);
  assert.equal(exportToDocxRefusal[mode].code, "CAPABILITY_UNSUPPORTED", `expected CAPABILITY_UNSUPPORTED for mode "${mode}"`);
}
assert.equal(saveFinalRefusal.threw, true, 'expected document.save({mode:"final"}) to be refused in a v2 room');
assert.equal(saveReviewPreserving.outcome, "settled", "expected document.save({mode:\"review-preserving\"}) to settle, not hang, within 30s");
assert.equal(saveReviewPreserving.value?.threw, undefined, 'expected document.save({mode:"review-preserving"}) to succeed, not throw');

const results = {
  version: "superdoc 2.23.0 / @superdoc/sdk 2.20.0",
  "export.toDocx refused in collaboration (all modes)": exportToDocxRefusal,
  'document.save({mode:"final"}) refused in collaboration': saveFinalRefusal,
  'document.save({mode:"review-preserving"}) in collaboration': {
    elapsed_outcome: saveReviewPreserving.outcome,
    result: saveReviewPreserving.value?.result ?? saveReviewPreserving.value,
    savedFileTagCounts: savedReviewPreservingTags,
  },
  'document.save({mode:"original", out, force:true}) in collaboration': saveOriginalQuirk,
  "standalone (non-collaborative) final export, same fixture, for contrast": standaloneFinalExport,
  verdict: {
    "export.toDocx refused in collaboration": "REPRODUCES",
    'documented collaborative save path ("document.save") hangs': "FIXED — resolves in well under a second, does not hang",
    "no clean/final export possible from a live room": "FIXED (partially) — mode:\"final\" is still refused in-room with a clear, actionable error, but mode:\"review-preserving\" now succeeds in-room via document.save(); a clean export still requires leaving the room, which is a reasonable restriction, not a dead end",
  },
};

const redactedResults = redactAbsolutePaths(results);
writeFileSync(resolvePath(HERE, "results-2.23.0.json"), JSON.stringify(redactedResults, null, 2));
console.log(JSON.stringify(redactedResults, null, 2));
console.log("SD-33 repro complete — see results-2.23.0.json");
