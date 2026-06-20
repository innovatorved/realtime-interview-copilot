"use client";

/** Compact Ask AI drawer — typed freeform question + screenshots +
 *  live mic banner. Pure presentational once the parent passes in the
 *  chat / mic / ptt hooks and the relevant state.
 *
 *  Notes for callers: the parent owns `askInput` / `attachedImages` and
 *  the lifecycle of the chat thread (`chat.send`, `chat.reset`). This
 *  component only renders the UI and forwards submit / clear events. */

import { Camera, ImageIcon, Mic, Plus, Send, X } from "lucide-react";
import posthog from "posthog-js";
import type { RefObject } from "react";
import { AskListeningBanner } from "@/components/ask/AskListeningBanner";
import type { useAskChat } from "@/hooks/useAskChat";
import type { useAskMic } from "@/hooks/useAskMic";
import type { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { AskMicDebugHud } from "@/components/ui/AskMicDebugHud";
import { Button } from "@/components/ui/button";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { LevelMeter } from "@/components/ui/LevelMeter";
import { cn } from "@/lib/utils";
import { VISION_FALLBACK_PROMPT } from "@/lib/vision-screenshot";
import type { CompactOutputMode } from "./OutputPanel";

interface AskDrawerProps {
  askInput: string;
  setAskInput: (value: string) => void;
  askInputRef: RefObject<HTMLInputElement | null>;
  askFormRef: RefObject<HTMLFormElement | null>;
  attachedImages: string[];
  removeImageAt: (index: number) => void;
  clearAttachedImages: () => void;
  maxImages: number;
  chat: ReturnType<typeof useAskChat>;
  askMic: ReturnType<typeof useAskMic>;
  ptt: ReturnType<typeof useMicPushToTalk>;
  isLoading: boolean;
  isCapturing: boolean;
  isElectron: boolean;
  onCaptureScreen: () => void;
  setOutputMode: (mode: CompactOutputMode) => void;
  setOutputCollapsed: (collapsed: boolean) => void;
}

export function AskDrawer({
  askInput,
  setAskInput,
  askInputRef,
  askFormRef,
  attachedImages,
  removeImageAt,
  clearAttachedImages,
  maxImages,
  chat,
  askMic,
  ptt,
  isLoading,
  isCapturing,
  isElectron,
  onCaptureScreen,
  setOutputMode,
  setOutputCollapsed,
}: AskDrawerProps) {
  return (
    <div data-clickable className="app-toolbar flex flex-col gap-2 px-3 py-2">
      {/* Chat header row — turn counter + New chat. Only visible once
          there's a thread; absent on first visit so the empty drawer
          doesn't grow taller for new users. */}
      {chat.messages.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-neutral-500 tabular-nums">
            Ask AI · {Math.ceil(chat.messages.length / 2)} turn
            {chat.messages.length > 2 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              chat.reset();
              setAskInput("");
              clearAttachedImages();
              setOutputMode("chat");
              posthog.capture("ask_new_chat", { surface: "compact" });
            }}
            title={`Start a new chat (${formatShortcut(["Mod", "Shift", "N"])})`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-neutral-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>New chat</span>
            <Kbd
              keys={["Mod", "Shift", "N"]}
              size="xs"
              className="hidden md:inline-flex ml-0.5 text-neutral-500"
            />
          </button>
        </div>
      )}
      {/* Live "listening" banner: removes the "is the mic even on?"
          ambiguity that the previous toggle UX had — without this,
          a silently denied mic permission looked identical to the
          user just not talking yet. */}
      <AskListeningBanner askMic={askMic} ptt={ptt} density="compact" />

      {attachedImages.length > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto custom-scrollbar">
            {attachedImages.map((src, idx) => (
              <div key={src.slice(0, 48)} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Attached screenshot ${idx + 1}`}
                  className="w-14 h-10 object-cover rounded-md border border-[color:var(--app-border)]"
                />
                <button
                  type="button"
                  onClick={() => removeImageAt(idx)}
                  aria-label={`Remove screenshot ${idx + 1}`}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[color:var(--app-surface)] border border-[color:var(--app-border)] text-neutral-300 hover:text-white hover:bg-[color:color-mix(in_oklch,var(--app-surface-elev)_90%,transparent)] opacity-90"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="shrink-0 text-[10px] font-medium text-emerald-300 flex items-center gap-1">
            <ImageIcon className="w-3 h-3 shrink-0" />
            {attachedImages.length}/{maxImages}
          </p>
        </div>
      )}
      <form
        ref={askFormRef}
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // Refuse if any single-shot generation is in flight (Copilot /
          // Summarizer use the legacy `controller.current` path); the
          // chat hook has its own guard for concurrent chat sends.
          if (isLoading) return;
          if (chat.isStreaming) return;
          if (!askInput.trim() && attachedImages.length === 0) return;

          const text = askInput.trim() || VISION_FALLBACK_PROMPT;
          const imagesSnapshot =
            attachedImages.length > 0 ? [...attachedImages] : undefined;
          // Switch the output panel to chat mode BEFORE sending so
          // the user sees their just-posted bubble appear in the
          // right surface. clearAttachedImages + setAskInput("")
          // also reset the composer so a second Enter doesn't
          // re-submit the same prompt mid-stream.
          setOutputMode("chat");
          setOutputCollapsed(false);
          setAskInput("");
          clearAttachedImages();
          posthog.capture("question_asked", {
            question_length: text.length,
            has_image: !!imagesSnapshot,
            image_count: imagesSnapshot?.length ?? 0,
            surface: "compact",
            chat_turn: Math.floor(chat.messages.length / 2) + 1,
            is_follow_up: chat.messages.length > 0,
          });
          void chat.send({ text, images: imagesSnapshot });
        }}
      >
        <input
          ref={askInputRef}
          type="text"
          value={askInput}
          onChange={(e) => setAskInput(e.target.value)}
          placeholder={
            askMic.state === "recording"
              ? "Listening… speak your question"
              : attachedImages.length > 0
                ? "Add a question (optional) or press Enter…"
                : "Type a question for the AI…"
          }
          autoFocus
          className="flex-1 min-w-0 bg-neutral-900/50 border border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-neutral-200 placeholder:text-neutral-600 text-xs rounded-lg px-2.5 py-1.5"
        />
        {/* Drawer-local mic mirror: same tap-or-hold gesture as the
            toolbar button, here so the user can trigger it without
            moving the cursor up to the toolbar. */}
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
            "relative h-7 px-1.5 rounded-lg shrink-0 flex items-center gap-1 select-none touch-none transition-all",
            askMic.state === "recording"
              ? ptt.isTapLocked
                ? "text-red-200 bg-red-500/20 ring-2 ring-red-500/60 shadow-[0_0_14px_-2px] shadow-red-500/70"
                : "text-red-200 bg-red-500/15 ring-2 ring-red-500/40 shadow-[0_0_12px_-2px] shadow-red-500/50"
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
            aria-label="Attach screenshot"
            title={
              attachedImages.length >= maxImages
                ? `Max ${maxImages} screenshots`
                : `Attach screenshot (${formatShortcut(["Mod", "Shift", "1"])})`
            }
            className={cn(
              "h-7 w-7 p-0 rounded-lg shrink-0 relative",
              isCapturing
                ? "text-emerald-400 animate-pulse"
                : attachedImages.length > 0
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]",
            )}
          >
            <Camera className="w-3.5 h-3.5" />
            <Kbd
              keys={["Mod", "Shift", "1"]}
              size="xs"
              className="hidden xl:inline-flex ml-0.5 text-emerald-300/90"
            />
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={
            (!askInput.trim() && attachedImages.length === 0) || isLoading
          }
          title="Send to AI (Enter)"
          className="h-7 px-2.5 gap-1 text-[11px] font-medium rounded-lg accent-gradient text-white shadow-sm hover:shadow-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-3 h-3" />
          <span className="hidden sm:inline">Send</span>
          <Kbd
            keys="↵"
            size="xs"
            className="hidden md:inline-flex text-white/80"
          />
        </Button>
      </form>
      {/* Inline hint row — surfaces the new shortcuts in text-xs so the
          user can discover them without hovering. Mod/Alt/Ctrl tokens
          render the right glyph for the current OS automatically. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <Kbd keys="Space" size="xs" />
          <span className="text-[10px]">tap or hold to talk</span>
        </span>
        {isElectron && (
          <span className="inline-flex items-center gap-1">
            <Kbd keys={["Mod", "Shift", "1"]} size="xs" />
            <span className="text-[10px]">screenshot</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Kbd keys="↵" size="xs" />
          <span className="text-[10px]">send</span>
        </span>
        {askMic.error && (
          <span className="text-[10px] text-red-300/90">{askMic.error}</span>
        )}
      </div>
      {/* Debug HUD — same as the full Ask AI surface. Auto-visible
          in dev / when `?askmic_debug=1`. Reveals at-a-glance which
          stage of the pipeline is failing. */}
      <AskMicDebugHud
        state={askMic.state}
        level={askMic.level}
        stats={askMic.stats}
        error={askMic.error}
      />
    </div>
  );
}
