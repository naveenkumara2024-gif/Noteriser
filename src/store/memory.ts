import type { DraftItem } from "../core/generate/types";
import type { RunEvent, RunResult } from "../core/pipeline/types";
import type { RunStore, StoredRun } from "../core/ports/store";
import type { SourceDoc } from "../core/schema/source";
import type { Verification } from "../core/verify/verify";
import { toJsonl, toStoredEvent } from "./jsonl";

/** In-memory `RunStore` for tests, fake mode and demos. Same contract as the SQLite store. */
export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRun>();

  private need(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }

  async createRun(runId: string, createdAt: Date): Promise<void> {
    // Same as the SQLite primary key: a run id is used once.
    if (this.runs.has(runId)) throw new Error(`run ${runId} already exists`);
    this.runs.set(runId, {
      runId,
      createdAt: createdAt.toISOString(),
      status: "running",
      drafts: [],
      verifications: [],
      events: [],
    });
  }

  async saveDoc(runId: string, doc: SourceDoc): Promise<void> {
    this.need(runId).doc = structuredClone(doc);
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    const run = this.need(runId);
    const stored = structuredClone(toStoredEvent(event));
    const at = run.events.findIndex((e) => e.seq === stored.seq);
    if (at >= 0) run.events[at] = stored;
    else run.events.push(stored);
  }

  async saveDrafts(runId: string, attempt: 1 | 2, drafts: readonly DraftItem[]): Promise<void> {
    const run = this.need(runId);
    for (const item of drafts) {
      const at = run.drafts.findIndex(
        (d) => d.attempt === attempt && d.item.itemId === item.itemId,
      );
      const entry = { attempt, item: structuredClone(item) };
      if (at >= 0) run.drafts[at] = entry;
      else run.drafts.push(entry);
    }
  }

  async saveVerifications(
    runId: string,
    attempt: 1 | 2,
    verifications: readonly Verification[],
  ): Promise<void> {
    const run = this.need(runId);
    for (const item of verifications) {
      const at = run.verifications.findIndex(
        (v) => v.attempt === attempt && v.item.itemId === item.itemId,
      );
      const entry = { attempt, item: structuredClone(item) };
      if (at >= 0) run.verifications[at] = entry;
      else run.verifications.push(entry);
    }
  }

  async saveResult(runId: string, result: RunResult): Promise<void> {
    const run = this.need(runId);
    run.result = structuredClone(result);
    run.status = result.status;
  }

  async getRun(runId: string): Promise<StoredRun | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    return structuredClone({ ...run, events: [...run.events].sort((a, b) => a.seq - b.seq) });
  }

  async deleteRun(runId: string): Promise<boolean> {
    return this.runs.delete(runId);
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const limit = cutoff.toISOString();
    let removed = 0;
    for (const [id, run] of this.runs) {
      if (run.createdAt < limit) {
        this.runs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async exportJsonl(runId: string): Promise<string | undefined> {
    const run = await this.getRun(runId);
    return run ? toJsonl(run) : undefined;
  }
}
