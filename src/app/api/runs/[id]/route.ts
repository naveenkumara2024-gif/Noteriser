import { deleteRun, getRun } from "@/app/server/runs";
import { runtimeOrError } from "@/app/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : getRun((await ctx.params).id, rt);
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : deleteRun((await ctx.params).id, rt);
}
