"use client";

/** Resize the Electron window whenever compact mode toggles.
 *
 *  Locks resizability while compact so the user can't drag-stretch the
 *  toolbar to full height. Grows the window when the compact surface
 *  has visible output so the answer panel isn't clipped off the bottom
 *  of the 64px frame. */

import { useEffect } from "react";

// Electron window dimensions used when toggling compact mode. Idle compact
// height is intentionally small so only the navbar/toolbar shows; when an
// answer/summary is present we grow the window so the panel is actually
// visible on-screen instead of being clipped off the bottom of a 64px frame.
export const COMPACT_WINDOW = { width: 980, height: 64 } as const;
export const COMPACT_WINDOW_WITH_OUTPUT = { width: 980, height: 380 } as const;
export const FULL_WINDOW = { width: 1180, height: 640 } as const;

export function useCompactWindowSize(
  compactMode: boolean,
  compactHasOutput: boolean,
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.windowSetSize) return;
    if (compactMode) {
      // Lock first, then resize, so the OS doesn't briefly let the user
      // grab a resize-edge between the two calls. When the compact surface
      // produces output we grow the window — otherwise the answer panel
      // would render off-screen below the 64px toolbar strip.
      api.windowSetResizable?.(false);
      const target = compactHasOutput
        ? COMPACT_WINDOW_WITH_OUTPUT
        : COMPACT_WINDOW;
      void api.windowSetSize(target.width, target.height);
    } else {
      void api.windowSetSize(FULL_WINDOW.width, FULL_WINDOW.height);
      api.windowSetResizable?.(true);
    }
  }, [compactMode, compactHasOutput]);
}
