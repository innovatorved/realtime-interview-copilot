"use client";

/** Shared Esc-priority handler for the Ask AI surfaces.
 *
 *  Both QuestionAssistant and CompactCopilot route Esc through the
 *  same priority list:
 *    1. cancel any active mic recording (incl. tap-toggle)
 *    2. abort the chat stream if one is in flight
 *    3. surface-specific fallback (clear composer / abort single-shot)
 *
 *  Mod+Shift+N starts a new chat on both surfaces.
 *
 *  Each surface supplies its own fallback because the secondary action
 *  differs: QuestionAssistant clears the composer, CompactCopilot
 *  aborts the legacy single-shot generation controller. */

import { useEffect } from "react";
import { dbg } from "@/lib/debug";

interface UseAskKeyboardArgs {
  /** Gate the handler — typically `isActive` on the full surface, or
   *  `true` on compact where the surface is always interactive. */
  enabled?: boolean;
  isMicActive: boolean;
  isChatStreaming: boolean;
  onMicCancel: () => void;
  onChatAbort: () => void;
  onNewChat: () => void;
  /** Optional fallback Esc handler — runs only if neither the mic nor
   *  the chat stream consumed the keystroke. Return `true` if the key
   *  was handled (the consumer should call `e.preventDefault()` itself). */
  onEscapeFallback?: () => boolean | void;
}

export function useAskKeyboard({
  enabled = true,
  isMicActive,
  isChatStreaming,
  onMicCancel,
  onChatAbort,
  onNewChat,
  onEscapeFallback,
}: UseAskKeyboardArgs) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const modKey = e.ctrlKey || e.metaKey;
      if (modKey && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        dbg("ask-ui", "Mod+Shift+N → reset Ask AI chat");
        onNewChat();
        return;
      }
      if (e.key !== "Escape") return;
      if (isMicActive) {
        e.preventDefault();
        dbg("ask-ui", "Esc → cancel active mic recording");
        onMicCancel();
        return;
      }
      if (isChatStreaming) {
        e.preventDefault();
        dbg("ask-ui", "Esc → abort in-flight chat stream");
        onChatAbort();
        return;
      }
      const handled = onEscapeFallback?.();
      if (handled) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    isMicActive,
    isChatStreaming,
    onMicCancel,
    onChatAbort,
    onNewChat,
    onEscapeFallback,
  ]);
}
