import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const bodyXml =
  "<w:p>" +
  '<w:commentRangeStart w:id="1"/>' +
  '<w:commentRangeStart w:id="2"/>' +
  '<w:r><w:t xml:space="preserve">Shared anchor text with two comments.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>' +
  '<w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r>' +
  "</w:p>" +
  '<w:p><w:r><w:t xml:space="preserve">Closing paragraph with no comments.</w:t></w:r></w:p>';

const buffer = await buildMinimalDocx({
  bodyXml,
  comments: [
    { id: "1", author: "Reviewer", text: "First comment" },
    { id: "2", author: "Reviewer", text: "Second comment" },
  ],
});

const outPath = resolvePath(HERE, "shared-anchor-comments.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
