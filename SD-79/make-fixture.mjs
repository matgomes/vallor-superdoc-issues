// Generates two minimal synthetic .docx fixtures for SD-79:
//   synthetic-alternatecontent-broken.docx — a grouped text box (wps:txbx inside wpg:wgp),
//     wrapped in mc:AlternateContent (wps Choice + VML v:group/v:shape Fallback) the way
//     ConvertAPI/SolidFramework PDF->DOCX output emits it, plus a stroke-only custGeom shape
//     (no <a:fill> element at all).
//   synthetic-alternatecontent-fixed.docx — the same two shapes, ungrouped and with an
//     explicit <a:noFill/>, for comparison.
//
// Usage: node SD-79/make-fixture.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const HERE = dirname(fileURLToPath(import.meta.url));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
  'xmlns:w10="urn:schemas-microsoft-com:office:word"',
].join(" ");

// --- Shape A: a text box grouped inside a wpg:wgp drawing group, the way ConvertAPI/
// SolidFramework's PDF->DOCX output emits it — wrapped in mc:AlternateContent with a
// real VML (v:group / v:shape / v:textbox) Fallback, not a bare wpg:wgp. Prior research
// found that a bare (non-AlternateContent) group does NOT trigger the hatched-placeholder
// path; this wrapper is the part that was missing from the earlier minimal repro attempt.
function groupedTextboxAlternateContent(docPrId) {
  const wpsChoice = `<mc:Choice Requires="wps"><w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="2743200" cy="914400"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="${docPrId}" name="Group 1"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic>
      <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
        <wpg:wgp>
          <wpg:cNvGrpSpPr/>
          <wpg:grpSpPr>
            <a:xfrm>
              <a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/>
              <a:chOff x="0" y="0"/><a:chExt cx="2743200" cy="914400"/>
            </a:xfrm>
          </wpg:grpSpPr>
          <wps:wsp>
            <wps:cNvSpPr txBox="1"/>
            <wps:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
              <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
            </wps:spPr>
            <wps:txbx>
              <w:txbxContent>
                <w:p><w:r><w:t>Grouped text box label</w:t></w:r></w:p>
              </w:txbxContent>
            </wps:txbx>
            <wps:bodyPr wrap="square" rtlCol="0"/>
          </wps:wsp>
        </wpg:wgp>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></mc:Choice>`;
  const vmlFallback = `<mc:Fallback><w:pict>
  <v:group id="Group_1" o:spid="_x0000_s1026" style="width:216pt;height:72pt" coordsize="21600,7200" o:gfxdata="" editas="canvas">
    <v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m0,0l0,21600,21600,21600,21600,0xe">
      <v:stroke joinstyle="miter"/>
      <v:path gradientshapeok="t" o:connecttype="rect"/>
    </v:shapetype>
    <v:shape id="TextBox_1" o:spid="_x0000_s1027" type="#_x0000_t202" style="position:absolute;width:21600;height:7200" filled="f" stroked="t">
      <v:textbox>
        <w:txbxContent>
          <w:p><w:r><w:t>Grouped text box label (VML fallback)</w:t></w:r></w:p>
        </w:txbxContent>
      </v:textbox>
    </v:shape>
  </v:group>
</w:pict></mc:Fallback>`;
  return `<mc:AlternateContent>${wpsChoice}${vmlFallback}</mc:AlternateContent>`;
}


// --- Shape A variant: the same grouped AlternateContent text box, but anchored/floating
// (wp:anchor with an absolute position) instead of inline -- this matches how a real
// PDF->DOCX converter lays out an overlapping-shapes page, and differs from the plain
// wp:inline AlternateContent variant above.
function groupedTextboxAlternateContentAnchored(docPrId) {
  const wpsChoice = `<mc:Choice Requires="wps"><w:drawing>
  <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
    <wp:extent cx="2743200" cy="914400"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapNone/>
    <wp:docPr id="${docPrId}" name="Group 2"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic>
      <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
        <wpg:wgp>
          <wpg:cNvGrpSpPr/>
          <wpg:grpSpPr>
            <a:xfrm>
              <a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/>
              <a:chOff x="0" y="0"/><a:chExt cx="2743200" cy="914400"/>
            </a:xfrm>
          </wpg:grpSpPr>
          <wps:wsp>
            <wps:cNvSpPr txBox="1"/>
            <wps:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
              <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
            </wps:spPr>
            <wps:txbx>
              <w:txbxContent>
                <w:p><w:r><w:t>Anchored grouped text box label</w:t></w:r></w:p>
              </w:txbxContent>
            </wps:txbx>
            <wps:bodyPr wrap="square" rtlCol="0"/>
          </wps:wsp>
        </wpg:wgp>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing></mc:Choice>`;
  const vmlFallback = `<mc:Fallback><w:pict>
  <v:group id="Group_2" o:spid="_x0000_s1028" style="position:absolute;width:216pt;height:72pt" coordsize="21600,7200" o:gfxdata="" editas="canvas">
    <v:shapetype id="_x0000_t202b" coordsize="21600,21600" o:spt="202" path="m0,0l0,21600,21600,21600,21600,0xe">
      <v:stroke joinstyle="miter"/>
      <v:path gradientshapeok="t" o:connecttype="rect"/>
    </v:shapetype>
    <v:shape id="TextBox_2" o:spid="_x0000_s1029" type="#_x0000_t202b" style="position:absolute;width:21600;height:7200" filled="f" stroked="t">
      <v:textbox>
        <w:txbxContent>
          <w:p><w:r><w:t>Anchored grouped text box label (VML fallback)</w:t></w:r></w:p>
        </w:txbxContent>
      </v:textbox>
    </v:shape>
  </v:group>
</w:pict></mc:Fallback>`;
  return `<mc:AlternateContent>${wpsChoice}${vmlFallback}</mc:AlternateContent>`;
}

