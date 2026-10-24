"use client";

import { useCallback, useRef, useState } from "react";
import type { RunEvent } from "@/core/pipeline";
import { copy } from "./copy";
import { initialProgress, type ProgressState, reduceProgress } from "./progress";
import { parseSse } from "./sse";

export type RunInput = { kind: "text"; text: string } | { kind: "file"; file: File };

export type RunPhase =
  | { name: "idle" }
  | { name: "running"; progress: ProgressState }
  | { name: "failed"; message: string }
  | { name: "cancelled" };

/** Readable text for a non-2xx response from `POST /api/runs`. */
async function problemFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return `The server refused the request (${res.status}).`;
}

/**
 * Starts a run and follows its event stream. `onFinished(runId)` is called once the stream has
 * ended after a `done` event, which is when the server has stored the run and its page can load.
 */
export function useRun(onFinished: (runId: string) => void) {
  const [phase, setPhase] = useState<RunPhase>({ name: "idle" });
  const controller = useRef<AbortController | null>(null);

  const start = useCallback(
    async (input: RunInput) => {
      const abort = new AbortController();
      controller.current = abort;
      let progress = initialProgress;
      setPhase({ name: "running", progress });

      try {
        const res =
          input.kind === "text"
            ? await fetch("/api/runs", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: input.text }),
                signal: abort.signal,
              })
            : await fetch("/api/runs", {
                method: "POST",
                body: (() => {
                  const form = new FormData();
                  form.set("file", input.file);
                  return form;
                })(),
                signal: abort.signal,
              });

        if (!res.ok || !res.body) {
          setPhase({ name: "failed", message: await problemFrom(res) });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const message of parsed.messages) {
            progress = reduceProgress(progress, JSON.parse(message.data) as RunEvent);
          }
          if (parsed.messages.length > 0) setPhase({ name: "running", progress });
        }

        if (progress.runId) onFinished(progress.runId);
        else if (progress.error?.code === "aborted") setPhase({ name: "cancelled" });
        else {
          setPhase({
            name: "failed",
            message: progress.error?.message ?? "The run ended without a result.",
          });
        }
      } catch (e) {
        if (abort.signal.aborted) setPhase({ name: "cancelled" });
        else setPhase({ name: "failed", message: copy.home.networkError });
        void e;
      } finally {
        controller.current = null;
      }
    },
    [onFinished],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);
  return { phase, start, cancel };
}
