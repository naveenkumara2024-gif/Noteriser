"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { RunResult } from "@/core/pipeline";
import { copy, docWarningLabel } from "../copy";
import { CircleCheck, CircleDashed, FileText, Info, Loader, TriangleAlert, X } from "../icons";
import { type ProgressState, stageStatus, stagesFor } from "../progress";
import type { RunPhase } from "../use-run";

type Tab = "summary" | "details";

const time = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
};

function RunningSummary({ progress, plain }: { progress: ProgressState; plain: boolean }) {
  const stages = stagesFor(plain);
  const t = copy.progress;
  // The one "Step n of N" announcement is the composer's status line; the stage list is here.
  return (
    <>
      <ol className="nb-stages">
        {stages.map((stage) => {
          const status = stageStatus(progress, stage);
          return (
            <li key={stage}>
              {status === "done" ? (
                <CircleCheck size={16} />
              ) : status === "active" ? (
                <Loader size={16} className="nb-spin" />
              ) : (
                <CircleDashed size={16} />
              )}
              <span>
                {t.stageLabel[stage]} <span className="nb-time">({t.stageState[status]})</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="nb-empty">
        {t.counts(progress.drafted, progress.checked, progress.repaired, progress.removed)}
      </p>
    </>
  );
}

function ResultSummary({ result }: { result: RunResult }) {
  const r = result.report;
  return (
    <>
      <h3 className="mt-3 text-sm font-semibold">{copy.panel.reportHeading}</h3>
      <dl className="nb-dl">
        <dt>Generated</dt>
        <dd>{r.generated}</dd>
        <dt>Supported</dt>
        <dd>{r.supported}</dd>
        <dt>To check (partial)</dt>
        <dd>{r.partial}</dd>
        <dt>Removed</dt>
        <dd>{r.removed}</dd>
        {r.unreviewed > 0 && (
          <>
            <dt>Not yet checked</dt>
            <dd>{r.unreviewed}</dd>
          </>
        )}
        <dt>Summary coverage</dt>
        <dd>{Math.round(r.coveragePercent)}% of sections</dd>
      </dl>
      <p className="mt-3 text-sm font-medium">
        {r.reconciles ? copy.report.reconciles(r.generated) : copy.report.mismatch}
      </p>
      {r.partial > 0 && <p className="nb-empty">{copy.panel.flagged(r.partial)}</p>}
      {result.degraded && <Notice>{copy.results.degraded}</Notice>}
      {result.status === "incomplete" && <Notice>{copy.results.incomplete}</Notice>}
      {result.status === "failed" && <Notice>{copy.results.failed}</Notice>}
    </>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <p className="nb-msg mt-3 flex gap-2" data-tone="warn">
      <TriangleAlert size={16} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

function ResultDetails({ result }: { result: RunResult }) {
  const docWarnings = result.doc?.warnings ?? [];
  if (result.warnings.length === 0 && docWarnings.length === 0) {
    return <p className="nb-empty">{copy.panel.noNotices}</p>;
  }
  return (
    <>
      <h3 className="mt-3 text-sm font-semibold">{copy.panel.noticesHeading}</h3>
      <ul className="nb-log mt-2" style={{ gridTemplateColumns: "1fr" }}>
        {docWarnings.map((w) => (
          <li key={`${w.kind}-${w.location?.line ?? ""}-${w.detail}`} style={{ display: "block" }}>
            <strong>{docWarningLabel[w.kind]}.</strong> {w.detail}
          </li>
        ))}
        {result.warnings.map((w) => (
          <li key={`${w.code}-${w.message}`} style={{ display: "block" }}>
            {w.message}
          </li>
        ))}
      </ul>
    </>
  );
}

function ActivityLog({ progress }: { progress: ProgressState }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a line is added
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [progress.activity.length]);
  if (progress.activity.length === 0) return <p className="nb-empty">{copy.panel.noLog}</p>;
  return (
    <div
      ref={box}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling log must be reachable by keyboard
      tabIndex={0}
      role="log"
      aria-live="off"
      aria-label={copy.panel.logLabel}
      className="mt-3 max-h-[60dvh] overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      <ol className="nb-log">
        {progress.activity.map((line) => (
          <li key={line.seq}>
            <time dateTime={line.at}>{time(line.at)}</time>
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ActivityPanelBody({
  phase,
  plain,
  shown,
  onClose,
  inline,
}: {
  phase: RunPhase;
  plain: boolean;
  shown: RunResult | null;
  onClose: () => void;
  inline: boolean;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const running = phase.name === "running";

  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const order: Tab[] = ["summary", "details"];
    const next =
      e.key === "ArrowRight" || e.key === "ArrowLeft"
        ? (index + 1) % 2
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? 1
            : -1;
    if (next < 0) return;
    e.preventDefault();
    const target = order[next];
    if (target) setTab(target);
    tabs.current[next]?.focus();
  }

  const tabButton = (value: Tab, label: string, Icon: typeof Info, index: number) => (
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`${id}-panel`}
      tabIndex={tab === value ? 0 : -1}
      ref={(el) => {
        tabs.current[index] = el;
      }}
      onClick={() => setTab(value)}
      onKeyDown={(e) => onKey(e, index)}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <aside aria-label={copy.panel.title} className="flex min-h-0 flex-1 flex-col">
      <div className="nb-pane-head">
        <h2 className="nb-pane-title">{copy.panel.title}</h2>
        <button
          type="button"
          className="nb-icon-btn is-bare"
          aria-label={copy.panel.close}
          data-tip={copy.panel.close}
          data-panel-close
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="nb-pane-pad">
        <div className="nb-seg" role="tablist" aria-label={copy.panel.tabs}>
          {tabButton("summary", copy.panel.summary, FileText, 0)}
          {tabButton("details", copy.panel.details, Info, 1)}
        </div>
      </div>
      <div
        className="nb-scroll"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
        tabIndex={0}
        data-inline={inline}
      >
        {running ? (
          tab === "summary" ? (
            <RunningSummary progress={phase.progress} plain={plain} />
          ) : (
            <ActivityLog progress={phase.progress} />
          )
        ) : shown ? (
          tab === "summary" ? (
            <ResultSummary result={shown} />
          ) : (
            <ResultDetails result={shown} />
          )
        ) : (
          <p className="nb-empty">{copy.panel.idle}</p>
        )}
      </div>
    </aside>
  );
}
