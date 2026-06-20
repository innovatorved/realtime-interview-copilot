"use client";

/** The compact toolbar — the visible strip when no answer has been
 *  requested. Pure presentational: every callback and piece of state
 *  is supplied by the parent CompactCopilot. */

import {
  BookmarkPlus,
  Camera,
  ChevronDown,
  ChevronUp,
  Eraser,
  FileText,
  Maximize2,
  MessageSquare,
  Mic,
  Settings2,
  X,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import type { useAskMic } from "@/hooks/useAskMic";
import type { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { Button } from "@/components/ui/button";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { LevelMeter } from "@/components/ui/LevelMeter";
import { FLAGS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LoadingDots } from "./LoadingDots";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="inline-flex h-7 w-20 rounded-lg border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_60%,transparent)]" />
  ),
});

interface CompactToolbarProps {
  askMic: ReturnType<typeof useAskMic>;
  ptt: ReturnType<typeof useMicPushToTalk>;
  isLoading: boolean;
  activeFlag: FLAGS | null;
  transcribedText: string;
  attachedImages: string[];
  maxImages: number;
  isElectron: boolean;
  isCapturing: boolean;
  askMode: boolean;
  showContext: boolean;
  hasContextAttached?: boolean;
  hasOutput: boolean;
  outputCollapsed: boolean;
  completion: string;
  onGenerate: (flag: FLAGS) => void;
  onStop: () => void;
  onCaptureScreen: () => void;
  onToggleAskMode: () => void;
  onToggleContext: () => void;
  onToggleOutputCollapsed: () => void;
  onSave: () => void;
  onClearTranscription: () => void;
  onClearAll: () => void;
  onExitCompact?: () => void;
}

