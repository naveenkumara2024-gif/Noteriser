import type { RunIndex } from "@/core/ports/run-index";
import { ownedRunIds } from "./owner";
import type { Runtime } from "./runtime";

/** Most runs one history response lists. */
export const HISTORY_LIMIT = 50;

const hasIndex = (store: object): store is RunIndex =>
  typeof (store as Partial<RunIndex>).summaries === "function";

/**
 * `GET /api/runs`: summaries of the runs this browser started (found through its per-run owner
 * cookies), newest first. Titles and counts only: never source sentences, item text or notes.
 * Deleted or expired runs simply do not appear.
 */
export async function listRuns(request: Request, rt: Runtime): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  // Cookie order is not time order; the store sorts, then the newest are kept.
  const ids = ownedRunIds(request).slice(0, 200);
  const runs = ids.length > 0 && hasIndex(rt.store) ? await rt.store.summaries(ids) : [];
  return Response.json({ runs: runs.slice(0, HISTORY_LIMIT), ttlHours: rt.ttlHours }, { headers });
}
