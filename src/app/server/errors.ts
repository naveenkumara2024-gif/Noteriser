export type ApiErrorCode =
  | "invalid_request"
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "rate_limited"
  | "not_found"
  | "not_ready"
  | "forbidden"
  | "not_configured";

/** A request we refuse with a 4xx (or 503) and a message the person can act on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(e: ApiError): Response {
  return Response.json(
    { error: { code: e.code, message: e.message } },
    { status: e.status, headers: { "Cache-Control": "no-store", ...e.headers } },
  );
}
