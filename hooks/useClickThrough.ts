"use client";

/** Compact-mode click-through tracking.
 *
 *  The compact window is mostly transparent and acts as an overlay
 *  above whatever the user is doing (Zoom, Slack, an interview tab,
 *  etc.). Without this hook, the entire window — including the empty
 *  space below the navbar — would greedily capture clicks, blocking
 *  the app behind.
 *
 *  Strategy: tell Electron to ignore mouse events globally on the
 *  window (`setIgnoreMouseEvents(true, { forward: true })`), then track
 *  the cursor in the renderer. When the cursor is over an interactive
 *  region (anything marked `data-clickable`, plus standard form
 *  controls, links and buttons), we flip back to non-ignored so clicks
 *  land. When it leaves that region, clicks pass through to whatever
 *  is behind. `forward: true` is what keeps mousemove events flowing
 *  into the renderer even while ignored, which is what makes the
 *  tracking work at all. */

import { useEffect } from "react";

const CHROME_SELECTOR = ".titlebar-chrome, .app-toolbar, [data-window-chrome]";

const INTERACTIVE_SELECTOR = `${CHROME_SELECTOR}, [data-clickable], button, input, textarea, select, a, [role="button"], [role="textbox"], [contenteditable="true"]`;

function isInteractiveAt(clientX: number, clientY: number): boolean {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) {
    return false;
  }
  return !!target.closest(INTERACTIVE_SELECTOR);
}

export function useClickThrough(compactMode: boolean, isElectron: boolean) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!compactMode || !isElectron) return;
    const api = window.electronAPI;
    if (!api?.windowSetIgnoreMouseEvents) return;

    let lastIgnore: boolean | null = null;
    let lastInteractive: boolean | null = null;
    const setIgnore = (ignore: boolean) => {
      if (lastIgnore === ignore) return;
      lastIgnore = ignore;
      // Best-effort — IPC could fail mid-tear-down. Swallow.
      api
        .windowSetIgnoreMouseEvents?.(ignore, { forward: true })
        ?.catch(() => {});
    };

    const syncFromPoint = (clientX: number, clientY: number) => {
      const interactive = isInteractiveAt(clientX, clientY);
      setIgnore(!interactive);
      if (interactive && !lastInteractive) {
        api.windowFocus?.().catch(() => {});
      }
      lastInteractive = interactive;
    };

    // Start click-through; the cursor isn't necessarily over our window.
    setIgnore(true);

    const onMove = (e: MouseEvent) => {
      syncFromPoint(e.clientX, e.clientY);
    };

    // Sync before drag/click so titlebar grabs work even without a prior mousemove.
    const onPointerDown = (e: PointerEvent) => {
      syncFromPoint(e.clientX, e.clientY);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onPointerDown, true);
      // Restore normal capture so leaving compact (or unmount) doesn't
      // leave the window stuck in click-through mode.
      api.windowSetIgnoreMouseEvents?.(false)?.catch(() => {});
    };
  }, [compactMode, isElectron]);
}
