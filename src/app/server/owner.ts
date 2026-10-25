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

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;
const PREFIX = "nb_owner_";

/** Run ids this browser holds an owner cookie for, in cookie order. Malformed names are ignored. */
export function ownedRunIds(request: Request): string[] {
  const out: string[] = [];
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (!name?.startsWith(PREFIX) || value !== "1") continue;
    const id = name.slice(PREFIX.length);
    if (RUN_ID.test(id)) out.push(id);
  }
  return out;
}

export function isOwner(request: Request, runId: string): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").some((c) => c.trim() === `${NAME(runId)}=1`);
}
