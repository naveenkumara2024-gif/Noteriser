import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DraftItem } from "../core/generate/types";
import type { RunEvent, RunResult } from "../core/pipeline/types";
import type {
  Feedback,
  FeedbackKind,
  RunStatus,
  RunStore,
  StoredEvent,
  StoredFeedback,
  StoredRun,
} from "../core/ports/store";
import type { SourceDoc } from "../core/schema/source";
import type { Verification } from "../core/verify/verify";
import { toJsonl, toStoredEvent } from "./jsonl";

/**
 * Numbered migrations; the database's `PRAGMA user_version` records how many have run, so opening
 * an existing file applies only the new ones and opening it twice changes nothing. Never edit a
 * migration that has shipped: append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE runs (
    run_id      TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    status      TEXT NOT NULL,
    doc_json    TEXT,
    result_json TEXT
  );
  CREATE INDEX runs_created_at ON runs (created_at);

  CREATE TABLE events (
    run_id TEXT    NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
    seq    INTEGER NOT NULL,
    json   TEXT    NOT NULL,
    PRIMARY KEY (run_id, seq)
  );

  CREATE TABLE drafts (
    run_id  TEXT    NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
    item_id TEXT    NOT NULL,
    attempt INTEGER NOT NULL,
    json    TEXT    NOT NULL,
    PRIMARY KEY (run_id, item_id, attempt)
  );

  CREATE TABLE verifications (
    run_id  TEXT    NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
    item_id TEXT    NOT NULL,
    attempt INTEGER NOT NULL,
    json    TEXT    NOT NULL,
    PRIMARY KEY (run_id, item_id, attempt)
  );
  `,
  `
  CREATE TABLE feedback (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    kind    TEXT NOT NULL,
    note    TEXT NOT NULL,
    at      TEXT NOT NULL
  );
  CREATE INDEX feedback_run ON feedback (run_id);
  `,
];

/** The few fields a store logs. Source text and claims must never appear here. */
export interface StoreLog {
  info(obj: Record<string, unknown>, msg: string): void;
}

interface Row {
  [column: string]: unknown;
}

