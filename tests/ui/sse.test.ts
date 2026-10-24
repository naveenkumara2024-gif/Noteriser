import { describe, expect, it } from "vitest";
import { parseSse } from "@/ui/sse";

describe("parseSse", () => {
  it("returns complete messages and keeps the unfinished tail", () => {
    const a = parseSse('event: stage\ndata: {"a":1}\n\nevent: draft\nda');
    expect(a.messages).toEqual([{ event: "stage", data: '{"a":1}' }]);
    expect(a.rest).toBe("event: draft\nda");
    const b = parseSse(`${a.rest}ta: 2\n\n`);
    expect(b.messages).toEqual([{ event: "draft", data: "2" }]);
    expect(b.rest).toBe("");
  });

  it("drops heartbeat comments, handles CRLF, joins multi-line data, defaults the event name", () => {
    const { messages } = parseSse(": heartbeat\r\n\r\ndata: one\r\ndata: two\r\n\r\n");
    expect(messages).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("splits a message across chunk boundaries at any byte", () => {
    const wire = "event: a\nid: 1\ndata: x\n\n: heartbeat\n\nevent: b\ndata: y\n\n";
    for (let cut = 0; cut <= wire.length; cut++) {
      const first = parseSse(wire.slice(0, cut));
      const second = parseSse(first.rest + wire.slice(cut));
      expect([...first.messages, ...second.messages]).toEqual([
        { event: "a", data: "x" },
        { event: "b", data: "y" },
      ]);
    }
  });
});
