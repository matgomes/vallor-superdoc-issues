import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const trackedInsertion = (id, text) =>
  `<w:ins w:id="${id}" w:author="Jane Doe" w:date="2026-10-12T12:00:00Z"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;

const bodyXml =
  '<w:p><w:r><w:t xml:space="preserve">Intro paragraph that stays.</w:t></w:r></w:p>' +
  '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">Comment target text one.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Before tracked change. </w:t></w:r>' +
  trackedInsertion("1", "Tracked change target text two.") +
  "</w:p>" +
  '<w:p><w:commentRangeStart w:id="2"/><w:r><w:t xml:space="preserve">Before nested. </w:t></w:r>' +
  trackedInsertion("2", "Nested tracked change inside comment.") +
  '<w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Closing paragraph that stays.</w:t></w:r></w:p>';

const buffer = await buildMinimalDocx({
  bodyXml,
  comments: [
    { id: "1", author: "Reviewer", text: "First comment" },
    { id: "2", author: "Reviewer", text: "Nested comment" },
  ],
});

const outPath = resolvePath(HERE, "comments-tc-ids.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
