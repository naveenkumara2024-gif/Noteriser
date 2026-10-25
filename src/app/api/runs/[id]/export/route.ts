import { exportRun } from "@/app/server/export";
import { runtimeOrError } from "@/app/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/runs/[id]/export">,
): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : exportRun((await ctx.params).id, request, rt);
}
