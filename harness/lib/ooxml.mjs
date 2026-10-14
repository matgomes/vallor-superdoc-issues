import JSZip from "jszip";

const CONTENT_TYPES_BASE = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function commentXml({ id, author = "Reviewer", date = "2026-10-12T12:00:00Z", text }) {
  return `<w:comment w:id="${id}" w:author="${author}" w:date="${date}"><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:comment>`;
}

function buildDocumentXml(bodyXml) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
    `<w:body>${bodyXml}<w:sectPr/></w:body></w:document>`
  );
}

export async function buildMinimalDocx({ bodyXml, comments }) {
  const zip = new JSZip();
  const hasComments = Array.isArray(comments) && comments.length > 0;
  const contentTypes = hasComments
    ? `${CONTENT_TYPES_BASE}<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`
    : `${CONTENT_TYPES_BASE}</Types>`;
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", buildDocumentXml(bodyXml));
  if (hasComments) {
    zip.file(
      "word/_rels/document.xml.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
    );
    zip.file(
      "word/comments.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        comments.map(commentXml).join("") +
        "</w:comments>",
    );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
