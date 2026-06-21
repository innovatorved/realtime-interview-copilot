"use client";

/** Resize the Electron window whenever compact mode toggles.
 *
 *  Locks resizability while compact so the user can't drag-stretch the
 *  toolbar to full height. Height is computed from visible panels so
 *  output and inline Ask AI aren't clipped below the frame. */

import { useEffect } from "react";

export const COMPACT_WINDOW_WIDTH = 980;
export const FULL_WINDOW = { width: 1180, height: 640 } as const;

/** Toolbar-only idle height. */
export const COMPACT_HEIGHT_IDLE = 64;
export const COMPACT_HEIGHT_TRANSCRIPT = 140;
export const COMPACT_HEIGHT_COMPOSER = 120;
export const COMPACT_HEIGHT_COMPOSER_IMAGES = 168;
export const COMPACT_HEIGHT_OUTPUT = 300;
/** Unified compact height whenever output (Copilot, Summarize, or Ask AI) is visible. */
export const COMPACT_HEIGHT_OUTPUT_COMPOSER = 420;
export const COMPACT_HEIGHT_CONTEXT_EXTRA = 80;

export type CompactLayoutState = {
  showContext: boolean;
  askMode: boolean;
  hasVisibleOutput: boolean;
  hasTranscript: boolean;
  hasAttachedImages: boolean;
};

/** Derive pixel height from which compact panels are open. */
export function resolveCompactHeight(state: CompactLayoutState): number {
  const {
    showContext,
    askMode,
    hasVisibleOutput,
    hasTranscript,
    hasAttachedImages,
  } = state;

  let height = COMPACT_HEIGHT_IDLE;

  if (hasVisibleOutput) {
    height = COMPACT_HEIGHT_OUTPUT_COMPOSER;
  } else if (askMode) {
    height = hasAttachedImages
      ? COMPACT_HEIGHT_COMPOSER_IMAGES
      : COMPACT_HEIGHT_COMPOSER;
  } else if (hasTranscript) {
    height = COMPACT_HEIGHT_TRANSCRIPT;
  }

  if (showContext) {
    height += COMPACT_HEIGHT_CONTEXT_EXTRA;
  }

  return height;
}

export function useCompactWindowSize(
  compactMode: boolean,
  compactHeight: number,
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.windowSetSize) return;
    if (compactMode) {
      api.windowSetResizable?.(false);
      void api.windowSetSize(COMPACT_WINDOW_WIDTH, compactHeight);
    } else {
      void api.windowSetSize(FULL_WINDOW.width, FULL_WINDOW.height);
      api.windowSetResizable?.(true);
    }
  }, [compactMode, compactHeight]);
}
