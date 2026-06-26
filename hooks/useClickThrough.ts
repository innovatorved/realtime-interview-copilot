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
 *  tracking work at all.
 *
 *  On Windows the window starts non-ignored so the first click/hold/drag
 *  always lands; ignore is enabled only after mousemove confirms the
 *  cursor is over a transparent non-interactive area. */

import { useEffect } from "react";

const CHROME_SELECTOR = ".titlebar-chrome, .app-toolbar, [data-window-chrome]";

const INTERACTIVE_SELECTOR = [
  CHROME_SELECTOR,
  "[data-clickable]",
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "label",
  "[role=\"button\"]",
  "[role=\"textbox\"]",
  "[role=\"option\"]",
  "[role=\"listbox\"]",
  "[role=\"menu\"]",
  "[role=\"menuitem\"]",
  "[role=\"dialog\"]",
  "[role=\"tab\"]",
  "[role=\"tabpanel\"]",
  "[contenteditable=\"true\"]",
  "[data-radix-popper-content-wrapper]",
]
  .join(", ");

function isInteractiveAt(clientX: number, clientY: number): boolean {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) {
    return false;
  }
  return !!target.closest(INTERACTIVE_SELECTOR);
}

export function useClickThrough(
  compactMode: boolean,
  isElectron: boolean,
  backdropOpacity: number,
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!compactMode || !isElectron) return;
    const api = window.electronAPI;
    if (!api?.windowSetIgnoreMouseEvents) return;

    const isWin32 = api.platform === "win32";

    let lastIgnore: boolean | null = null;
    let lastInteractive: boolean | null = null;
    let activePointers = 0;
    let lastX = 0;
    let lastY = 0;

    const setIgnore = (ignore: boolean) => {
      if (lastIgnore === ignore) return;
      lastIgnore = ignore;
      api
        .windowSetIgnoreMouseEvents?.(ignore, { forward: true })
        ?.catch(() => {});
    };

    const syncFromPoint = (clientX: number, clientY: number) => {
      lastX = clientX;
      lastY = clientY;
      const interactive = isInteractiveAt(clientX, clientY);
      setIgnore(!interactive);
      if (interactive && !lastInteractive) {
        api.windowFocus?.().catch(() => {});
      }
      lastInteractive = interactive;
    };

    const resyncLastPoint = () => {
      syncFromPoint(lastX, lastY);
    };

    // Windows: start clickable so first click/hold/drag works. macOS/Linux:
    // start click-through; forward mousemove flips ignore off over chrome.
    setIgnore(!isWin32);

    const onMove = (e: MouseEvent) => {
      if (activePointers > 0) return;
      syncFromPoint(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      activePointers++;
      lastX = e.clientX;
      lastY = e.clientY;
      setIgnore(false);
      syncFromPoint(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers = Math.max(0, activePointers - 1);
      lastX = e.clientX;
      lastY = e.clientY;
      if (activePointers === 0) {
        syncFromPoint(e.clientX, e.clientY);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      activePointers = Math.max(0, activePointers - 1);
      if (activePointers === 0) {
        syncFromPoint(e.clientX, e.clientY);
      }
    };

    const onWindowFocus = () => {
      resyncLastPoint();
    };

    const onPointerEnter = (e: PointerEvent) => {
      syncFromPoint(e.clientX, e.clientY);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pointerenter", onPointerEnter);

    const unsubscribeOsFocus = api.onWindowFocus?.(() => {
      resyncLastPoint();
    });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pointerenter", onPointerEnter);
      unsubscribeOsFocus?.();
      api.windowSetIgnoreMouseEvents?.(false)?.catch(() => {});
    };
  }, [compactMode, isElectron, backdropOpacity]);
}
