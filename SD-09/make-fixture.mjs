import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuperDocClient } from "@superdoc/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolvePath(HERE, "schedule-of-fees.docx");

const HEADER_ROW = ["Service", "Fee", "Payment terms"];
const DATA_ROWS = [
  ["Hosting", "900 per month", "Net 45"],
  ["Support", "300 per month", "Net 30"],
];
const ALL_ROWS = [HEADER_ROW, ...DATA_ROWS];

const client = createSuperDocClient({ runtime: "v2" });
await client.connect();
const doc = await client.open({});

await doc.create.heading({ text: "Schedule 1 - Fees", level: 1 });
const blocksBeforeTable = (await doc.blocks.list({ includeText: true })).blocks;
const heading = blocksBeforeTable[blocksBeforeTable.length - 1];

const createdTable = await doc.create.table({
  rows: ALL_ROWS.length,
  columns: HEADER_ROW.length,
  at: { kind: "after", target: { kind: "block", nodeType: heading.nodeType, nodeId: heading.nodeId } },
});
console.log("created table:", JSON.stringify(createdTable));

const cellAssignments = ALL_ROWS.flatMap((row, rowIndex) =>
  row.map((text, columnIndex) => ({ rowIndex, columnIndex, text })),
);

for (const assignment of cellAssignments) {
  await doc.tables.setCellText({
    target: { kind: "block", nodeType: "table", nodeId: createdTable.table.nodeId },
    rowIndex: assignment.rowIndex,
    columnIndex: assignment.columnIndex,
    text: assignment.text,
  });
}

const exported = await doc.export.toDocx({ mode: "original" });
writeFileSync(OUT_PATH, Buffer.from(exported.contentBase64, "base64"));
console.log("wrote", OUT_PATH);

await doc.close({ discard: true });
await client.dispose();
process.exit(0);
