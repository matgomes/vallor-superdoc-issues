import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuperDocClient } from "@superdoc/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolvePath(HERE, "indemnification-cross-reference.docx");

const BOOKMARK_NAME = "Ref100001";
const HEADING_TEXT = "Indemnification";
const REF_PARAGRAPH_TEXT = "As provided in Section , the Supplier shall indemnify the Customer for any losses arising from a breach of this Agreement.";
const INSERTION_OFFSET = REF_PARAGRAPH_TEXT.indexOf(", the Supplier");
const NEXT_PARAGRAPH_TEXT = "This clause survives termination of the Agreement.";

const client = createSuperDocClient({ runtime: "v2" });
await client.connect();
const doc = await client.open({});

await doc.create.heading({ text: HEADING_TEXT, level: 1 });
await doc.create.paragraph({ text: REF_PARAGRAPH_TEXT });
await doc.create.paragraph({ text: NEXT_PARAGRAPH_TEXT });

const blocks = (await doc.blocks.list({ includeText: true })).blocks;
const heading = blocks.find((block) => block.nodeType === "heading");
const refParagraph = blocks.find((block) => block.text === REF_PARAGRAPH_TEXT);

const bookmark = await doc.bookmarks.insert({
  name: BOOKMARK_NAME,
  at: { kind: "text", segments: [{ blockId: heading.nodeId, range: { start: 0, end: heading.text.length } }] },
});
console.log("bookmark insert:", JSON.stringify(bookmark));

const field = await doc.fields.insert({
  mode: "raw",
  at: { kind: "text", segments: [{ blockId: refParagraph.nodeId, range: { start: INSERTION_OFFSET, end: INSERTION_OFFSET } }] },
  instruction: `REF ${BOOKMARK_NAME} \\r \\h`,
  cachedResultText: HEADING_TEXT,
});
console.log("field insert:", JSON.stringify(field));

const exported = await doc.export.toDocx({ mode: "original" });
writeFileSync(OUT_PATH, Buffer.from(exported.contentBase64, "base64"));
console.log("wrote", OUT_PATH);

await doc.close({ discard: true });
await client.dispose();
process.exit(0);
