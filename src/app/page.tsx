import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/config/env";
import { copy } from "@/ui/copy";
import { HomeForm } from "@/ui/HomeForm";

// The mode comes from the server's environment, so this page must not be prerendered at build time.
export const dynamic = "force-dynamic";

function demoMode(): boolean {
  try {
    return getEnv().llmMode === "fake";
  } catch {
    return false; // a broken live setup is reported when a run starts
  }
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const sample = await readFile(join(process.cwd(), "fixtures", "lecture7.md"), "utf8");
  const { deleted } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{copy.productName}</h1>
        <p className="mt-3 max-w-prose">{copy.tagline}</p>
      </div>
      <HomeForm
        sampleText={sample}
        demoMode={demoMode()}
        notice={deleted === "1" ? copy.home.deleted : undefined}
      />
    </div>
  );
}
