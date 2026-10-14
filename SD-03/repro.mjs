import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx, exportDocx, countTags } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";

const READ_PATH_FIXTURE = resolvePath(HERE, "paragraph-mark-deleted-twice.docx");
const WRITE_PATH_BASE = resolvePath(HERE, "clean-base-four-paragraphs.docx");

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK ${JSON.stringify(result).slice(0, 200)}`);
    return { ok: true, result };
  } catch (error) {
    console.log(`${label}: THREW code=${error.code} message=${error.message}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

// (a) READ PATH: a file that already has a doubled paragraph-mark <w:del> breaks Accept All.
async function readPath() {
  const opened = await openDocx(READ_PATH_FIXTURE);
  const before = await opened.document.trackChanges.list({});
  const decide = await attempt("decide(all, accept) on pre-doubled fixture", () =>
    opened.document.trackChanges.decide({ decision: "accept", target: { kind: "all" } }),
  );
  await closeDocx(opened);
  return {
    trackedChangesBefore: before.total,
    subtypes: before.items?.map((item) => item.subtype),
    decide,
  };
}

// (b) WRITE PATH: SuperDoc's own tracked `blocks.merge` writes a second <w:del> into a
// paragraph mark that is already tracked-deleted, when the same boundary is merged twice.
async function writePath() {
  const opened = await openDocx(WRITE_PATH_BASE);
  const doc = opened.document;
  const first = { kind: "block", nodeType: "paragraph", nodeId: "00000002" };
  const second = { kind: "block", nodeType: "listItem", nodeId: "00000003" };

  await attempt("blocks.merge #1 (tracked)", () => doc.blocks.merge({ changeMode: "tracked", first, second }));
  const afterFirstMerge = await doc.trackChanges.list({});

  await attempt("blocks.merge #2, SAME boundary again (tracked)", () =>
    doc.blocks.merge({ changeMode: "tracked", first, second }),
  );
  const afterSecondMerge = await doc.trackChanges.list({});

  const exportRelativePath = `SD-03/exported-${SUPERDOC_VERSION}.docx`;
  const { buffer } = await exportDocx(doc, "review-preserving");
  writeFileSync(resolvePath(HERE, `exported-${SUPERDOC_VERSION}.docx`), buffer);
  const tagCounts = await countTags(buffer, ["w:del", "w:ins"]);

  const decide = await attempt("decide(all, accept) on self-doubled export", () =>
    doc.trackChanges.decide({ decision: "accept", target: { kind: "all" } }),
  );

  await closeDocx(opened);
  return {
    subtypesAfterFirstMerge: afterFirstMerge.items?.map((item) => item.subtype),
    subtypesAfterSecondMerge: afterSecondMerge.items?.map((item) => item.subtype),
    totalAfterSecondMerge: afterSecondMerge.total,
    exportPath: exportRelativePath,
    tagCounts,
    decide,
  };
}

const read = await readPath();
const write = await writePath();

console.log("\n=== SD-03 summary ===");
console.log(JSON.stringify({ read, write }, null, 2));

assert.equal(read.decide.ok, false, "expected decide(all) to fail on the pre-doubled fixture");
assert.equal(read.decide.code, "INVALID_INPUT", "expected INVALID_INPUT reading the doubled fixture");

assert.deepEqual(
  write.subtypesAfterSecondMerge,
  ["paragraph-mark-deletion", "paragraph-mark-deletion"],
  "expected a second paragraph-mark-deletion after merging the same boundary twice",
);
assert.equal(write.tagCounts["w:del"], 2, "expected SuperDoc's own export to contain two <w:del> markers");
assert.equal(write.decide.ok, false, "expected decide(all) to fail on the self-produced doubled export");
assert.equal(write.decide.code, "INVALID_INPUT", "expected INVALID_INPUT on the self-produced doubled export");

writeFileSync(
  resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`),
  JSON.stringify({ superdocVersion: SUPERDOC_VERSION, verdict: "REPRODUCES", read, write }, null, 2),
);

console.log("\nBUG REPRODUCED: SD-03 — doubled paragraph-mark <w:del> breaks decide({kind:\"all\"}) with INVALID_INPUT, on both the read path and SuperDoc's own write path.");
