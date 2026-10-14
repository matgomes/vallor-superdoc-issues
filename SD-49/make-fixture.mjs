import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const trackedInsertion = (id, text) =>
  `<w:ins w:id="${id}" w:author="Jane Doe" w:date="2026-10-12T12:00:00Z"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;

function fillerPage(pageNumber) {
  return (
    '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">' +
    `Filler paragraph for page ${pageNumber}. No comments or tracked changes here.</w:t></w:r></w:p>`
  );
}

const earlyChange = '<w:p><w:r><w:t xml:space="preserve">Before early change. </w:t></w:r>' + trackedInsertion("1", "Early tracked change.") + "</w:p>";
const earlyComment =
  '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">Early commented text.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>';

const middleFillerPages = Array.from({ length: 100 }, (_, index) => fillerPage(index + 2)).join("");

const lateChange = '<w:p><w:r><w:t xml:space="preserve">Before late change. </w:t></w:r>' + trackedInsertion("2", "Late tracked change.") + "</w:p>";
const lateComment =
  '<w:p><w:commentRangeStart w:id="2"/><w:r><w:t xml:space="preserve">Late commented text.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r></w:p>';

const bodyXml = earlyChange + earlyComment + middleFillerPages + lateChange + lateComment;

const buffer = await buildMinimalDocx({
  bodyXml,
  comments: [
    { id: "1", author: "Reviewer", text: "Early comment" },
    { id: "2", author: "Reviewer", text: "Late comment" },
  ],
});

const outPath = resolvePath(HERE, "spread-changes-and-comments.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