/** Durable `RunStore` on Node's built-in `node:sqlite` (no native dependency). */
export class SqliteRunStore implements RunStore {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly log: StoreLog | undefined,
  ) {}

  /**
   * Open (creating if needed) the database at `path`, or `:memory:`. WAL keeps readers and the
   * writer from blocking each other; `secure_delete` overwrites deleted rows so purged source text
   * does not linger in the file; foreign keys make deleting a run remove all of its rows.
   */
  static open(path: string, options: { log?: StoreLog } = {}): SqliteRunStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA secure_delete = ON");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    SqliteRunStore.migrate(db);
    return new SqliteRunStore(db, options.log);
  }

  private static migrate(db: DatabaseSync): void {
    const row = db.prepare("PRAGMA user_version").get() as Row | undefined;
    const current = Number(row?.user_version ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      db.exec("BEGIN");
      try {
        db.exec(MIGRATIONS[v] ?? "");
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  get schemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as Row | undefined;
    return Number(row?.user_version ?? 0);
  }

  close(): void {
    this.db.close();
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async createRun(runId: string, createdAt: Date): Promise<void> {
    this.db
      .prepare("INSERT INTO runs (run_id, created_at, status) VALUES (?, ?, 'running')")
      .run(runId, createdAt.toISOString());
    this.log?.info({ runId }, "run created");
  }

  async saveDoc(runId: string, doc: SourceDoc): Promise<void> {
    this.db
      .prepare("UPDATE runs SET doc_json = ? WHERE run_id = ?")
      .run(JSON.stringify(doc), runId);
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO events (run_id, seq, json) VALUES (?, ?, ?)")
      .run(runId, event.seq, JSON.stringify(toStoredEvent(event)));
  }

  async saveDrafts(runId: string, attempt: 1 | 2, drafts: readonly DraftItem[]): Promise<void> {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO drafts (run_id, item_id, attempt, json) VALUES (?, ?, ?, ?)",
    );
    this.transaction(() => {
      for (const d of drafts) insert.run(runId, d.itemId, attempt, JSON.stringify(d));
    });
  }

  async saveVerifications(
    runId: string,
    attempt: 1 | 2,
    verifications: readonly Verification[],
  ): Promise<void> {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO verifications (run_id, item_id, attempt, json) VALUES (?, ?, ?, ?)",
    );
    this.transaction(() => {
      for (const v of verifications) insert.run(runId, v.itemId, attempt, JSON.stringify(v));
    });
  }

  async saveResult(runId: string, result: RunResult): Promise<void> {
    this.db
      .prepare("UPDATE runs SET result_json = ?, status = ? WHERE run_id = ?")
      .run(JSON.stringify(result), result.status, runId);
    this.log?.info(
      {
        runId,
        status: result.status,
        generated: result.report.generated,
        removed: result.report.removed,
      },
      "run saved",
    );
  }

  async addFeedback(runId: string, feedback: Feedback): Promise<boolean> {
    const exists = this.db.prepare("SELECT 1 FROM runs WHERE run_id = ?").get(runId);
    if (!exists) return false;
    this.db
      .prepare("INSERT INTO feedback (run_id, item_id, kind, note, at) VALUES (?, ?, ?, ?, ?)")
      .run(runId, feedback.itemId, feedback.kind, feedback.note, feedback.at);
    // Item ids and the kind only: the note is the instructor's words about source text.
    this.log?.info({ runId, itemId: feedback.itemId, kind: feedback.kind }, "feedback added");
    return true;
  }

  async listFeedback(): Promise<StoredFeedback[]> {
    const rows = this.db
      .prepare("SELECT run_id, item_id, kind, note, at FROM feedback ORDER BY at, id")
      .all() as Row[];
    return rows.map((r) => ({
      runId: String(r.run_id),
      itemId: String(r.item_id),
      kind: String(r.kind) as FeedbackKind,
      note: String(r.note),
      at: String(r.at),
    }));
  }

  async getRun(runId: string): Promise<StoredRun | undefined> {
    const run = this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      | Row
      | undefined;
    if (!run) return undefined;

    const all = (sql: string): Row[] => this.db.prepare(sql).all(runId) as Row[];
    const parse = <T>(row: Row): T => JSON.parse(String(row.json)) as T;
    const attemptOf = (row: Row): 1 | 2 => (Number(row.attempt) === 2 ? 2 : 1);

    return {
      runId: String(run.run_id),
      createdAt: String(run.created_at),
      status: String(run.status) as RunStatus,
      ...(run.doc_json ? { doc: JSON.parse(String(run.doc_json)) as SourceDoc } : {}),
      events: all("SELECT json FROM events WHERE run_id = ? ORDER BY seq").map((r) =>
        parse<StoredEvent>(r),
      ),
      drafts: all(
        "SELECT attempt, json FROM drafts WHERE run_id = ? ORDER BY item_id, attempt",
      ).map((r) => ({ attempt: attemptOf(r), item: parse<DraftItem>(r) })),
      verifications: all(
        "SELECT attempt, json FROM verifications WHERE run_id = ? ORDER BY item_id, attempt",
      ).map((r) => ({ attempt: attemptOf(r), item: parse<Verification>(r) })),
      ...(run.result_json ? { result: JSON.parse(String(run.result_json)) as RunResult } : {}),
      feedback: all(
        "SELECT item_id, kind, note, at FROM feedback WHERE run_id = ? ORDER BY at, id",
      ).map((r) => ({
        itemId: String(r.item_id),
        kind: String(r.kind) as FeedbackKind,
        note: String(r.note),
        at: String(r.at),
      })),
    };
  }

  async deleteRun(runId: string): Promise<boolean> {
    const info = this.db.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
    const deleted = Number(info.changes) > 0;
    if (deleted) this.log?.info({ runId }, "run deleted");
    return deleted;
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const info = this.db.prepare("DELETE FROM runs WHERE created_at < ?").run(cutoff.toISOString());
    const removed = Number(info.changes);
    if (removed > 0) {
      this.log?.info({ removed }, "expired runs purged");
      // Fold the write-ahead log into the main file so deleted rows leave no readable copy behind.
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    return removed;
  }

  async exportJsonl(runId: string): Promise<string | undefined> {
    const run = await this.getRun(runId);
    return run ? toJsonl(run) : undefined;
  }
}
