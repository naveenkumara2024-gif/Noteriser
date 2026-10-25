/**
 * "Owner session": the browser that started a run gets an HttpOnly cookie for that run, and the
 * audit export (which contains the full source text) requires it. Anyone with the run's link can
 * read its results, as before; only the person who made the run can download the audit file.
 * It is a courtesy boundary for a classroom server, not authentication.
 */
const NAME = (runId: string): string => `nb_owner_${runId}`;

export function ownerCookie(runId: string, ttlHours: number, secure: boolean): string {
  return [
    `${NAME(runId)}=1`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.round(ttlHours * 3600)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function isOwner(request: Request, runId: string): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").some((c) => c.trim() === `${NAME(runId)}=1`);
}
