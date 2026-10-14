import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const listItemParagraph = (text) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const firstListItem = listItemParagraph("First list item for comment anchoring.");
const secondListItem = listItemParagraph("Second list item for comment anchoring.");
const emptyParagraph = '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>';
const paragraphWithLineBreak =
  '<w:p><w:r><w:t xml:space="preserve">Before break.</w:t></w:r><w:r><w:br/></w:r>' +
  '<w:r><w:t xml:space="preserve">After break, for comment anchoring.</w:t></w:r></w:p>';
const paragraphWithHyperlinkField =
  "<w:p>" +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.com" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t xml:space="preserve">link text</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> and more text for anchoring.</w:t></w:r>' +
  "</w:p>";

const bodyXml = firstListItem + secondListItem + emptyParagraph + paragraphWithLineBreak + paragraphWithHyperlinkField;

const buffer = await buildMinimalDocx({ bodyXml });
const outPath = resolvePath(HERE, "near-identical-paragraphs-2.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
