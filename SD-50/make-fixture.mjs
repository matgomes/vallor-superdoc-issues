import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const plainParagraph = '<w:p><w:r><w:t xml:space="preserve">Plain single-run paragraph for comment anchoring.</w:t></w:r></w:p>';

const splitRunParagraph =
  "<w:p>" +
  '<w:r><w:t xml:space="preserve">Split-run paragraph </w:t></w:r>' +
  '<w:r><w:t xml:space="preserve">for comment </w:t></w:r>' +
  '<w:r><w:t xml:space="preserve">anchoring.</w:t></w:r>' +
  "</w:p>";

const tableXml =
  "<w:tbl>" +
  '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  "<w:tr><w:tc><w:p><w:r><w:t xml:space=\"preserve\">Table cell paragraph.</w:t></w:r></w:p></w:tc></w:tr>" +
  "</w:tbl>";

const paragraphAfterTable = '<w:p><w:r><w:t xml:space="preserve">Paragraph immediately after a table, for comment anchoring.</w:t></w:r></w:p>';

const paragraphWithBookmark =
  "<w:p>" +
  '<w:bookmarkStart w:id="0" w:name="AnchorTest"/>' +
  '<w:r><w:t xml:space="preserve">Paragraph with a bookmark, for comment anchoring.</w:t></w:r>' +
  '<w:bookmarkEnd w:id="0"/>' +
  "</w:p>";

const firstParagraphInDoc = '<w:p><w:r><w:t xml:space="preserve">First paragraph in the whole document, for comment anchoring.</w:t></w:r></w:p>';

const lastParagraphInDoc = '<w:p><w:r><w:t xml:space="preserve">Last paragraph in the whole document, for comment anchoring.</w:t></w:r></w:p>';

const bodyXml =
  firstParagraphInDoc + plainParagraph + splitRunParagraph + tableXml + paragraphAfterTable + paragraphWithBookmark + lastParagraphInDoc;

const buffer = await buildMinimalDocx({ bodyXml });
const outPath = resolvePath(HERE, "near-identical-paragraphs.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
