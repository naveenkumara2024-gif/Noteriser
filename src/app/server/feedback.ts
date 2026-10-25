import Type from "typebox";
import Value from "typebox/value";
import { FEEDBACK_KINDS } from "@/core/ports/store";
import { ApiError, errorResponse } from "./errors";
import type { Runtime } from "./runtime";

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;
export const MAX_NOTE_CHARS = 500;
const MAX_BODY_BYTES = 8 * 1024;

const Body = Type.Object(
  {
    itemId: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.Union([
      Type.Literal("wrong"),
      Type.Literal("unclear"),
      Type.Literal("missing_context"),
    ]),
    note: Type.Optional(Type.String({ maxLength: MAX_NOTE_CHARS })),
  },
  { additionalProperties: false },
);

/**
 * `POST /api/runs/{id}/feedback`: an instructor marks one shown item "wrong", "unclear" or "missing
 * context", with an optional note. It is stored with the run, so it disappears when the run is
 * deleted or expires. The item must be one the run actually showed.
 */
export async function postFeedback(id: string, request: Request, rt: Runtime): Promise<Response> {
  const bad = (
    message: string,
    status = 400,
    code: "invalid_request" | "too_large" = "invalid_request",
  ) => errorResponse(new ApiError(status, code, message));

  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return bad("Send JSON.", 415);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    return bad("That is too long.", 413, "too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("The request body is not valid JSON.");
  }
  if (!Value.Check(Body, raw)) {
    return bad(
      `Send {"itemId": "...", "kind": "${FEEDBACK_KINDS.join('" | "')}", "note": "optional, up to ${MAX_NOTE_CHARS} characters"}.`,
    );
  }

  const run = RUN_ID.test(id) ? await rt.store.getRun(id) : undefined;
  if (!run) {
    return errorResponse(
      new ApiError(
        404,
        "not_found",
        "That run does not exist. It may have been deleted or expired.",
      ),
    );
  }
  const shown = run.result
    ? [...run.result.summary, ...run.result.glossary, ...run.result.questions].map(
        (s) => s.envelope.itemId,
      )
    : [];
  if (!shown.includes(raw.itemId)) return bad("That item is not part of this run's results.");

  await rt.store.addFeedback(id, {
    itemId: raw.itemId,
    kind: raw.kind,
    note: (raw.note ?? "").trim(),
    at: rt.clock().toISOString(),
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
