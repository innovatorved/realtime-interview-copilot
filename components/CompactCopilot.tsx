"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SafeMarkdown from "@/components/SafeMarkdown";
import {
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Eraser,
  FileText,
  Maximize2,
  MessageSquare,
  Send,
  Settings2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FLAGS, HistoryData } from "@/lib/types";
import { BACKEND_API_URL } from "@/lib/constant";
import { useTranscription } from "@/components/TranscriptionContext";
import { humanizeError, humanizeHttpStatus } from "@/lib/api-errors";
import posthog from "posthog-js";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="h-7 w-20 rounded-lg border border-white/[0.06] bg-white/[0.02]" />
  ),
});

interface CompactCopilotProps {
  addInSavedData: (data: HistoryData) => void;
  presetContext?: string;
  onExitCompact?: () => void;
  /**
   * Notifies the parent whenever the compact surface has output to display
   * (an answer, error or in-flight generation). Used to grow the Electron
   * window so the panel is actually on-screen.
   */
  onHasOutputChange?: (hasOutput: boolean) => void;
}

const SSE_CLIENT_BUFFER_MAX = 1_000_000;
// sessionStorage keys for state that is owned per-surface (the in-flight
// completion + which mode produced it). The transcription itself now lives
// in TranscriptionProvider, so it doesn't need surface-level persistence.
const STORAGE_KEYS = {
  completion: "compact-completion",
  lastFlag: "compact-last-flag",
} as const;

function readSession(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSession(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* quota / unavailable — non-fatal */
  }
}

