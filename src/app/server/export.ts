import { renderAnkiTsv, renderAuditJson, renderMarkdown, renderText } from "@/core/export";
import { ApiError, errorResponse } from "./errors";
import { isOwner } from "./owner";
import type { Runtime } from "./runtime";

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;

const FORMATS = {
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  txt: { type: "text/plain; charset=utf-8", ext: "txt" },
  tsv: { type: "text/tab-separated-values; charset=utf-8", ext: "tsv" },
  json: { type: "application/json; charset=utf-8", ext: "json" },
} as const;
type Format = keyof typeof FORMATS;

const isFormat = (s: string | null): s is Format => s !== null && s in FORMATS;

/** `notebridge-<date>-<first 8 id characters>.<ext>`, with nothing in it that could escape the header or the folder. */
export function exportFilename(createdAt: string, runId: string, ext: string): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(createdAt)?.[0] ?? "undated";
  const short = runId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "run";
  return `notebridge-${date}-${short}.${ext}`;
}

/**
 * `GET /api/runs/{id}/export?format=md|txt|tsv|json`, plus `wording=plain` and `flagged=1`.
 * Exports are built from the stored result and never call a model. The audit file needs the owner
 * cookie because it contains the source text.
 */
export async function exportRun(id: string, request: Request, rt: Runtime): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isFormat(format)) {
    return errorResponse(
      new ApiError(400, "invalid_request", "Choose a format: md, txt, tsv or json."),
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
  if (!run.result) {
    return errorResponse(new ApiError(409, "not_ready", "That run has not finished yet."));
  }
  if (format === "json" && !isOwner(request, id)) {
    return errorResponse(
      new ApiError(
        403,
        "forbidden",
        "The audit file contains the full source text, so only the browser that made the run can download it.",
      ),
    );
  }

  const options = {
    wording:
      url.searchParams.get("wording") === "plain" ? ("plain" as const) : ("original" as const),
    generatedAt: run.createdAt,
  };
  const body =
    format === "md"
      ? renderMarkdown(run.result, options)
      : format === "txt"
        ? renderText(run.result, options)
        : format === "tsv"
          ? renderAnkiTsv(run.result, {
              ...options,
              includeFlagged: url.searchParams.get("flagged") === "1",
            })
          : renderAuditJson(run);

  const { type, ext } = FORMATS[format];
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${exportFilename(run.createdAt, id, ext)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
