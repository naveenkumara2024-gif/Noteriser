/**
 * Turn a confirmed error into a permanent regression case.
 *
 *   npx tsx scripts/run.ts fixtures/lecture7.md --export .cache/run.jsonl      (or any stored run)
 *   npx tsx eval/add-regression.ts --from .cache/run.jsonl --item sum-7 --label bad --failure outside_fact --id reg-007
 *
 * Writes eval/regressions/<id>.json. `npm run eval:ci` loads every file in that folder and fails if
 * the verifier ever stops getting it right.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { StoredRun } from "../src/core/ports/store";
import { FAILURE_TYPES, type FailureType } from "./lib/cases";
import { regressionFromRun } from "./lib/regression";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    item: { type: "string" },
    label: { type: "string" },
    failure: { type: "string" },
    id: { type: "string" },
    attempt: { type: "string", default: "1" },
  },
  strict: false,
});

if (
  !values.from ||
  !values.item ||
  !values.id ||
  (values.label !== "good" && values.label !== "bad")
) {
  console.error(
    "Usage: --from run.jsonl --item <itemId> --label good|bad [--failure <type>] --id <case id>",
  );
  process.exit(2);
}
if (values.failure && !(FAILURE_TYPES as readonly string[]).includes(String(values.failure))) {
  console.error(`--failure must be one of: ${FAILURE_TYPES.join(", ")}`);
  process.exit(2);
}

interface Record_ {
  kind: string;
  runId?: string;
  createdAt?: string;
  status?: StoredRun["status"];
  doc?: StoredRun["doc"];
  attempt?: 1 | 2;
  item?: StoredRun["drafts"][number]["item"];
}

/** Rebuilds the parts of a stored run that a regression needs from a JSONL audit trail. */
function readRun(path: string): StoredRun {
  const run: StoredRun = {
    runId: "",
    createdAt: "",
    status: "complete",
    drafts: [],
    verifications: [],
    events: [],
  };
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const rec = JSON.parse(line) as Record_;
    if (rec.kind === "run")
      Object.assign(run, { runId: rec.runId, createdAt: rec.createdAt, status: rec.status });
    else if (rec.kind === "doc") run.doc = rec.doc;
    else if (rec.kind === "draft" && rec.attempt && rec.item) {
      run.drafts.push({ attempt: rec.attempt, item: rec.item });
    }
  }
  return run;
}

try {
  const c = await regressionFromRun(readRun(String(values.from)), {
    id: String(values.id),
    itemId: String(values.item),
    label: values.label,
    failureType: values.failure ? (String(values.failure) as FailureType) : undefined,
    attempt: values.attempt === "2" ? 2 : 1,
  });
  const path = `eval/regressions/${c.id}.json`;
  writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`);
  console.log(`Wrote ${path}. It will be checked by \`npm run eval:ci\`.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
