/**
 * Turn instructors' feedback into candidate regression cases for human review.
 *
 *   npm run feedback:export
 *
 * Reads feedback from the run database (NOTERISER_DB, default data/noteriser.db) and writes one
 * candidate per marked item to eval/regressions/candidates/. They are NOT loaded by the evaluation
 * until a person reviews one (decides what was wrong, sets `failureType`, and moves it up to
 * eval/regressions/). Feedback is kept only as long as its run, so export before the run expires.
 *
 * The files contain the run's source text. They are as sensitive as the notes themselves.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidatesFromFeedback } from "../eval/lib/feedback";
import { SqliteRunStore } from "../src/store/sqlite";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const path = process.env.NOTERISER_DB ?? "data/noteriser.db";
if (!existsSync(path)) {
  console.error(`No database at ${path}. Nothing to export.`);
  process.exit(2);
}

const store = SqliteRunStore.open(path);
const feedback = await store.listFeedback();
if (feedback.length === 0) {
  console.log("No feedback has been left.");
  process.exit(0);
}

const { candidates, skipped } = await candidatesFromFeedback(store, feedback);
const dir = join("eval", "regressions", "candidates");
mkdirSync(dir, { recursive: true });
for (const c of candidates)
  writeFileSync(join(dir, c.file), `${JSON.stringify(c.case, null, 2)}\n`);

console.log(
  `${feedback.length} feedback marks -> ${candidates.length} candidate case(s) in ${dir}`,
);
for (const s of skipped)
  console.log(`  skipped ${s.itemId} (run ${s.runId.slice(0, 8)}): ${s.why}`);
if (candidates.length > 0) {
  console.log(
    "Review each file: set label and failureType, then move it to eval/regressions/ so `npm run eval:ci` loads it.",
  );
}
store.close();
