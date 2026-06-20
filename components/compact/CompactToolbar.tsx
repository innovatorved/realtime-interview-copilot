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
import { overlayTextShadow } from "@/components/compact/compactTextStyles";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="inline-flex h-7 w-20 rounded-md border border-border-subtle bg-surface-inset animate-skeleton" />
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
          "h-7 gap-1 rounded-md px-2.5 text-[11px] font-medium",
          isLoading && activeFlag === FLAGS.COPILOT
            ? "border border-info/25 bg-info/10 text-info hover:bg-info/15"
            : "",
        )}
        variant={
          isLoading && activeFlag === FLAGS.COPILOT ? "secondary" : "default"
        }
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
          "h-7 gap-1 rounded-md border px-2.5 text-[11px] font-medium",
          isLoading && activeFlag === FLAGS.SUMMARIZER
            ? "border-info/25 bg-info/10 text-info hover:bg-info/15"
            : "border-border-subtle bg-surface-overlay text-text-secondary hover:bg-surface-raised disabled:opacity-40",
        )}
        variant="secondary"
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
            ? `Hide Ask input (${formatShortcut(["Alt", "A"])})`
            : `Show Ask input (${formatShortcut(["Alt", "A"])})`
        }
        className={cn(
          "h-7 gap-1 rounded-md border px-2 text-[11px] font-medium",
          askMode
            ? "border-accent/30 bg-accent-muted text-accent-text"
            : "border-transparent text-text-tertiary hover:border-border-subtle hover:bg-surface-overlay hover:text-text-primary",
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
              ? "bg-destructive-muted text-destructive ring-2 ring-destructive/40"
              : "bg-destructive-muted text-destructive ring-2 ring-destructive/25"
            : askMic.state === "fetching-key" || askMic.state === "connecting"
              ? "animate-recording-pulse border border-accent/25 bg-accent-muted text-accent-text"
              : "border border-transparent text-text-tertiary hover:bg-surface-overlay hover:text-text-primary",
        )}
      >
        <Mic className="w-3.5 h-3.5" />
        <Kbd
          keys="Space"
          size="xs"
          className="ml-0.5 hidden text-text-secondary sm:inline-flex"
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
            "relative h-7 w-7 shrink-0 rounded-md p-0",
            isCapturing
              ? "animate-recording-pulse text-accent-text"
              : attachedImages.length > 0
                ? "border border-accent/25 bg-accent-muted text-accent-text"
                : "text-text-tertiary hover:bg-surface-overlay hover:text-text-primary",
          )}
        >
          <Camera className="w-3.5 h-3.5" />
          <Kbd
            keys={["Mod", "Shift", "1"]}
            size="xs"
            className="hidden xl:inline-flex ml-0.5 text-emerald-300/90"
          />
          {attachedImages.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-accent-foreground">
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
        className="h-7 w-7 rounded-md p-0 text-text-tertiary hover:bg-accent-muted hover:text-accent-text disabled:opacity-30"
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
          "relative h-7 w-7 rounded-md p-0",
          showContext
            ? "bg-accent-muted text-accent-text"
            : "text-text-tertiary hover:bg-surface-overlay hover:text-text-primary",
        )}
      >
        <Settings2 className="w-3.5 h-3.5" />
        {hasContextAttached && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-info ring-2 ring-surface-raised"
            aria-label="Context attached"
          />
        )}
      </Button>

      {hasContextAttached && (
        <span className="hidden rounded-full border border-info/20 bg-info/10 px-2 py-0.5 text-[9px] text-info md:inline">
          Context attached
        </span>
      )}

      <div className="flex-1" />

      {transcribedText.trim() && !hasOutput && (
        <span
          className={`hidden max-w-[32ch] truncate text-[10px] italic text-text-tertiary sm:inline ${overlayTextShadow}`}
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
          className="h-7 w-7 rounded-md p-0 text-text-tertiary hover:bg-info/10 hover:text-info"
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
          className="h-7 w-7 rounded-md p-0 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"
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
          className="h-7 w-7 rounded-md p-0 text-text-tertiary hover:bg-destructive-muted hover:text-destructive"
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
          className="h-7 gap-1 rounded-md px-2 text-accent-text hover:bg-accent-muted"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium">Full</span>
        </Button>
      )}
    </div>
  );
}
