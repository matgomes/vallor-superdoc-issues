import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx, exportDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_FIXTURE = resolvePath(HERE, "../_fixtures/tc-probe-00-clean-backspace-base.docx");

const opened = await openDocx(BASE_FIXTURE);
const doc = opened.document;

await doc.blocks.merge({
  changeMode: "tracked",
  first: { kind: "block", nodeType: "paragraph", nodeId: "00000002" },
  second: { kind: "block", nodeType: "listItem", nodeId: "00000003" },
});

const { buffer } = await exportDocx(doc, "review-preserving");
writeFileSync(resolvePath(HERE, "paragraph-mark-merge-tracked.docx"), buffer);
await closeDocx(opened);
console.log("wrote paragraph-mark-merge-tracked.docx");
