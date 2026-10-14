import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_COUNT = 220;

function fillerPage(pageNumber) {
  return (
    '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">' +
    `Filler paragraph for page ${pageNumber}. No comments or tracked changes here.</w:t></w:r></w:p>`
  );
}

const intro =
  '<w:p><w:commentRangeStart w:id="1"/>' +
  '<w:r><w:t xml:space="preserve">Early comment target text on page one.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>';

const fillerPages = Array.from({ length: PAGE_COUNT - 1 }, (_, index) => fillerPage(index + 2)).join("");
const closing = '<w:p><w:r><w:t xml:space="preserve">Last paragraph at the very bottom of the document.</w:t></w:r></w:p>';

const bodyXml = intro + fillerPages + closing;

const buffer = await buildMinimalDocx({
  bodyXml,
  comments: [{ id: "1", author: "Reviewer", text: "Early comment near the top" }],
});

const outPath = resolvePath(HERE, "long-doc-early-comment.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
