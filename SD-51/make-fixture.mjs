import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const bodyXml =
  '<w:p><w:r><w:t xml:space="preserve">Base paragraph for a collaborator to stream edits into while a new comment is created elsewhere in the document.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Second paragraph, where the new comment will be anchored.</w:t></w:r></w:p>';

const buffer = await buildMinimalDocx({ bodyXml });
const outPath = resolvePath(HERE, "base-for-streaming.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
