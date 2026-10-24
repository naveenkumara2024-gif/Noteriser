import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "@/core/ingest";
import type { SourceDoc } from "@/core/schema";

async function parse(text: string): Promise<SourceDoc> {
  const r = await parseDocument({ kind: "text", text });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** The lore §6.1 sample: 3 sections, 15 sentences. */
export async function fixtureDoc(): Promise<SourceDoc> {
  return parse(readFileSync(resolve(process.cwd(), "fixtures/lecture7.md"), "utf8"));
}

/** `sections` x `perSection` sentences; with the defaults (4 x 12 = 48) it exceeds the long-document threshold. */
export async function longDoc(sections = 4, perSection = 12): Promise<SourceDoc> {
  const text = Array.from({ length: sections }, (_, s) => {
    const body = Array.from(
      { length: perSection },
      (_, i) => `Fact ${s + 1}.${i + 1} concerns widget ${i + 1} in topic ${s + 1}.`,
    ).join(" ");
    return `## Topic ${s + 1}\n\n${body}`;
  }).join("\n\n");
  return parse(text);
}