// --- Shape A (fixed): the same text box, ungrouped, as a plain wp:inline drawing
// (no mc:AlternateContent / VML wrapper needed once it's not inside a group).
function ungroupedTextbox(docPrId) {
  return `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="2743200" cy="914400"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="${docPrId}" name="TextBox 1"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic>
      <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wps:wsp>
          <wps:cNvSpPr txBox="1"/>
          <wps:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
            <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
          </wps:spPr>
          <wps:txbx>
            <w:txbxContent>
              <w:p><w:r><w:t>Grouped text box label</w:t></w:r></w:p>
            </w:txbxContent>
          </wps:txbx>
          <wps:bodyPr wrap="square" rtlCol="0"/>
        </wps:wsp>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>`;
}

// --- Shape B: stroke-only custGeom, with or without <a:noFill/>.
function custGeomDrawing(docPrId, fillElement) {
  return `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="1828800" cy="914400"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="${docPrId}" name="Shape 1"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic>
      <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wps:wsp>
          <wps:cNvSpPr/>
          <wps:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
            <a:custGeom>
              <a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>
              <a:rect l="0" t="0" r="0" b="0"/>
              <a:pathLst>
                <a:path w="1828800" h="914400">
                  <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                  <a:lnTo><a:pt x="1828800" y="0"/></a:lnTo>
                  <a:lnTo><a:pt x="1828800" y="914400"/></a:lnTo>
                  <a:lnTo><a:pt x="0" y="914400"/></a:lnTo>
                  <a:close/>
                </a:path>
              </a:pathLst>
            </a:custGeom>
            ${fillElement}
            <a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>
          </wps:spPr>
          <wps:bodyPr/>
        </wps:wsp>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>`;
}

function buildDocument(labelA, drawingA, labelB, drawingB) {
  const body = `<w:p><w:r><w:t xml:space="preserve">${labelA}</w:t></w:r></w:p>
<w:p><w:r>${drawingA}</w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">${labelB}</w:t></w:r></w:p>
<w:p><w:r>${drawingB}</w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">End of document.</w:t></w:r></w:p>
<w:sectPr/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
}

async function writeDocx(outPath, documentXml) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(outPath, buffer);
  console.log(`wrote ${outPath}`);
}

const brokenXml = buildDocument(
  "Shape A (broken): text box grouped inside a wpg:wgp drawing group, wrapped in mc:AlternateContent with a VML Fallback (matches ConvertAPI/SolidFramework PDF->DOCX output).",
  groupedTextboxAlternateContent(1),
  "Shape B (broken): stroke-only custGeom shape, no fill element at all.",
  custGeomDrawing(2, ""),
);
const fixedXml = buildDocument(
  "Shape A (fixed): same text box, ungrouped, its own wp:inline drawing (no AlternateContent needed).",
  ungroupedTextbox(1),
  "Shape B (fixed): same custGeom shape with explicit <a:noFill/>.",
  custGeomDrawing(2, "<a:noFill/>"),
);

await writeDocx(resolvePath(HERE, "synthetic-alternatecontent-broken.docx"), brokenXml);
await writeDocx(resolvePath(HERE, "synthetic-alternatecontent-fixed.docx"), fixedXml);

const anchoredXml = buildDocument(
  "Shape A-anchored (broken): same grouped+AlternateContent text box, floating via wp:anchor instead of wp:inline (matches how PDF->DOCX overlay layouts position shapes).",
  groupedTextboxAlternateContentAnchored(3),
  "Shape B (broken, repeated): stroke-only custGeom shape, no fill element at all.",
  custGeomDrawing(4, ""),
);
await writeDocx(resolvePath(HERE, "synthetic-alternatecontent-anchored-broken.docx"), anchoredXml);
