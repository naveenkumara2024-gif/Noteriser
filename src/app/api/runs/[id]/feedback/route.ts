import { postFeedback } from "@/app/server/feedback";
import { runtimeOrError } from "@/app/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/runs/[id]/feedback">,
): Promise<Response> {
  const rt = await runtimeOrError();
  return rt instanceof Response ? rt : postFeedback((await ctx.params).id, request, rt);
}
