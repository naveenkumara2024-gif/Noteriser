/**
 * Print the numbered source view of a document.
 * Usage: npx tsx scripts/parse.ts <file.txt|.md|.pdf|.docx>
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseDocument } from "../src/core/ingest";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/parse.ts <file>");
  process.exit(2);
}

const result = await parseDocument({
  kind: "file",
  name: basename(path),
  bytes: new Uint8Array(readFileSync(path)),
});

if (!result.ok) {
  console.error(`${result.error.code}: ${result.error.message}`);
  process.exit(1);
}

const doc = result.value;
if (doc.title) console.log(`Title: ${doc.title}\n`);
for (const section of doc.sections) {
  console.log(`== Section ${section.number}: ${section.title}`);
  for (const id of section.sentenceIds) {
    const s = doc.sentences.find((x) => x.id === id);
    console.log(`${id.padEnd(6)} ${s?.text ?? ""}`);
  }
  console.log();
}
console.log(`${doc.stats.sentences} sentences, ${doc.stats.sections} sections`);
if (doc.warnings.length === 0) console.log("warnings: none");
for (const w of doc.warnings) console.log(`warning [${w.kind}]: ${w.detail}`);
