import { runPipeline } from "@/core/pipeline";
import { ApiError, errorResponse } from "./errors";
import { readDocument } from "./input";
import { clientKey } from "./rate-limit";
import type { Runtime } from "./runtime";
import { sseResponse } from "./sse";

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;

/** `POST /api/runs`: validate, rate-limit, then stream the run as server-sent events. */
export async function createRun(request: Request, rt: Runtime): Promise<Response> {
  const parsed = await readDocument(request);
  if (!parsed.ok) return errorResponse(parsed.error);

  const taken = rt.limiter.take(clientKey(request.headers));
  if (!taken.ok) {
    return errorResponse(
      new ApiError(
        429,
        "rate_limited",
        `Too many runs from this address. Try again in ${taken.retryAfterSeconds} seconds.`,
        { "Retry-After": String(taken.retryAfterSeconds) },
      ),
    );
  }

  const document = parsed.value;
  const runId = rt.newId();
  const started = Date.now();
  // Sizes and ids only: the source text itself never goes to a log (invariant 7).
  rt.log.info(
    {
      runId,
      mode: rt.mode,
      input: document.kind === "file" ? "file" : "text",
      bytes: document.kind === "file" ? document.bytes.byteLength : document.text.length,
    },
    "run started",
  );

  return sseResponse({
    runId,
    signal: request.signal,
    run: async (emit, signal) => {
      const result = await runPipeline(
        { document, runId },
        {
          ...rt.deps,
          store: rt.store,
          clock: rt.clock,
          newId: rt.newId,
          signal,
          onEvent: emit,
        },
      );
      rt.log.info({ runId, status: result.status, ms: Date.now() - started }, "run finished");
    },
  });
}

/** `GET /api/runs/{id}`: the stored result, or 404 once it was deleted or purged. */
export async function getRun(id: string, rt: Runtime): Promise<Response> {
  const run = RUN_ID.test(id) ? await rt.store.getRun(id) : undefined;
  if (!run) return errorResponse(notFound());
  const headers = { "Cache-Control": "no-store" };
  if (!run.result) {
    return Response.json({ runId: run.runId, status: run.status }, { status: 202, headers });
  }
  return Response.json(
    { runId: run.runId, status: run.status, createdAt: run.createdAt, result: run.result },
    { headers },
  );
}

/** `DELETE /api/runs/{id}`: removes everything stored for the run, including the source text. */
export async function deleteRun(id: string, rt: Runtime): Promise<Response> {
  const removed = RUN_ID.test(id) ? await rt.store.deleteRun(id) : false;
  if (!removed) return errorResponse(notFound());
  rt.log.info({ runId: id }, "run deleted");
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

const notFound = (): ApiError =>
  new ApiError(404, "not_found", "That run does not exist. It may have been deleted or expired.");
