import { zipStored } from "./zip";

export type DocxBlock =
  | { heading: 1 | 2 | 3; text: string }
  | { p: string }
  | { table: string[][] };

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t: string): string => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;

function block(b: DocxBlock): string {
  if ("heading" in b) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${b.heading}"/></w:pPr>${run(b.text)}</w:p>`;
  }
  if ("p" in b) return `<w:p>${run(b.p)}</w:p>`;
  const rows = b.table
    .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:p>${run(c)}</w:p></w:tc>`).join("")}</w:tr>`)
    .join("");
  return `<w:tbl>${rows}</w:tbl>`;
}

/** Build a small but valid DOCX in memory (headings via real Word styles, plus paragraphs and tables). */
export function makeDocx(blocks: DocxBlock[]): Uint8Array {
  const styles = [1, 2, 3]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`,
    )
    .join("");

  return zipStored({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>",
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">${styles}</w:styles>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${blocks.map(block).join("")}</w:body></w:document>`,
  });
}
