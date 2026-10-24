import type { RunEvent } from "@/core/pipeline";

export const HEARTBEAT_MS = 15_000;

/** One event in the wire format: `event:` is the event type, `id:` its sequence number. */
export function encodeEvent(event: RunEvent): string {
  return `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SseOptions {
  runId: string;
  /** Runs the work, calling `emit` for each event. Resolves when the run (including its storage) is finished. */
  run: (emit: (event: RunEvent) => void, signal: AbortSignal) => Promise<void>;
  /** The HTTP request's signal: a client that goes away aborts the run. */
  signal?: AbortSignal;
  heartbeatMs?: number;
}

/**
 * Streams a run as server-sent events. The stream closes only after `run` resolves, so a client
 * that navigates when the stream ends can rely on the run being stored. A comment line every
 * `heartbeatMs` keeps proxies from closing a quiet connection during a long model call.
 */
export function sseResponse(options: SseOptions): Response {
  const abort = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stop = (): void => abort.abort();
  options.signal?.addEventListener("abort", stop, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      heartbeat = setInterval(() => send(": heartbeat\n\n"), options.heartbeatMs ?? HEARTBEAT_MS);

      void (async () => {
        try {
          await options.run((event) => send(encodeEvent(event)), abort.signal);
        } catch {
          // runPipeline reports its own failures as events and never throws; this is the last resort.
          send(
            `event: error\ndata: ${JSON.stringify({
              type: "error",
              code: "internal",
              message: "The run stopped unexpectedly.",
            })}\n\n`,
          );
        } finally {
          clearInterval(heartbeat);
          options.signal?.removeEventListener("abort", stop);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already cancelled by the client
            }
          }
        }
      })();
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      stop();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Run-Id": options.runId,
    },
  });
}
