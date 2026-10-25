"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RunSummary } from "@/core/ports/run-index";
import { copy } from "../copy";
import {
  CircleAlert,
  CircleMinus,
  CircleX,
  Clock,
  Folder,
  FolderOpen,
  Loader,
  PanelLeft,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  User,
  X,
} from "../icons";
import { filterRuns, groupByTitle, type RowStatusKind, rowStatus } from "./history-model";
import { relativeLong, relativeShort } from "./relative-time";
import type { History } from "./use-history";
import type { Viewer } from "./viewer";

type View = "timeline" | "project";

const STATUS_ICON: Record<RowStatusKind, typeof Loader> = {
  running: Loader,
  failed: CircleX,
  incomplete: CircleMinus,
  degraded: TriangleAlert,
  flagged: CircleAlert,
};

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** "Ctrl K" or "⌘ K": decided after mount so the server and the first client render agree. */
function useShortcutHint(): string {
  const [hint, setHint] = useState("Ctrl K");
  useEffect(() => {
    const platform = navigator.platform || navigator.userAgent;
    if (/Mac|iPhone|iPad/i.test(platform)) setHint("⌘ K");
  }, []);
  return hint;
}

function Row({
  run,
  now,
  current,
  onDeleted,
  history,
}: {
  run: RunSummary;
  now: number;
  current: boolean;
  onDeleted: (run: RunSummary, wasCurrent: boolean) => void;
  history: History;
}) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = rowStatus(run);
  const Icon = status ? STATUS_ICON[status] : null;
  const then = Date.parse(run.createdAt);

  async function remove() {
    setFailed(false);
    try {
      const res = await fetch(`/api/runs/${run.runId}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        history.forget(run.runId);
        onDeleted(run, current);
        return;
      }
    } catch {
      // fall through to the message
    }
    setFailed(true);
  }

  if (asking) {
    return (
      <li className="nb-row">
        <fieldset className="nb-confirm">
          <legend className="sr-only">{copy.history.deleteRun(run.title)}</legend>
          <span>{copy.results.deleteConfirm}</span>
          <div>
            <button type="button" className="nb-pill" onClick={remove}>
              {copy.results.deleteYes}
            </button>
            <button type="button" className="nb-pill" onClick={() => setAsking(false)}>
              {copy.results.deleteNo}
            </button>
          </div>
          {failed && <span role="alert">{copy.history.deleteFailed}</span>}
        </fieldset>
      </li>
    );
  }

  return (
    <li className="nb-row">
      <Link
        href={`/runs/${run.runId}`}
        className="nb-row-link"
        aria-current={current ? "page" : undefined}
        title={run.title}
      >
        {Icon && (
          <>
            <Icon
              size={14}
              aria-hidden="true"
              className={status === "running" ? "nb-spin" : undefined}
            />
            <span className="sr-only">{copy.history.status[status as RowStatusKind]}. </span>
          </>
        )}
        <span className="nb-row-title">{run.title}</span>
        <time className="nb-time" dateTime={run.createdAt} aria-hidden="true">
          {relativeShort(now, then)}
        </time>
        <span className="sr-only">, {relativeLong(now, then)}</span>
      </Link>
      <button
        type="button"
        className="nb-row-del"
        aria-label={copy.history.deleteRun(run.title)}
        data-tip={copy.results.deleteRun}
        onClick={() => setAsking(true)}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function Groups({
  runs,
  now,
  currentId,
  onDeleted,
  history,
}: {
  runs: RunSummary[];
  now: number;
  currentId: string | null;
  onDeleted: (run: RunSummary, wasCurrent: boolean) => void;
  history: History;
}) {
  const groups = useMemo(() => groupByTitle(runs), [runs]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const base = useId();
  return (
    <ul className="nb-rows">
      {groups.map((g, i) => {
        const open = !closed.has(g.title);
        const listId = `${base}-${i}`;
        return (
          <li key={g.title}>
            <button
              type="button"
              className="nb-group-title"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() =>
                setClosed((set) => {
                  const next = new Set(set);
                  if (next.has(g.title)) next.delete(g.title);
                  else next.add(g.title);
                  return next;
                })
              }
            >
              {open ? <FolderOpen size={16} /> : <Folder size={16} />}
              <span className="nb-row-title">{g.title}</span>
              <span className="nb-time">{copy.history.groupRuns(g.runs.length)}</span>
            </button>
            <ul id={listId} className="nb-rows nb-nested" hidden={!open}>
              {g.runs.map((run) => (
                <Row
                  key={run.runId}
                  run={run}
                  now={now}
                  current={run.runId === currentId}
                  onDeleted={onDeleted}
                  history={history}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountCard({ ttlHours }: { viewer: Viewer; ttlHours: number | null }) {
  // No sign-in exists yet, so the card is information, not a menu: no chevrons, no dead button.
  return (
    <div className="nb-account">
      <span className="nb-avatar">
        <User size={14} />
      </span>
      <span>
        <span className="nb-account-name">{copy.shell.guest}</span>
        {ttlHours !== null && (
          <span className="nb-account-sub">{copy.shell.retention(ttlHours)}</span>
        )}
      </span>
    </div>
  );
}

export function HistorySidebarBody({
  history,
  view,
  onView,
  currentId,
  viewer,
  inline,
  onCollapse,
  searchRef,
  searchRequest,
}: {
  history: History;
  view: View;
  onView: (view: View) => void;
  currentId: string | null;
  viewer: Viewer;
  inline: boolean;
  onCollapse: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Changes when something (Ctrl+K) asks for the search box to take focus. */
  searchRequest: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const now = useNow();
  const hint = useShortcutHint();
  const searchId = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // After the frame, so a pane that was hidden has been shown by then.
    if (searchRequest > 0) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchRequest, searchRef]);

  const shown = useMemo(() => filterRuns(history.runs, query), [history.runs, query]);
  const searching = query.trim() !== "";

  const onDeleted = useCallback(
    (run: RunSummary, wasCurrent: boolean) => {
      setMessage(copy.history.deleted(run.title));
      if (wasCurrent) router.push("/?deleted=1");
    },
    [router],
  );

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const order: View[] = ["timeline", "project"];
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % order.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index + order.length - 1) % order.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? order.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const target = order[next];
    if (target) onView(target);
    tabs.current[next]?.focus();
  }

  const tabButton = (id: View, label: string, Icon: typeof Clock, index: number) => (
    <button
      type="button"
      role="tab"
      id={`${searchId}-tab-${id}`}
      aria-selected={view === id}
      aria-controls={`${searchId}-panel`}
      tabIndex={view === id ? 0 : -1}
      ref={(el) => {
        tabs.current[index] = el;
      }}
      onClick={() => onView(id)}
      onKeyDown={(e) => onTabKey(e, index)}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <nav aria-label={copy.history.nav} className="flex min-h-0 flex-1 flex-col">
      <div className="nb-pane-head">
        <h2 className="nb-pane-title">{copy.history.title}</h2>
        <button
          type="button"
          className="nb-icon-btn is-bare"
          aria-label={inline ? copy.shell.historyHide : copy.shell.historyClose}
          data-tip={inline ? copy.shell.historyHide : copy.shell.historyClose}
          onClick={onCollapse}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <div className="nb-pane-pad grid gap-3">
        <div className="nb-seg" role="tablist" aria-label={copy.history.tabs}>
          {tabButton("timeline", copy.history.timeline, Clock, 0)}
          {tabButton("project", copy.history.project, Folder, 1)}
        </div>

        <search className="nb-search">
          <Search size={16} aria-hidden="true" />
          <label htmlFor={`${searchId}-q`} className="sr-only">
            {copy.history.searchLabel}
          </label>
          <input
            id={`${searchId}-q`}
            ref={searchRef}
            type="search"
            value={query}
            placeholder={copy.history.searchPlaceholder}
            aria-keyshortcuts="Control+K Meta+K"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              if (query !== "") setQuery("");
              else e.currentTarget.blur();
            }}
          />
          {query !== "" ? (
            <button
              type="button"
              className="nb-icon-btn is-bare"
              style={{ width: "1.75rem", height: "1.75rem" }}
              aria-label={copy.history.searchClear}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          ) : (
            <span className="nb-kbd" aria-hidden="true">
              {hint}
            </span>
          )}
        </search>
      </div>

      <p className="nb-label nb-pane-pad" style={{ paddingInline: "1.5rem" }}>
        {copy.history.yourRuns}
      </p>
      <p role="status" className="sr-only">
        {message ||
          (searching && history.state === "ready" ? copy.history.results(shown.length) : "")}
      </p>

      <div
        className="nb-scroll"
        role="tabpanel"
        id={`${searchId}-panel`}
        aria-labelledby={`${searchId}-tab-${view}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
        tabIndex={0}
        aria-busy={history.state === "loading"}
      >
        {history.state === "loading" && history.runs.length === 0 && (
          <p className="nb-note">{copy.history.loading}</p>
        )}
        {history.state === "error" && (
          <div className="grid gap-2">
            <p className="nb-note" role="alert">
              {copy.history.error}
            </p>
            <button type="button" className="nb-pill" onClick={history.refresh}>
              {copy.history.retry}
            </button>
          </div>
        )}
        {history.state === "ready" && history.runs.length === 0 && (
          <p className="nb-note">{copy.history.empty}</p>
        )}
        {history.state === "ready" && history.runs.length > 0 && shown.length === 0 && (
          <p className="nb-note">{copy.history.noMatch(query.trim())}</p>
        )}
        {shown.length > 0 &&
          (view === "project" ? (
            <Groups
              runs={shown}
              now={now}
              currentId={currentId}
              onDeleted={onDeleted}
              history={history}
            />
          ) : (
            <ul className="nb-rows">
              {shown.map((run) => (
                <Row
                  key={run.runId}
                  run={run}
                  now={now}
                  current={run.runId === currentId}
                  onDeleted={onDeleted}
                  history={history}
                />
              ))}
            </ul>
          ))}
        {history.runs.length >= 50 && <p className="nb-note">{copy.history.limitNote(50)}</p>}
      </div>

      <div className="nb-pane-foot">
        <AccountCard viewer={viewer} ttlHours={history.ttlHours} />
        <Link href="/" className="nb-pill is-wide" data-new-run>
          <Plus size={16} />
          {copy.shell.newStudyAid}
        </Link>
      </div>
    </nav>
  );
}
