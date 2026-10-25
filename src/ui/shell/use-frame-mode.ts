"use client";

import { type RefObject, useEffect, useState } from "react";

/** Container widths (in rem) at which the sidebar and the activity panel stop being drawers. Keep in step with shell.css. */
export const SIDE_INLINE_REM = 64;
export const PANEL_INLINE_REM = 70;

export interface FrameMode {
  /** The sidebar is a column (otherwise a drawer). */
  sideInline: boolean;
  /** The activity panel is a column (otherwise a drawer). */
  panelInline: boolean;
}

/**
 * Mirrors the container queries in shell.css so the script knows when a dialog must be modal.
 * The thresholds are in rem of the computed root font size, so the Text size setting moves them,
 * which is why `textSize` is a dependency: the frame's width does not change when it does.
 */
export function useFrameMode(frame: RefObject<HTMLElement | null>, textSize: number): FrameMode {
  // The server cannot measure; assume the roomy layout and let the first effect correct it.
  const [mode, setMode] = useState<FrameMode>({ sideInline: true, panelInline: true });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text size changes the rem the thresholds are measured in
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = el.getBoundingClientRect().width;
      const next = {
        sideInline: width >= SIDE_INLINE_REM * rem,
        panelInline: width >= PANEL_INLINE_REM * rem,
      };
      setMode((m) =>
        m.sideInline === next.sideInline && m.panelInline === next.panelInline ? m : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame, textSize]);

  return mode;
}
