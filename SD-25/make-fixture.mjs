import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { openDocx, closeDocx, exportDocx } from "../harness/lib/sdk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_FIXTURE = resolvePath(HERE, "../_fixtures/tc-probe-00-clean-backspace-base.docx");

const opened = await openDocx(BASE_FIXTURE);
const doc = opened.document;

await doc.replace({
  target: { kind: "selection", start: { kind: "text", blockId: "00000001", offset: 0 }, end: { kind: "text", blockId: "00000001", offset: 27 } },
  text: "Widget A costs 150 dollars.",
});

await doc.replace({
  target: { kind: "selection", start: { kind: "text", blockId: "00000004", offset: 0 }, end: { kind: "text", blockId: "00000004", offset: 34 } },
  text: "Widget A costs 100 dollars.",
});

await doc.replace(
  {
    target: { kind: "selection", start: { kind: "text", blockId: "00000004", offset: 15 }, end: { kind: "text", blockId: "00000004", offset: 18 } },
    text: "150",
  },
  { changeMode: "tracked" },
);

const { buffer } = await exportDocx(doc, "review-preserving");
writeFileSync(resolvePath(HERE, "ambiguous-visible-text.docx"), buffer);
await closeDocx(opened);
console.log("wrote ambiguous-visible-text.docx");
