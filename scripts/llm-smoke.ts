/**
 * One tiny completion through pi-ai to prove the call path (model lookup, auth, usage, cost).
 * Usage: npx tsx scripts/llm-smoke.ts [provider:model]   (defaults to GEN_MODEL)
 * Exits 0 with SKIPPED when no model is configured or the provider has no key.
 */
import { existsSync } from "node:fs";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { EnvError, parseEnv, parseModelRef } from "../src/config/env";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main(): Promise<void> {
  let ref = parseModelRef(process.argv[2] ?? "");
  if (!ref) {
    try {
      ref = parseEnv(process.env).genModel;
    } catch (e) {
      if (e instanceof EnvError) {
        console.error(e.message);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
  }
  if (!ref) {
    console.log("SKIPPED (no model: pass provider:model or set GEN_MODEL)");
    return;
  }

  const models = builtinModels();
  const model = models.getModel(ref.provider, ref.model);
  if (!model) {
    console.error(`Unknown model ${ref.provider}:${ref.model} in the installed pi-ai catalog`);
    process.exitCode = 1;
    return;
  }

  const auth = await models.getAuth(model);
  if (!auth) {
    console.log(`SKIPPED (no key for ${ref.provider})`);
    return;
  }
  console.log(`auth: ${auth.source}`);

  const reply = await models.complete(
    model,
    {
      systemPrompt: "Reply with exactly one word.",
      messages: [{ role: "user", content: "Say OK.", timestamp: Date.now() }],
    },
    { temperature: 0, maxTokens: 64 },
  );

  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    console.error(`FAILED (${reply.stopReason}): ${reply.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  const text = reply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  console.log(`model: ${model.provider}:${model.id}`);
  console.log(`text: ${JSON.stringify(text)}`);
  console.log(`usage: in=${reply.usage.input} out=${reply.usage.output}`);
  console.log(`cost: $${reply.usage.cost.total.toFixed(6)}`);
}

await main();
