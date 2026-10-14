// SD-32: build a synthetic fixture that actually contains the full table-structure
// and formatting revision vocabulary (w:cellIns, w:cellDel, w:cellMerge, row-level
// w:trPr>w:ins/w:del, and the w:*PrChange family), starting from the tiny synthetic
// scaffold `tc-probe-06-replacement-table-cell-placeholder.docx` (already has one
// plain w:ins/w:del pair inside a table cell).
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const DATE = "2026-10-13T00:00:00Z";
const AUTHOR = "Probe";

function cell(text, tcPrExtra = "") {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/>${tcPrExtra}</w:tcPr>` +
    `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`
  );
}

const rowCellRevisions =
  "<w:tr>" +
  cell(
    "Inserted cell text",
    `<w:cellIns w:id="9102" w:author="${AUTHOR}" w:date="${DATE}"/>` +
      `<w:tcPrChange w:id="9103" w:author="${AUTHOR}" w:date="${DATE}"><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr></w:tcPrChange>`,
  ) +
  cell("Deleted cell text", `<w:cellDel w:id="9104" w:author="${AUTHOR}" w:date="${DATE}"/>`) +
  "</w:tr>";

const rowCellMerge =
  "<w:tr>" +
  cell(
    "Merge start cell",
    `<w:vMerge w:val="restart"/><w:cellMerge w:id="9105" w:author="${AUTHOR}" w:date="${DATE}" w:vMerge="rest"/>`,
  ) +
  cell(
    "Merge continuation cell",
    `<w:vMerge w:val="continue"/><w:cellMerge w:id="9106" w:author="${AUTHOR}" w:date="${DATE}" w:vMerge="cont"/>`,
  ) +
  "</w:tr>";

const rowInserted =
  `<w:tr><w:trPr><w:ins w:id="9107" w:author="${AUTHOR}" w:date="${DATE}"/></w:trPr>` +
  cell("Inserted row cell 1") +
  cell("Inserted row cell 2") +
  "</w:tr>";

const rowDeleted =
  `<w:tr><w:trPr><w:del w:id="9108" w:author="${AUTHOR}" w:date="${DATE}"/></w:trPr>` +
  cell("Deleted row cell 1") +
  cell("Deleted row cell 2") +
  "</w:tr>";

const rowPropChange =
  "<w:tr><w:trPr>" +
  '<w:trHeight w:val="500" w:hRule="atLeast"/>' +
  `<w:trPrChange w:id="9109" w:author="${AUTHOR}" w:date="${DATE}"><w:trPr/></w:trPrChange>` +
  "</w:trPr>" +
  cell("Row property change cell 1") +
  cell("Row property change cell 2") +
  "</w:tr>";

const formattingParagraph =
  "<w:p><w:pPr>" +
  '<w:jc w:val="center"/>' +
  `<w:pPrChange w:id="9110" w:author="${AUTHOR}" w:date="${DATE}"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange>` +
  "</w:pPr>" +
  "<w:r><w:rPr><w:b/>" +
  `<w:rPrChange w:id="9111" w:author="${AUTHOR}" w:date="${DATE}"><w:rPr/></w:rPrChange>` +
  '</w:rPr><w:t xml:space="preserve">Paragraph alignment and run formatting tracked change.</w:t></w:r></w:p>';

const transforms = [
  // Cosmetic: the scaffold's placeholder cell text echoes a company-shaped name
  // ("MIRA Consulting Company") that isn't in the project's anonymization map.
  // Replace it with an unambiguous generic placeholder before this file is committed.
  (xml) => xml.replace("TEST - MIRA Consulting Company", "TEST - Example Consulting Co."),
  // 1. w:tblPrChange on the table's own tblPr.
  (xml) =>
    xml.replace(
      '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>',
      '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/>' +
        `<w:tblPrChange w:id="9101" w:author="${AUTHOR}" w:date="${DATE}"><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr></w:tblPrChange>` +
        "</w:tblPr>",
    ),
  // 2. Five new rows: cellIns+tcPrChange / cellDel, cellMerge pair, row-inserted,
  // row-deleted, row-property-change (trPrChange only).
  (xml) =>
    xml.replace(
      "</w:tbl>",
      rowCellRevisions + rowCellMerge + rowInserted + rowDeleted + rowPropChange + "</w:tbl>",
    ),
  // 3. A paragraph carrying both pPrChange and rPrChange.
  (xml) =>
    xml.replace(
      '<w:p><w:r><w:t xml:space="preserve">Closing paragraph that stays.</w:t></w:r></w:p>',
      formattingParagraph +
        '<w:p><w:r><w:t xml:space="preserve">Closing paragraph that stays.</w:t></w:r></w:p>',
    ),
];

const scaffold = readFileSync("scaffold.docx");
const zip = await JSZip.loadAsync(scaffold);
const sourceXml = await zip.file("word/document.xml").async("string");
const finalXml = transforms.reduce((xml, transform) => transform(xml), sourceXml);

zip.file("word/document.xml", finalXml);
const out = await zip.generateAsync({ type: "nodebuffer" });
writeFileSync("fixture-table-revision-vocabulary.docx", out);
console.log(`wrote fixture-table-revision-vocabulary.docx (${out.length} bytes)`);
