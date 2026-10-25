import { listRuns } from "@/app/server/history";
import { createRun } from "@/app/server/runs";
import { runtimeOrError } from "@/app/server/runtime";

// NLI and the SQLite store need Node, not the Edge runtime; every request is different.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : listRuns(request, rt);
}

export async function POST(request: Request): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : createRun(request, rt);
}
