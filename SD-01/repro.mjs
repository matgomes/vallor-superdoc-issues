import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { startCollabServer, seedRoomFromDocx } from "../harness/lib/collab-server.mjs";
import { openDocx, closeDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERDOC_VERSION = "2.23.0";

const TABLE_CELL_REVISIONS_FIXTURE = "SD-01/dpa-table-cell-revisions.docx";
const BOOKMARK_FIXTURE = "SD-01/bookmark-x2-around-text.docx";
const TABLE_BEARING_FIXTURE = "SD-01/dpa-table-bearing-agreement.docx";

async function withoutRoom(fixturePath, fn) {
  const opened = await openDocx(fixturePath);
  const result = await fn(opened.document);
  await closeDocx(opened);
  return result;
}

async function withRoom(fixturePath, fn) {
  const collab = await startCollabServer();
  const documentId = randomUUID();
  const seed = await seedRoomFromDocx(collab.url, documentId, fixturePath);
  const joiner = await openDocx(fixturePath, { collaboration: { url: collab.url, documentId } });
  const result = await fn(joiner.document);
  await closeDocx(joiner);
  await seed.release();
  collab.stop();
  return result;
}

async function resolveCapability(doc, operationId) {
  return doc.capabilities
    .resolve({ operationId, changeMode: "tracked" })
    .then((capability) => ({ available: capability.available, canReplace: capability.canReplace }))
    .catch((error) => ({ threw: true, code: error.code, message: error.message }));
}

async function attempt(fn) {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

const operations = [
  {
    name: "decide by id",
    fixture: TABLE_CELL_REVISIONS_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "trackChanges.decide"),
      outcome: await attempt(() => doc.trackChanges.decide({ decision: "accept", target: { kind: "id", id: "0d04441d5675f9a707ce4aab" } })),
    }),
  },
  {
    name: "decide by range",
    fixture: TABLE_CELL_REVISIONS_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "trackChanges.decide"),
      outcome: await attempt(() =>
        doc.trackChanges.decide({
          decision: "accept",
          target: { kind: "range", range: { kind: "text", segments: [{ blockId: "13E479F5", range: { start: 0, end: 490 } }] } },
        }),
      ),
    }),
  },
  {
    name: "decide all",
    fixture: TABLE_CELL_REVISIONS_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "trackChanges.decide"),
      outcome: await attempt(() => doc.trackChanges.decide({ decision: "accept", target: { kind: "all" } })),
    }),
  },
  {
    name: "accept a change inside a table cell",
    fixture: TABLE_CELL_REVISIONS_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "trackChanges.decide"),
      outcome: await attempt(() => doc.trackChanges.decide({ decision: "accept", target: { kind: "id", id: "cb08ad3345bd788dab89befb" } })),
    }),
  },
  {
    name: "blocks.delete",
    fixture: TABLE_CELL_REVISIONS_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "blocks.delete"),
      outcome: await attempt(() => doc.blocks.delete({ changeMode: "tracked", target: { kind: "block", nodeType: "paragraph", nodeId: "3EAAE701" } })),
    }),
  },
  {
    name: "replace across a bookmark marker",
    fixture: BOOKMARK_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "replace"),
      outcome: await attempt(() =>
        doc.replace(
          { target: { kind: "selection", start: { kind: "text", blockId: "00000002", offset: 300 }, end: { kind: "text", blockId: "00000003", offset: 3 } }, text: "NEW TEXT ACROSS THE BOOKMARK" },
          { changeMode: "tracked" },
        ),
      ),
    }),
  },
  {
    name: "text rewrite (scoped replace within one block)",
    fixture: BOOKMARK_FIXTURE,
    run: async (doc) => {
      const blocks = (await doc.blocks.list({ includeText: true })).blocks;
      const closingParagraph = blocks.find((block) => (block.text ?? "").startsWith("Closing paragraph"));
      return {
        capability: await resolveCapability(doc, "replace"),
        outcome: await attempt(() =>
          doc.replace(
            { target: { kind: "selection", start: { kind: "text", blockId: closingParagraph.nodeId, offset: 0 }, end: { kind: "text", blockId: closingParagraph.nodeId, offset: closingParagraph.text.length } }, text: "Updated closing paragraph text." },
            { changeMode: "tracked" },
          ),
        ),
      };
    },
  },
  {
    name: "insert table rows",
    fixture: TABLE_BEARING_FIXTURE,
    run: async (doc) => ({
      capability: await resolveCapability(doc, "tables.insertRow"),
      outcome: await attempt(() =>
        doc.tables.insertRow({ target: { kind: "block", nodeType: "table", nodeId: "tbl:02000001" }, rowIndex: 0, position: "below", count: 1, changeMode: "tracked" }),
      ),
    }),
  },
];