export function CompactCopilot({
  addInSavedData,
  presetContext = "",
  onExitCompact,
  onHasOutputChange,
}: CompactCopilotProps) {
  // Transcription state is shared across the compact and full surfaces via
  // TranscriptionProvider, so an active recording survives toggling.
  const { transcribedText, clearTranscription } = useTranscription();
  const [bg, setBg] = useState<string>(presetContext);
  // Freeform "Ask AI" — user types a question instead of relying on the
  // transcription buffer. Distinct from Copilot/Summarize which both
  // operate on the transcribed text.
  const [askMode, setAskMode] = useState<boolean>(false);
  const [askInput, setAskInput] = useState<string>("");
  // Completion is per-surface (each surface has its own SSE in-flight
  // request). Persisted across compact remounts so the user doesn't lose
  // the answer they were reading when they toggle back from full mode.
  const [completion, setCompletion] = useState<string>(() =>
    readSession(STORAGE_KEYS.completion),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeFlag, setActiveFlag] = useState<FLAGS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState<boolean>(false);
  const [outputCollapsed, setOutputCollapsed] = useState<boolean>(false);

  const controller = useRef<AbortController | null>(null);
  const bgHydratedRef = useRef(false);

  useEffect(() => {
    writeSession(STORAGE_KEYS.completion, completion);
  }, [completion]);

  // Preset context wins over the cached value, mirroring full Copilot behaviour.
  useEffect(() => {
    if (presetContext) {
      setBg(presetContext);
      bgHydratedRef.current = true;
    }
  }, [presetContext]);

  useEffect(() => {
    if (bgHydratedRef.current) return;
    try {
      const saved = sessionStorage.getItem("bg");
      if (saved) setBg(saved);
    } catch {
      // sessionStorage unavailable
    }
    bgHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!bg) return;
    try {
      sessionStorage.setItem("bg", bg);
    } catch {
      // quota / unavailable — non-fatal
    }
  }, [bg]);

  const stop = useCallback(() => {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsLoading(false);
      setActiveFlag(null);
    }
  }, []);

  // Abort any in-flight completion stream when the surface unmounts (user
  // toggles compact off / closes the app). Without this, the SSE reader
  // would keep running and try to setCompletion on an unmounted tree.
  useEffect(() => {
    return () => {
      if (controller.current) {
        controller.current.abort();
        controller.current = null;
      }
    };
  }, []);

  const generate = useCallback(
    async (flag: FLAGS, customPrompt?: string) => {
      if (isLoading || controller.current) return;
      // Use the typed question when provided, otherwise the live transcription.
      const prompt = (customPrompt ?? transcribedText).trim();
      if (!prompt) {
        setError(
          customPrompt !== undefined
            ? "Type a question first."
            : humanizeHttpStatus(0, { kind: "no-input" }),
        );
        return;
      }

      setError(null);
      setCompletion("");
      setIsLoading(true);
      setActiveFlag(flag);
      setOutputCollapsed(false);
      controller.current = new AbortController();

      posthog.capture("completion_generated", {
        mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
        has_context: bg.length > 0,
        prompt_length: prompt.length,
        source: customPrompt !== undefined ? "typed" : "transcription",
        surface: "compact",
      });

      try {
        const response = await fetch(`${BACKEND_API_URL}/api/completion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bg,
            flag,
            prompt,
          }),
          signal: controller.current.signal,
          credentials: "include",
        });

        if (!response.ok) {
          // Surface a friendly message instead of "HTTP error! status: 404".
          // The 4xx/5xx specifically gets translated to actionable copy
          // (e.g. "AI service not available right now").
          throw new Error(humanizeHttpStatus(response.status));
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Response body is null");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > SSE_CLIENT_BUFFER_MAX) {
            throw new Error("SSE buffer overflow");
          }

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const eventString = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            if (!eventString.trim()) continue;

            const dataMatch = eventString.match(/data: (.*)/);
            if (!dataMatch) continue;

            const data = dataMatch[1];
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.text) setCompletion((t) => t + parsed.text);
            } catch (err) {
              console.error("Error parsing SSE data:", err);
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Stream error:", err);
          // humanizeError will pass through messages already translated
          // by humanizeHttpStatus above and rewrite anything raw.
          setError(humanizeError(err));
          posthog.captureException(err);
        }
      } finally {
        setIsLoading(false);
        setActiveFlag(null);
        controller.current = null;
      }
    },
    [bg, isLoading, transcribedText],
  );

  const lastFlagRef = useRef<FLAGS>(
    (readSession(STORAGE_KEYS.lastFlag) as FLAGS) || FLAGS.COPILOT,
  );
  useEffect(() => {
    if (activeFlag) {
      lastFlagRef.current = activeFlag;
      writeSession(STORAGE_KEYS.lastFlag, activeFlag);
    }
  }, [activeFlag]);

  const handleSave = useCallback(() => {
    if (!completion.trim()) return;
    const tag =
      lastFlagRef.current === FLAGS.SUMMARIZER ? "Summarizer" : "Copilot";
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag,
    });
    posthog.capture("completion_saved", {
      mode: tag.toLowerCase(),
      completion_length: completion.length,
      surface: "compact",
    });
  }, [addInSavedData, completion]);

  const clearAll = useCallback(() => {
    clearTranscription();
    setCompletion("");
    setError(null);
    writeSession(STORAGE_KEYS.completion, "");
  }, [clearTranscription]);

  const hasOutput = completion.length > 0 || isLoading || error !== null;
  const hasVisibleOutput = hasOutput && !outputCollapsed;
  // Anything that requires more vertical space than the bare navbar:
  // a visible answer panel OR an open context/ask drawer. We forward
  // this to the parent so it can grow the Electron window accordingly.
  const needsExpandedWindow = hasVisibleOutput || showContext || askMode;

  useEffect(() => {
    onHasOutputChange?.(needsExpandedWindow);
  }, [needsExpandedWindow, onHasOutputChange]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      {/* Compact toolbar — this IS the visible UI when no answer has been requested.
          data-clickable so MainPage's mouse-tracker keeps it interactive even
          when the rest of the (transparent) window is set to click-through. */}
      <div
        data-clickable
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900/60 backdrop-blur-md border-b border-white/[0.06]"
      >
        <RecorderTranscriber compact />

        <Button
          type="button"
          size="sm"
          onClick={() =>
            isLoading && activeFlag === FLAGS.COPILOT
              ? stop()
              : generate(FLAGS.COPILOT)
          }
          disabled={
            (!isLoading && !transcribedText.trim()) ||
            (isLoading && activeFlag !== FLAGS.COPILOT)
          }
          title={
            isLoading && activeFlag === FLAGS.COPILOT
              ? "Stop generating"
              : transcribedText.trim()
                ? "Generate copilot answer"
                : "Start transcription first"
          }
          className={cn(
            "h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg transition-all",
            isLoading && activeFlag === FLAGS.COPILOT
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25"
              : "accent-gradient text-white shadow-sm hover:shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {isLoading && activeFlag === FLAGS.COPILOT ? (
            <LoadingDots color="bg-amber-300" />
          ) : (
            <>
              <Zap className="w-3 h-3" />
              <span className="hidden sm:inline">Ask</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={() =>
            isLoading && activeFlag === FLAGS.SUMMARIZER
              ? stop()
              : generate(FLAGS.SUMMARIZER)
          }
          disabled={
            (!isLoading && !transcribedText.trim()) ||
            (isLoading && activeFlag !== FLAGS.SUMMARIZER)
          }
          title={
            isLoading && activeFlag === FLAGS.SUMMARIZER
              ? "Stop summarizing"
              : transcribedText.trim()
                ? "Summarize transcription"
                : "Start transcription first"
          }
          className={cn(
            "h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg border transition-all",
            isLoading && activeFlag === FLAGS.SUMMARIZER
              ? "bg-amber-500/15 text-amber-300 border-amber-500/25 hover:bg-amber-500/25"
              : "bg-blue-500/15 text-blue-300 border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {isLoading && activeFlag === FLAGS.SUMMARIZER ? (
            <LoadingDots color="bg-amber-300" />
          ) : (
            <>
              <FileText className="w-3 h-3" />
              <span className="hidden sm:inline">Summarize</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAskMode((m) => !m)}
          title={askMode ? "Hide Ask AI input" : "Ask AI a typed question"}
          className={cn(
            "h-7 px-2 gap-1 text-[11px] font-medium rounded-lg transition-colors",
            askMode
              ? "bg-violet-500/15 text-violet-200 border border-violet-500/25"
              : "text-zinc-400 hover:text-violet-200 hover:bg-violet-500/[0.08] border border-transparent",
          )}
        >
          <MessageSquare className="w-3 h-3" />
          <span className="hidden sm:inline">Ask AI</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSave}
          disabled={!completion.trim()}
          title="Save answer to notes"
          className="h-7 w-7 p-0 rounded-lg text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/[0.08] disabled:opacity-30"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowContext((s) => !s)}
          title={showContext ? "Hide context" : "Edit context"}
          className={cn(
            "h-7 w-7 p-0 rounded-lg transition-colors",
            showContext
              ? "text-emerald-300 bg-emerald-500/[0.08]"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]",
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </Button>

        <div className="flex-1" />

        {transcribedText.trim() && !hasOutput && (
          <span
            className="text-[10px] text-zinc-500 truncate max-w-[24ch] hidden md:inline"
            title={transcribedText}
          >
            {transcribedText.length} chars buffered
          </span>
        )}

        {/* Dedicated clear-transcription button (only the captured speech,
            keeps any answer the user is reading). Distinct from the X
            below which clears everything at once. */}
        {transcribedText.trim() && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearTranscription}
            title="Clear transcription"
            aria-label="Clear transcription"
            className="h-7 w-7 p-0 rounded-lg text-zinc-500 hover:text-amber-300 hover:bg-amber-500/[0.06]"
          >
            <Eraser className="w-3.5 h-3.5" />
          </Button>
        )}

        {hasOutput && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOutputCollapsed((c) => !c)}
            title={outputCollapsed ? "Show answer" : "Hide answer"}
            className="h-7 w-7 p-0 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]"
          >
            {outputCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </Button>
        )}

        {(hasOutput || transcribedText) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            title="Clear transcription & answer"
            className="h-7 w-7 p-0 rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-500/[0.06]"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}

        {onExitCompact && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onExitCompact}
            title="Exit compact mode"
            className="h-7 w-7 p-0 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Optional context drawer — only when explicitly opened. Solid bg
          since the global backdrop is clipped to the navbar in compact
          mode, leaving this drawer floating over the desktop. */}
      {showContext && (
        <div
          data-clickable
          className="px-3 py-2 border-b border-white/[0.04] bg-zinc-900/95 backdrop-blur-md"
        >
          <Textarea
            placeholder="Optional: paste JD, resume or topic context for higher-quality answers…"
            className="min-h-[64px] max-h-[120px] resize-none bg-zinc-900/50 border border-white/[0.06] focus-visible:ring-emerald-500/30 text-zinc-200 placeholder:text-zinc-600 text-xs leading-relaxed rounded-lg px-2.5 py-1.5"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
          />
        </div>
      )}

      {/* Ask AI input drawer — typed freeform question, distinct from
          Copilot/Summarize which both operate on the live transcription. */}
      {askMode && (
        <form
          data-clickable
          className="px-3 py-2 border-b border-white/[0.04] bg-zinc-900/95 backdrop-blur-md flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = askInput.trim();
            if (!q || isLoading) return;
            void generate(FLAGS.COPILOT, q);
            setAskInput("");
          }}
        >
          <input
            type="text"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            placeholder="Type a question for the AI…"
            autoFocus
            className="flex-1 bg-zinc-900/50 border border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-zinc-200 placeholder:text-zinc-600 text-xs rounded-lg px-2.5 py-1.5"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!askInput.trim() || isLoading}
            title="Send to AI"
            className="h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg accent-gradient text-white shadow-sm hover:shadow-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            <span className="hidden sm:inline">Send</span>
          </Button>
        </form>
      )}

      {/* Answer area — rendered OUTSIDE the navbar strip, fully transparent.
          The outer flex container is intentionally NOT data-clickable so the
          empty space around / below the text passes clicks through to the
          app behind. Only the text/error/loading inner blocks are marked
          clickable so the user can still select-and-copy the answer or
          dismiss errors. */}
      {hasVisibleOutput && (
        <div
          className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3"
          style={{
            background: "transparent",
            textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,0.95)",
          }}
        >
          {error ? (
            <div data-clickable role="alert" className="text-xs text-red-300">
              {error}
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
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {activeFlag === FLAGS.SUMMARIZER
                ? "Generating summary…"
                : "Generating answer…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingDots({ color = "bg-amber-300" }: { color?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("w-1 h-1 rounded-full animate-bounce", color)} />
      <span
        className={cn("w-1 h-1 rounded-full animate-bounce", color)}
        style={{ animationDelay: "120ms" }}
      />
      <span
        className={cn("w-1 h-1 rounded-full animate-bounce", color)}
        style={{ animationDelay: "240ms" }}
      />
    </span>
  );
}

export default CompactCopilot;
