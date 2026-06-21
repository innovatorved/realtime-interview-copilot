"use client";

/** Inline Ask AI composer — single row under the toolbar.
 *  Copilot/Summarize stay in the toolbar above; this is for typed/chat Ask AI. */

import { ImageIcon, Plus, Send, X } from "lucide-react";
import posthog from "posthog-js";
import type { RefObject } from "react";
import { AskListeningBanner } from "@/components/ask/AskListeningBanner";
import { overlayInput } from "@/components/compact/compactTextStyles";
import type { useAskChat } from "@/hooks/useAskChat";
import type { useAskMic } from "@/hooks/useAskMic";
import type { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { Button } from "@/components/ui/button";
import { formatShortcut } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import type { CompactOutputMode } from "./OutputPanel";

interface CompactAskComposerProps {
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
  setOutputMode: (mode: CompactOutputMode) => void;
  setOutputCollapsed: (collapsed: boolean) => void;
  submitAskInput: (textOverride?: string) => void | Promise<void>;
}

export function CompactAskComposer({
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
  setOutputMode,
  setOutputCollapsed,
  submitAskInput,
}: CompactAskComposerProps) {
  const showListening =
    askMic.state === "recording" ||
    askMic.state === "fetching-key" ||
    askMic.state === "connecting";

  return (
    <div
      data-clickable
      className="app-toolbar flex flex-col gap-1.5 border-t border-border-subtle/40 px-2.5 py-1.5"
    >
      {chat.messages.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] tabular-nums text-text-tertiary">
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
            title={`New chat (${formatShortcut(["Mod", "Shift", "N"])})`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-tertiary transition-colors hover:bg-accent-muted hover:text-accent-text"
          >
            <Plus className="h-2.5 w-2.5" />
            New chat
          </button>
        </div>
      )}

      {showListening && (
        <AskListeningBanner askMic={askMic} ptt={ptt} density="compact" />
      )}

      {attachedImages.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
          {attachedImages.map((src, idx) => (
            <div key={src.slice(0, 48)} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Attached screenshot ${idx + 1}`}
                className="h-8 w-12 rounded border border-border-subtle object-cover"
              />
              <button
                type="button"
                onClick={() => removeImageAt(idx)}
                aria-label={`Remove screenshot ${idx + 1}`}
                className="absolute -right-1 -top-1 rounded-full border border-border-subtle bg-surface-raised p-0.5 text-text-tertiary hover:text-text-primary"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-accent-text">
            <ImageIcon className="h-3 w-3" />
            {attachedImages.length}/{maxImages}
          </span>
        </div>
      )}

      <form
        ref={askFormRef}
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submitAskInput();
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
                ? "Add a question (optional) or Enter…"
                : "Ask the AI anything…"
          }
          autoFocus
          className={cn(
            "h-7 min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-ring",
            overlayInput,
          )}
        />
        <Button
          type="submit"
          size="sm"
          disabled={
            (!askInput.trim() && attachedImages.length === 0) ||
            isLoading ||
            chat.isStreaming
          }
          title="Send (Enter)"
          variant="default"
          className="h-7 shrink-0 gap-1 px-2.5 text-[11px] font-medium"
        >
          <Send className="h-3 w-3" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>

      {askMic.error && (
        <p className="text-[10px] text-red-300/90">{askMic.error}</p>
      )}
    </div>
  );
}
