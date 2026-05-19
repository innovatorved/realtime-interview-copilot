"use client";

/** Shared listener for the `ask-ai:attach-screenshot` custom event.
 *
 *  Both QuestionAssistant and CompactCopilot listen for the global
 *  screenshot capture event and append the resulting data URL to the
 *  current image attachments. This hook centralizes the listener so
 *  the two surfaces don't drift on validation or focus semantics.
 *
 *  Behavior preserved verbatim:
 *    1. Ignore invalid data URLs (worker-side validator)
 *    2. Append (no replace) so multiple presses build up to MAX_IMAGES
 *    3. 50ms-deferred focus on the supplied input ref
 *    4. Optional `onAttach` hook lets the compact surface flip its
 *       ask drawer open. */

import { useEffect, type RefObject } from "react";
import { isVisionScreenshotDataUrl } from "@/lib/vision-screenshot";

interface UseAskScreenshotBridgeArgs {
  appendImage: (dataUrl: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Fired AFTER the image has been appended. Used by the compact
   *  surface to open the Ask drawer; QuestionAssistant doesn't need
   *  this so it's optional. */
  onAttach?: () => void;
}

export function useAskScreenshotBridge({
  appendImage,
  inputRef,
  onAttach,
}: UseAskScreenshotBridgeArgs) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (!isVisionScreenshotDataUrl(detail)) {
        return;
      }
      appendImage(detail.trim());
      onAttach?.();
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener("ask-ai:attach-screenshot", handler);
    return () =>
      window.removeEventListener("ask-ai:attach-screenshot", handler);
  }, [appendImage, inputRef, onAttach]);
}
