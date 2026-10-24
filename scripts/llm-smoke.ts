/**
 * Prove the whole model setup with two tiny structured calls, one per role (generator, judge).
 * It goes through the same path as the app (provider resolution, custom endpoints, tool calling),
 * so it also shows whether your models support tool calls, which the generators require.
 * Usage: npx tsx scripts/llm-smoke.ts [--profile nararouter|openrouter]
 *   --profile   use this provider profile for this run instead of LLM_PROFILE in .env.local
 * Prints SKIPPED and exits 0 when the model setup is incomplete.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import Type from "typebox";
import {
  describeSelection,
  EnvError,
  parseEnv,
  warnIfJudgeEqualsGenerator,
} from "../src/config/env";
import type { LlmRole } from "../src/core/ports/llm";
import { createPiLlmClient } from "../src/llm/pi";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const Reply = Type.Object({ word: Type.String() }, { additionalProperties: false });

const { values } = parseArgs({ options: { profile: { type: "string" } } });
if (values.profile) process.env.LLM_PROFILE = values.profile;

async function main(): Promise<void> {
  let env: ReturnType<typeof parseEnv>;
  try {
    env = parseEnv({ ...process.env, LLM_MODE: "live" });
  } catch (e) {
    if (e instanceof EnvError) {
      console.log(`SKIPPED\n${e.message}`);
      return;
    }
    throw e;
  }
  console.log(`Using:\n  ${describeSelection(env)}`);

  const client = await createPiLlmClient(env);
  if (!client.ok) {
    console.log(`SKIPPED (${client.error.message})`);
    return;
  }
  const warning = warnIfJudgeEqualsGenerator(env);
  if (warning) console.log(`note: ${warning}`);

  let failed = false;
  for (const role of ["generator", "judge"] as LlmRole[]) {
    const ref = role === "generator" ? env.genModel : env.judgeModel;
    const where = ref?.baseUrl ? ` @ ${ref.baseUrl}` : "";
    const r = await client.value.generateStructured({
      role,
      system: "You are a connectivity test.",
      user: 'Call the tool with word set to "OK".',
      toolName: "submit_word",
      schema: Reply,
      temperature: 0,
    });
    const label = `${role.padEnd(9)} ${ref?.provider}:${ref?.model}${where}`;
    if (r.ok) {
      const { usage, value } = r.value;
      console.log(
        `OK     ${label}\n       reply=${JSON.stringify(value)} tokens in=${usage.inputTokens} out=${usage.outputTokens} cost=$${usage.costUsd.toFixed(6)}`,
      );
    } else {
      failed = true;
      console.log(`FAILED ${label}\n       ${r.error.code}: ${r.error.message}`);
      if (r.error.code === "no_tool_call" || r.error.code === "invalid_args") {
        console.log("       This model may not support tool calls reliably; try another model.");
      }
    }
  }
  if (failed) process.exitCode = 1;
}

await main();
