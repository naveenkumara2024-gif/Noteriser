import pino from "pino";
import { createRateLimiter } from "@/app/server/rate-limit";
import type { Runtime } from "@/app/server/runtime";
import { lecture7Fakes } from "@/demo";
import { MemoryRunStore } from "@/store/memory";
import { parseSse, type SseMessage } from "@/ui/sse";
import { LECTURE7 } from "./pipeline";

export { LECTURE7 };

/** A runtime on the scripted lecture-7 fakes with a silent logger and ids `run-0001`, `run-0002`... */
export function testRuntime(over: Partial<Runtime> = {}): Runtime {
  let n = 0;
  return {
    mode: "fake",
    ttlHours: 24,
    limits: {},
    deps: lecture7Fakes(),
    store: new MemoryRunStore(),
    limiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
    clock: () => new Date("2026-10-24T12:00:00.000Z"),
    newId: () => `run-${String(++n).padStart(4, "0")}`,
    log: pino({ level: "silent" }),
    ...over,
  };
}

export const jsonRequest = (body: unknown, init: RequestInit = {}): Request =>
  new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: init.signal,
  });

export function fileRequest(name: string, content: BlobPart, type = "text/plain"): Request {
  const form = new FormData();
  form.set("file", new File([content], name, { type }));
  return new Request("http://localhost/api/runs", { method: "POST", body: form });
}

/** Reads a whole event stream to the end. */
export async function readSse(response: Response): Promise<SseMessage[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const out: SseMessage[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    out.push(...parsed.messages);
  }
  return out;
}
