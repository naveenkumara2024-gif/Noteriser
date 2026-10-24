import { notFound } from "next/navigation";
import { getRuntime } from "@/app/server/runtime";
import { ResultsView } from "@/ui/results/ResultsView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const rt = await getRuntime().catch(() => undefined);
  const run = rt && /^[A-Za-z0-9-]{8,64}$/.test(id) ? await rt.store.getRun(id) : undefined;
  if (!run?.result) notFound();
  return <ResultsView result={run.result} />;
}
