"use client";

import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

/**
 * The sidebar and the activity panel are `<dialog>` elements. As a column (`inline`) a dialog is
 * opened non-modally with `show()` and sits in the layout; as a drawer it is opened with
 * `showModal()`, which gives a focus trap, Escape to close, an inert page behind it and focus
 * restored to the button that opened it, all from the browser.
 *
 * The server renders it with the `open` attribute so the column is there before any script runs;
 * after that this component drives the element and React never touches the attribute again.
 */
export function Pane({
  id,
  className,
  label,
  inline,
  visible,
  drawerOpen,
  onDrawerClose,
  paneRef,
  children,
}: {
  id: string;
  className: string;
  label: string;
  /** A column rather than a drawer. */
  inline: boolean;
  /** Column mode: shown or hidden. */
  visible: boolean;
  /** Drawer mode: opened or closed. */
  drawerOpen: boolean;
  onDrawerClose: () => void;
  paneRef?: Ref<HTMLDialogElement>;
  children: ReactNode;
}) {
  const own = useRef<HTMLDialogElement | null>(null);
  // Fixed at first render, so React's `open` prop never changes after the server's HTML.
  const [initiallyOpen] = useState(visible);

  useEffect(() => {
    const d = own.current;
    if (!d) return;
    const modal = d.matches(":modal");
    if (inline) {
      if (modal) d.close();
      if (visible && !d.open) d.show();
      else if (!visible && d.open) d.close();
    } else if (drawerOpen) {
      if (!modal) {
        if (d.open) d.close();
        d.showModal();
      }
    } else if (d.open) {
      d.close();
    }
  }, [inline, visible, drawerOpen]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop; the keyboard closes a modal dialog with Escape
    <dialog
      ref={(el) => {
        own.current = el;
        if (typeof paneRef === "function") paneRef(el);
        else if (paneRef) (paneRef as { current: HTMLDialogElement | null }).current = el;
      }}
      id={id}
      open={initiallyOpen}
      aria-label={label}
      className={className}
      onClose={() => {
        if (!inline) onDrawerClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && e.currentTarget.matches(":modal")) {
          e.currentTarget.close();
        }
      }}
    >
      {children}
    </dialog>
  );
}
