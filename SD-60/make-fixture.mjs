import { writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimalDocx } from "../harness/lib/ooxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const bodyXml = '<w:p><w:r><w:t xml:space="preserve">Seed paragraph for a collaboration room.</w:t></w:r></w:p>';

const buffer = await buildMinimalDocx({ bodyXml });
const outPath = resolvePath(HERE, "seed.docx");
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath}`);
