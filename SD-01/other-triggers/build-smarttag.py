import zipfile
import sys

W = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'
)


def r(t):
    return f'<w:r><w:t xml:space="preserve">{t}</w:t></w:r>'


def ins(i, t):
    return f'<w:ins w:id="{i}" w:author="Reviewer" w:date="2026-10-01T00:00:00Z"><w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:ins>'


def p(pid, inner):
    return f'<w:p w14:paraId="{pid}" w14:textId="77777777">{inner}</w:p>'


smarttag_wrapped = f'<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="place">{r("Wilmington")}</w:smartTag>'

body = "".join(
    [
        p("00000001", r("Control: offices located in Wilmington, fees are payable in thirty days after delivery to the") + ins(1, " designated") + r(" premises.")),
        p("00000002", r("Flagged: offices located in ") + smarttag_wrapped + r(", fees are payable in thirty days after delivery to the") + ins(2, " designated") + r(" premises.")),
    ]
)

doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr/></w:body></w:document>'

ct = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)

with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", ct)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/document.xml", doc)