export function CompactToolbar({
  askMic,
  ptt,
  isLoading,
  activeFlag,
  transcribedText,
  attachedImages,
  maxImages,
  isElectron,
  isCapturing,
  askMode,
  showContext,
  hasContextAttached = false,
  hasOutput,
  outputCollapsed,
  completion,
  onGenerate,
  onStop,
  onCaptureScreen,
  onToggleAskMode,
  onToggleContext,
  onToggleOutputCollapsed,
  onSave,
  onClearTranscription,
  onClearAll,
  onExitCompact,
}: CompactToolbarProps) {
  return (
    <div
      data-clickable
      data-window-chrome
      className="app-toolbar flex items-center gap-1.5 px-2.5 py-1.5"
    >
      <RecorderTranscriber compact />

      <Button
        type="button"
        size="sm"
        onClick={() =>
          isLoading && activeFlag === FLAGS.COPILOT
            ? onStop()
            : onGenerate(FLAGS.COPILOT)
        }
        disabled={
          (!isLoading && !transcribedText.trim()) ||
          (isLoading && activeFlag !== FLAGS.COPILOT)
        }
        title={
          isLoading && activeFlag === FLAGS.COPILOT
            ? "Stop generating"
            : transcribedText.trim()
              ? `Generate copilot answer (${formatShortcut(["Mod", "Enter"])})`
              : "Start transcription first"
        }
        className={cn(
          "h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg transition-all",
          isLoading && activeFlag === FLAGS.COPILOT
            ? "bg-sky-500/15 text-sky-300 border border-sky-500/25 hover:bg-sky-500/25"
            : "accent-gradient text-white shadow-sm hover:shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {isLoading && activeFlag === FLAGS.COPILOT ? (
          <LoadingDots color="bg-sky-300" />
        ) : (
          <>
            <Zap className="w-3 h-3" />
            <span className="hidden sm:inline">Ask</span>
            <Kbd
              keys={["Mod", "Enter"]}
              size="xs"
              className="hidden md:inline-flex ml-0.5 text-white/70"
            />
          </>
        )}
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={() =>
          isLoading && activeFlag === FLAGS.SUMMARIZER
            ? onStop()
            : onGenerate(FLAGS.SUMMARIZER)
        }
        disabled={
          (!isLoading && !transcribedText.trim()) ||
          (isLoading && activeFlag !== FLAGS.SUMMARIZER)
        }
        title={
          isLoading && activeFlag === FLAGS.SUMMARIZER
            ? "Stop summarizing"
            : transcribedText.trim()
              ? `Summarize transcription (${formatShortcut(["Mod", "Shift", "Enter"])})`
              : "Start transcription first"
        }
        className={cn(
          "h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg border transition-all",
          isLoading && activeFlag === FLAGS.SUMMARIZER
            ? "bg-sky-500/15 text-sky-300 border-sky-500/25 hover:bg-sky-500/25"
            : "bg-blue-500/15 text-blue-300 border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {isLoading && activeFlag === FLAGS.SUMMARIZER ? (
          <LoadingDots color="bg-sky-300" />
        ) : (
          <>
            <FileText className="w-3 h-3" />
            <span className="hidden sm:inline">Summarize</span>
            <Kbd
              keys={["Mod", "Shift", "Enter"]}
              size="xs"
              className="hidden md:inline-flex ml-0.5 text-blue-300/80"
            />
          </>
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleAskMode}
        title={
          askMode
            ? `Hide Ask AI input (${formatShortcut(["Alt", "A"])})`
            : `Ask AI (${formatShortcut(["Alt", "A"])})`
        }
        className={cn(
          "h-7 px-2 gap-1 text-[11px] font-medium rounded-lg transition-colors",
          askMode
            ? "bg-emerald-500/12 text-emerald-200 border border-emerald-500/25"
            : "text-neutral-400 hover:text-emerald-200 hover:bg-emerald-500/[0.08] border border-transparent",
        )}
      >
        <MessageSquare className="w-3 h-3" />
        <span className="hidden sm:inline">Ask AI</span>
        <Kbd
          keys={["Alt", "A"]}
          size="xs"
          className="hidden md:inline-flex ml-0.5"
        />
      </Button>

      {/* Tap-or-hold mic — single button supports both UX:
            · TAP (<200ms): start recording, stays live until next tap
            · HOLD (≥200ms): walkie-talkie, release to send
          Same gesture is bound globally as Space (Ctrl+Space override
          when the input has text). */}
      <button
        type="button"
        {...ptt.pointerHandlers}
        {...ptt.keyboardHandlers}
        disabled={isLoading}
        aria-label="Tap to start recording, hold to push-to-talk"
        aria-pressed={askMic.state === "recording"}
        title={
          askMic.state === "recording"
            ? ptt.isTapLocked
              ? `Tap to stop & send (or ${formatShortcut(["Space"])})`
              : "Release to send"
            : `Tap to start · Hold to push-to-talk (${formatShortcut(["Space"])})`
        }
        className={cn(
          "relative h-7 px-1.5 rounded-lg transition-all shrink-0 flex items-center gap-1 select-none touch-none",
          askMic.state === "recording"
            ? ptt.isTapLocked
              ? "text-red-200 bg-red-500/20 ring-2 ring-red-500/60 shadow-[0_0_16px_-2px] shadow-red-500/70"
              : "text-red-200 bg-red-500/15 ring-2 ring-red-500/40 shadow-[0_0_14px_-2px] shadow-red-500/50"
            : askMic.state === "fetching-key" || askMic.state === "connecting"
              ? "text-emerald-300 bg-emerald-500/10 animate-pulse border border-emerald-500/25"
              : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05] border border-transparent",
        )}
      >
        <Mic className="w-3.5 h-3.5" />
        <Kbd
          keys="Space"
          size="xs"
          className="hidden sm:inline-flex ml-0.5 text-neutral-300"
        />
        {askMic.state === "recording" && (
          <LevelMeter
            level={askMic.level}
            bars={3}
            activeClassName="bg-red-200"
            inactiveClassName="bg-red-500/25"
            className="h-3"
          />
        )}
      </button>

      {isElectron && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCaptureScreen}
          disabled={
            isLoading || isCapturing || attachedImages.length >= maxImages
          }
          aria-label="Attach screenshot for Ask AI"
          title={
            attachedImages.length >= maxImages
              ? `Maximum ${maxImages} screenshots attached`
              : `Screenshot for Ask AI (${formatShortcut(["Mod", "Shift", "1"])})${attachedImages.length > 0 ? ` — ${attachedImages.length}/${maxImages}` : ""}`
          }
          className={cn(
            "h-7 w-7 p-0 rounded-lg transition-colors shrink-0 relative",
            isCapturing
              ? "text-emerald-400 animate-pulse"
              : attachedImages.length > 0
                ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05] border border-transparent",
          )}
        >
          <Camera className="w-3.5 h-3.5" />
          <Kbd
            keys={["Mod", "Shift", "1"]}
            size="xs"
            className="hidden xl:inline-flex ml-0.5 text-emerald-300/90"
          />
          {attachedImages.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-emerald-500 text-[9px] font-bold text-neutral-950 flex items-center justify-center">
              {attachedImages.length}
            </span>
          )}
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSave}
        disabled={!completion.trim()}
        title="Save answer to notes"
        className="h-7 w-7 p-0 rounded-lg text-neutral-400 hover:text-emerald-300 hover:bg-emerald-500/[0.08] disabled:opacity-30"
      >
        <BookmarkPlus className="w-3.5 h-3.5" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleContext}
        title={showContext ? "Hide context" : "Edit context"}
        className={cn(
          "h-7 w-7 p-0 rounded-lg transition-colors relative",
          showContext
            ? "text-emerald-300 bg-emerald-500/[0.08]"
            : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]",
        )}
      >
        <Settings2 className="w-3.5 h-3.5" />
        {hasContextAttached && (
          <span
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400 ring-2 ring-[color:var(--app-surface)]"
            aria-label="Context attached"
          />
        )}
      </Button>

      {hasContextAttached && (
        <span className="hidden md:inline text-[9px] text-sky-300/90 bg-sky-500/[0.08] px-2 py-0.5 rounded-full border border-sky-500/15">
          Context attached
        </span>
      )}

      <div className="flex-1" />

      {transcribedText.trim() && !hasOutput && (
        <span
          className="text-[10px] text-neutral-500 truncate max-w-[32ch] hidden sm:inline italic"
          title={transcribedText}
        >
          {transcribedText.replace(/\s+/g, " ").trim().length > 40
            ? `${transcribedText.replace(/\s+/g, " ").trim().slice(0, 40)}…`
            : transcribedText.replace(/\s+/g, " ").trim()}
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
          onClick={onClearTranscription}
          title="Clear transcription"
          aria-label="Clear transcription"
          className="h-7 w-7 p-0 rounded-lg text-neutral-500 hover:text-sky-300 hover:bg-sky-500/[0.06]"
        >
          <Eraser className="w-3.5 h-3.5" />
        </Button>
      )}

      {hasOutput && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleOutputCollapsed}
          title={outputCollapsed ? "Show answer" : "Hide answer"}
          className="h-7 w-7 p-0 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]"
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
          onClick={onClearAll}
          title="Clear transcription & answer"
          className="h-7 w-7 p-0 rounded-lg text-neutral-500 hover:text-red-300 hover:bg-red-500/[0.06]"
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
          title="Exit compact mode (full layout)"
          className="h-7 px-2 gap-1 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/[0.08]"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium">Full</span>
        </Button>
      )}
    </div>
  );
}
