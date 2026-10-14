import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const bodyXml =
  '<w:p><w:commentRangeStart w:id="1"/>' +
  '<w:r><w:t xml:space="preserve">Commented paragraph in a fresh collaboration room.</w:t></w:r>' +
  '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>';

const buffer = await buildMinimalDocx({
  bodyXml,
  comments: [{ id: "1", author: "Reviewer", text: "Comment seeded before the room opens" }],
});

const outPath = resolvePath(HERE, "seed-with-comment.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
