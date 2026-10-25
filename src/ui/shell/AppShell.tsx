"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { copy } from "../copy";
import { useSettings } from "../SettingsProvider";
import { ActivityPanelBody } from "./ActivityPanel";
import { HistorySidebarBody } from "./HistorySidebar";
import { Pane } from "./Pane";
import { useRunSession } from "./RunSession";
import { TopBar, TrustNotice } from "./TopBar";
import { useFrameMode } from "./use-frame-mode";
import { useHistory } from "./use-history";
import type { Viewer } from "./viewer";

const SIDE_ID = "nb-history";
const PANEL_ID = "nb-activity";

/**
 * The window around every page: top bar, trust notice, history column, the page itself, and the
 * verification-activity column. All state that decides what is visible lives here.
 */
export function AppShell({ children, viewer }: { children: ReactNode; viewer: Viewer }) {
  const { settings, update } = useSettings();
  const session = useRunSession();
  const pathname = usePathname();
  const history = useHistory(session.historyVersion);
  const frame = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const sideToggle = useRef<HTMLButtonElement>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const mode = useFrameMode(frame, settings.textSize);

  const [ready, setReady] = useState(false);
  const [sideDrawer, setSideDrawer] = useState(false);
  const [panelDrawer, setPanelDrawer] = useState(false);
  /** Set when a run starts: the panel opens for it even if the person had closed it before. */
  const [forced, setForced] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);

  const home = pathname === "/";
  const currentId = /^\/runs\/([^/]+)/.exec(pathname)?.[1] ?? null;

  const sideVisible = settings.sidebar === "open";
  const panelVisible =
    forced || settings.panel === "open" || (settings.panel === "auto" && (home || session.running));

  useEffect(() => setReady(true), []);

  // A run started: show its activity (a column only; a drawer would cover what the person is doing).
  useEffect(() => {
    if (session.startCount > 0) setForced(true);
  }, [session.startCount]);

  // Moving to another page closes a drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path changing is the trigger
  useEffect(() => {
    setSideDrawer(false);
    setPanelDrawer(false);
    // A run's activity was shown for that run; a results page starts with the panel at its default.
    setForced(false);
  }, [pathname]);

  // The sticky columns need the real height of the top bar plus notice (the notice wraps).
  useEffect(() => {
    const el = chrome.current;
    const host = frame.current;
    if (!el || !host) return;
    const measure = (): void => host.style.setProperty("--chrome", `${el.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Past the stage margin the sticky columns may use the whole window height (see shell.css).
  useEffect(() => {
    const host = frame.current;
    if (!host) return;
    let queued = 0;
    const update = (): void => {
      queued = 0;
      const pad = Number.parseFloat(getComputedStyle(host).getPropertyValue("--stage-pad-y")) || 0;
      host.toggleAttribute("data-scrolled", window.scrollY > pad);
    };
    const onScroll = (): void => {
      if (!queued) queued = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (queued) cancelAnimationFrame(queued);
    };
  }, []);

  const toggleSide = useCallback(() => {
    if (mode.sideInline) update({ sidebar: sideVisible ? "closed" : "open" });
    else setSideDrawer((v) => !v);
  }, [mode.sideInline, sideVisible, update]);

  const togglePanel = useCallback(() => {
    if (mode.panelInline) {
      setForced(false);
      update({ panel: panelVisible ? "closed" : "open" });
    } else setPanelDrawer((v) => !v);
  }, [mode.panelInline, panelVisible, update]);

  /** Closing from inside a pane would strand focus on a hidden element: send it to the opener. */
  const collapseSide = useCallback(() => {
    toggleSide();
    requestAnimationFrame(() => sideToggle.current?.focus());
  }, [toggleSide]);
  const collapsePanel = useCallback(() => {
    togglePanel();
    requestAnimationFrame(() => panelToggle.current?.focus());
  }, [togglePanel]);

  // Ctrl+K / ⌘K: open the history if it is hidden, then focus its search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey)
        return;
      e.preventDefault();
      if (mode.sideInline) {
        if (!sideVisible) update({ sidebar: "open" });
      } else setSideDrawer(true);
      setSearchRequest((n) => n + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode.sideInline, sideVisible, update]);

  const sideOpenNow = mode.sideInline ? sideVisible : sideDrawer;
  const panelOpenNow = mode.panelInline ? panelVisible : panelDrawer;

  return (
    <div className="nb-stage">
      <div ref={frame} className="nb-frame">
        <div ref={chrome} className="nb-chrome">
          <TopBar
            runs={history.runs}
            unseen={session.unseenIds.length}
            onSeen={session.markSeen}
            sidebarOpen={sideOpenNow}
            sidebarControls={SIDE_ID}
            onToggleSidebar={toggleSide}
            panelOpen={panelOpenNow}
            panelControls={PANEL_ID}
            onTogglePanel={togglePanel}
            sidebarToggleRef={sideToggle}
            panelToggleRef={panelToggle}
          />
          <TrustNotice />
        </div>

        <div
          className="nb-body"
          data-side={sideVisible ? "open" : "closed"}
          data-panel={panelVisible ? "open" : "closed"}
          data-ready={ready ? "true" : undefined}
        >
          <Pane
            id={SIDE_ID}
            className="nb-side"
            label={copy.history.title}
            inline={mode.sideInline}
            visible={sideVisible}
            drawerOpen={sideDrawer}
            onDrawerClose={() => setSideDrawer(false)}
          >
            {/* A hidden pane renders nothing: no duplicate text in the page, no work for a closed drawer. */}
            {sideOpenNow && (
              <HistorySidebarBody
                history={history}
                view={settings.historyView}
                onView={(historyView) => update({ historyView })}
                currentId={currentId}
                viewer={viewer}
                inline={mode.sideInline}
                onCollapse={collapseSide}
                searchRef={searchBox}
                searchRequest={searchRequest}
              />
            )}
          </Pane>

          <main id="main" tabIndex={-1} className="nb-main" data-route={home ? "home" : "other"}>
            {children}
          </main>

          <Pane
            id={PANEL_ID}
            className="nb-panel"
            label={copy.panel.title}
            inline={mode.panelInline}
            visible={panelVisible}
            drawerOpen={panelDrawer}
            onDrawerClose={() => setPanelDrawer(false)}
          >
            {panelOpenNow && (
              <ActivityPanelBody
                phase={session.phase}
                plain={session.plain}
                shown={session.shown}
                onClose={collapsePanel}
                inline={mode.panelInline}
              />
            )}
          </Pane>
        </div>
      </div>
    </div>
  );
}
