/**
 * A small independent TSV reader of the kind Anki's importer is: lines starting with `#` are header
 * comments, a field may be wrapped in double quotes (with `""` for a quote), and a quoted field may
 * contain tabs and line breaks. Written separately from the exporter so a round trip means something.
 */
export function parseTsv(text: string): { headers: string[]; rows: string[][] } {
  const headers: string[] = [];
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "#" && (i === 0 || text[i - 1] === "\n")) {
      const end = text.indexOf("\n", i);
      headers.push(text.slice(i, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    const row: string[] = [];
    for (;;) {
      let field = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= text.length) throw new Error("unterminated quoted field");
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          field += text[i++];
        }
      } else {
        while (i < text.length && text[i] !== "\t" && text[i] !== "\n") field += text[i++];
      }
      row.push(field);
      if (text[i] === "\t") {
        i++;
        continue;
      }
      if (text[i] === "\n") i++;
      break;
    }
    rows.push(row);
  }
  return { headers, rows };
}
