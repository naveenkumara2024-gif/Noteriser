export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Splits a buffer of server-sent-event text into complete messages and the unfinished rest, which
 * the caller prepends to the next chunk. Comment lines (heartbeats) are dropped. `fetch` is used
 * instead of `EventSource` because the run is started with a POST.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const text = buffer.replaceAll("\r\n", "\n");
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const messages: SseMessage[] = [];

  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}
