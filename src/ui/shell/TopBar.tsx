"use client";

import Link from "next/link";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { RunSummary } from "@/core/ports/run-index";
import { copy } from "../copy";
import { DisplaySettings } from "../DisplaySettings";
import { Bell, Info, LogoMark, PanelLeft, PanelRight } from "../icons";

/** Escape or a click outside closes a popover, and Escape returns focus to its button. */
function useDismiss(open: boolean, close: () => void, host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      close();
      host.current?.querySelector<HTMLElement>("button")?.focus();
    };
    const onPointer = (e: PointerEvent): void => {
      if (e.target instanceof Node && host.current && !host.current.contains(e.target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, host]);
}

function line(run: RunSummary): string {
  const t = copy.shell;
  if (run.status === "running") return t.notificationStatus.running(run.title);
  if (run.status === "failed") return t.notificationStatus.failed(run.title);
  if (run.status === "incomplete") return t.notificationStatus.incomplete(run.title);
  const c = run.counts;
  return c
    ? t.notificationFinished(run.title, c.supported, c.partial, c.removed)
    : t.notificationStatus.running(run.title);
}

/**
 * The bell. Client-side only: it reads the run list the sidebar already loaded and counts the
 * runs that finished while this page was open and have not been looked at. Nothing is stored.
 */
function Notifications({
  runs,
  unseen,
  onOpen,
}: {
  runs: RunSummary[];
  unseen: number;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(() => setOpen(false)).current;
  useDismiss(open, close, host);
  const recent = runs.slice(0, 5);

  return (
    <div ref={host} className="nb-pop-host">
      <button
        type="button"
        className="nb-icon-btn"
        aria-label={copy.shell.notifications(unseen)}
        aria-expanded={open}
        aria-controls={id}
        data-tip={copy.shell.notifications(unseen)}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) onOpen();
        }}
      >
        <Bell size={18} />
        {unseen > 0 && (
          <span className="nb-dot" aria-hidden="true">
            {unseen}
          </span>
        )}
      </button>
      {open && (
        <section id={id} className="nb-pop" aria-label={copy.shell.notificationsTitle}>
          <h2>{copy.shell.notificationsTitle}</h2>
          {recent.length === 0 ? (
            <p className="nb-note m-0">{copy.shell.notificationsNone}</p>
          ) : (
            <ul>
              {recent.map((run) => (
                <li key={run.runId}>
                  <Link href={`/runs/${run.runId}`} onClick={close}>
                    {line(run)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The trust notice (invariant 6): words, an icon, on every page, never dismissible. */
export function TrustNotice() {
  return (
    <div role="note" className="nb-trust">
      <Info size={16} className="mt-0.5 flex-none" />
      <p>{copy.trustNotice}</p>
    </div>
  );
}

export function TopBar({
  runs,
  unseen,
  onSeen,
  sidebarOpen,
  sidebarControls,
  onToggleSidebar,
  panelOpen,
  panelControls,
  onTogglePanel,
  sidebarToggleRef,
  panelToggleRef,
}: {
  runs: RunSummary[];
  unseen: number;
  onSeen: () => void;
  sidebarOpen: boolean;
  sidebarControls: string;
  onToggleSidebar: () => void;
  panelOpen: boolean;
  panelControls: string;
  onTogglePanel: () => void;
  sidebarToggleRef: RefObject<HTMLButtonElement | null>;
  panelToggleRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="nb-topbar">
      <button
        type="button"
        ref={sidebarToggleRef}
        className="nb-icon-btn"
        aria-expanded={sidebarOpen}
        aria-controls={sidebarControls}
        aria-label={sidebarOpen ? copy.shell.historyHide : copy.shell.historyShow}
        data-tip={sidebarOpen ? copy.shell.historyHide : copy.shell.historyShow}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={18} />
      </button>
      <Link href="/" className="nb-logo">
        <LogoMark />
        {copy.productName}
      </Link>
      <div className="nb-topbar-end">
        <Notifications runs={runs} unseen={unseen} onOpen={onSeen} />
        <DisplaySettings />
        <button
          type="button"
          ref={panelToggleRef}
          className="nb-icon-btn"
          aria-expanded={panelOpen}
          aria-controls={panelControls}
          aria-label={panelOpen ? copy.shell.activityHide : copy.shell.activityShow}
          data-tip={panelOpen ? copy.shell.activityHide : copy.shell.activityShow}
          onClick={onTogglePanel}
        >
          <PanelRight size={18} />
        </button>
      </div>
    </header>
  );
}
