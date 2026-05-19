"use client";

/** The answer panel rendered beneath the toolbar.
 *
 *  Pure presentational. Renders one of:
 *    - the multi-turn chat thread (with an inline, dismissable error row)
 *    - a single-shot error message
 *    - the rendered markdown for a transcript-driven completion
 *    - a "generating…" indicator with the appropriate copy
 *
 *  The outer wrapper is intentionally NOT `data-clickable` so empty
 *  space around the answer still passes clicks through to the app
 *  behind. Only the inner content blocks are flagged clickable so
 *  the user can select/copy or dismiss errors. */

import { X } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { ChatThread } from "@/components/ui/ChatThread";
import type { ChatMessage } from "@/hooks/useAskChat";
import { FLAGS } from "@/lib/types";

export type CompactOutputMode = "transcript" | "chat";

interface OutputPanelProps {
  outputMode: CompactOutputMode;
  chatMessages: ChatMessage[];
  chatError: string | null;
  chatIsStreaming: boolean;
  completion: string;
  error: string | null;
  activeFlag: FLAGS | null;
  /**
   * Clear the surface-level capture/error state. Used by the dismiss
   * button on the inline error row so the user can banish a stale
   * "Something went wrong" without losing the chat thread underneath.
   * Optional — call sites that don't expose error state can omit it.
   */
  onDismissError?: () => void;
  /** Shown above user bubbles in compact Ask AI thread. */
  chatUserLabel?: string;
}

export function OutputPanel({
  outputMode,
  chatMessages,
  chatError,
  chatIsStreaming,
  completion,
  error,
  activeFlag,
  onDismissError,
  chatUserLabel,
}: OutputPanelProps) {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3 text-white [text-shadow:0_1px_2px_color-mix(in_oklch,var(--app-shadow)_70%,transparent)]"
    >
      {outputMode === "chat" ? (
        // Multi-turn Ask AI thread. Errors from the chat hook are shown
        // INSIDE the thread area (rather than replacing it) so the
        // user can still see their previous answers and just retry.
        <div data-clickable className="flex flex-col gap-2">
          {(chatError || error) && (
            <div
              role="alert"
              className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-md bg-red-500/[0.08] border border-red-500/20 text-[11px] text-red-300"
            >
              <span className="flex-1 min-w-0 break-words">
                {chatError ?? error}
              </span>
              {onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  aria-label="Dismiss error"
                  title="Dismiss error"
                  className="shrink-0 -mr-0.5 p-0.5 rounded text-red-300/80 hover:text-red-100 hover:bg-red-500/15 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {chatMessages.length > 0 ? (
            <ChatThread
              messages={chatMessages}
              density="compact"
              userLabel={chatUserLabel}
            />
          ) : chatIsStreaming ? (
            <div className="flex items-center gap-2 text-xs text-white">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/35" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
              </span>
              Generating answer…
            </div>
          ) : null}
        </div>
      ) : error ? (
        <div
          data-clickable
          role="alert"
          className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-md bg-red-500/[0.08] border border-red-500/20 text-[11px] text-red-300"
        >
          <span className="flex-1 min-w-0 break-words">{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
              title="Dismiss error"
              className="shrink-0 -mr-0.5 p-0.5 rounded text-red-300/80 hover:text-red-100 hover:bg-red-500/15 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : completion ? (
        <div
          data-clickable
          className="prose prose-invert prose-xs max-w-none text-white text-xs leading-relaxed font-medium"
        >
          <SafeMarkdown>{completion}</SafeMarkdown>
        </div>
      ) : (
        <div
          data-clickable
          className="flex items-center gap-2 text-xs text-white"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/35" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
          </span>
          {activeFlag === FLAGS.SUMMARIZER
            ? "Generating summary…"
            : "Generating answer…"}
        </div>
      )}
    </div>
  );
}