async function twoCollaboratorsConcurrent() {
  const collab = await startCollabServer();
  const documentId = randomUUID();
  const seed = await seedRoomFromDocx(collab.url, documentId, TABLE_CELL_REVISIONS_FIXTURE);
  const clientA = await openDocx(TABLE_CELL_REVISIONS_FIXTURE, { collaboration: { url: collab.url, documentId }, userName: "Alice" });
  const clientB = await openDocx(TABLE_CELL_REVISIONS_FIXTURE, { collaboration: { url: collab.url, documentId }, userName: "Bob" });

  const blocks = (await clientB.document.blocks.list({ includeText: true })).blocks;
  const targetBlock = blocks.find((block) => block.nodeType === "paragraph" && (block.text ?? "").length > 0 && block.nodeId !== "3EAAE701");

  const bInsert = await attempt(() =>
    clientB.document.insert(
      { target: { kind: "selection", start: { kind: "text", blockId: targetBlock.nodeId, offset: 0 }, end: { kind: "text", blockId: targetBlock.nodeId, offset: 0 } }, value: "Bob was here. " },
      { changeMode: "tracked" },
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const aDecide = await attempt(() => clientA.document.trackChanges.decide({ decision: "accept", target: { kind: "id", id: "0d04441d5675f9a707ce4aab" } }));

  await closeDocx(clientA);
  await closeDocx(clientB);
  await seed.release();
  collab.stop();

  return { bInsert, aDecide };
}

const results = {};
results["two collaborators concurrent (B inserts, A decides)"] = await twoCollaboratorsConcurrent();
console.log("two collaborators concurrent (B inserts, A decides):");
console.log(`  B insert: ${JSON.stringify(results["two collaborators concurrent (B inserts, A decides)"].bInsert)}`);
console.log(`  A decide: ${JSON.stringify(results["two collaborators concurrent (B inserts, A decides)"].aDecide)}`);

for (const operation of operations) {
  const outOfRoom = await withoutRoom(operation.fixture, operation.run);
  const inRoom = await withRoom(operation.fixture, operation.run);
  results[operation.name] = { outOfRoom, inRoom };
  console.log(`${operation.name}:`);
  console.log(`  out-of-room: ${JSON.stringify(outOfRoom.outcome)} | capability: ${JSON.stringify(outOfRoom.capability)}`);
  console.log(`  in-room:     ${JSON.stringify(inRoom.outcome)} | capability: ${JSON.stringify(inRoom.capability)}`);
}

console.log("\n=== SD-01 summary ===");
console.log(JSON.stringify(results, null, 2));

const matrixResults = operations.map((operation) => [operation.name, results[operation.name]]);
const invalidContextInRoomOnly = matrixResults.filter(
  ([, result]) => result.outOfRoom.outcome.ok && !result.inRoom.outcome.ok && result.inRoom.outcome.code === "INVALID_CONTEXT",
);

console.log(`\nOperations that succeeded out-of-room but failed in-room with INVALID_CONTEXT: ${invalidContextInRoomOnly.length} of ${operations.length}`);
for (const [name, result] of invalidContextInRoomOnly) {
  console.log(`  - ${name}: in-room ${JSON.stringify(result.inRoom.outcome)}`);
}

const verdict = invalidContextInRoomOnly.length > 0 ? "REPRODUCES" : "NEEDS REPRO (not reproduced in this matrix)";

const repoRootPrefix = `${resolvePath(HERE, "..")}/`;
const reportJson = JSON.stringify(
  { superdocVersion: SUPERDOC_VERSION, verdict, invalidContextInRoomOnlyCount: invalidContextInRoomOnly.length, results },
  null,
  2,
).replaceAll(repoRootPrefix, "");

writeFileSync(resolvePath(HERE, `results-${SUPERDOC_VERSION}.json`), reportJson);

console.log(`\nVERDICT: ${verdict}`);
