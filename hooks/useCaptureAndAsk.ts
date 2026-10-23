"use client";

/** Wire the global Cmd/Ctrl+Shift+1 hotkey path: main process captures
 *  the screen, then asks the renderer to open Ask AI with the screenshot
 *  pre-attached.
 *
 *  Strict behavior preservation: the timer cancellation, the
 *  compact-mode tab-swap suppression, the data URL validation, and the
 *  `setTimeout(…, 0)` mount-buffer all mirror the original inline
 *  effect in `components/main.tsx`. */

import { useEffect } from "react";
import { isVisionScreenshotDataUrl } from "@/lib/vision-screenshot";
import type { useTab } from "@/components/TabContext";

interface UseCaptureAndAskArgs {
  compactMode: boolean;
  setActiveTab: ReturnType<typeof useTab>["setActiveTab"];
  /** Called when the hotkey-triggered capture fails so the UI can surface it. */
  onError?: (message: string) => void;
}

export function useCaptureAndAsk({
  compactMode,
  setActiveTab,
  onError,
}: UseCaptureAndAskArgs) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.screen?.onCaptureAndAsk) return;

    let attachTimer: number | null = null;

    const off = api.screen.onCaptureAndAsk(async () => {
      try {
        const result = await api.screen.capture();
        if (!result.success) {
          console.error("Screen capture failed:", result.error);
          const isWin =
            typeof navigator !== "undefined" &&
            /win/i.test(navigator.userAgent || navigator.platform || "");
          onError?.(
            isWin
              ? "Screenshot capture failed. Please check display permissions and try again."
              : "Screenshot capture failed. Check Screen Recording permission in System Settings, then try again.",
          );
          return;
        }
        if (!isVisionScreenshotDataUrl(result.dataUrl)) {
          console.error(
            "[CaptureAndAsk] Unexpected image payload (worker would reject)",
          );
          onError?.(
            "Screenshot could not be attached (invalid image data). Try again.",
          );
          return;
        }
        // In compact mode QuestionAssistant isn't mounted; CompactCopilot
        // listens for the same event. Only swap tabs in full UI.
        if (!compactMode) {
          setActiveTab("ask-ai");
        }
        // React may not have mounted Ask AI yet — sync dispatch can drop the event.
        const detail = result.dataUrl.trim();
        if (attachTimer !== null) {
          window.clearTimeout(attachTimer);
        }
        attachTimer = window.setTimeout(() => {
          attachTimer = null;
          window.dispatchEvent(
            new CustomEvent<string>("ask-ai:attach-screenshot", {
              detail,
            }),
          );
        }, 0);
      } catch (err) {
        console.error("Failed to handle screen capture hotkey:", err);
        onError?.("Screenshot capture failed. Please try again.");
      }
    });

    return () => {
      off();
      if (attachTimer !== null) {
        window.clearTimeout(attachTimer);
        attachTimer = null;
      }
    };
  }, [compactMode, setActiveTab, onError]);
}
