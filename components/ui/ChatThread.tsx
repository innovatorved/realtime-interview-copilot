"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import {
  compactBubbleSurface,
  compactTextShadow,
  compactUserBubbleSurface,
  overlayBubbleAssistant,
  overlayBubbleUser,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import SafeMarkdown from "@/components/SafeMarkdown";
import type { ChatMessage } from "@/hooks/useAskChat";
import { cn } from "@/lib/utils";

interface ChatThreadProps {
  messages: ChatMessage[];
  userLabel?: string;
  onImageClick?: (dataUrl: string) => void;
  density?: "default" | "compact";
  className?: string;
}

export function ChatThread({
  messages,
  userLabel,
  onImageClick,
  density = "default",
  className,
}: ChatThreadProps) {
  const newestFirst = [...messages].reverse();

  return (
    <div
      className={cn(
        "flex flex-col",
        density === "compact" ? "gap-2" : "gap-3",
        className,
      )}
    >
      {newestFirst.map((msg) => (
        <ChatBubble
          key={msg.id}
          message={msg}
          userLabel={userLabel}
          onImageClick={onImageClick}
          density={density}
        />
      ))}
    </div>
  );
}

function ChatBubble({
  message,
  userLabel,
  onImageClick,
  density,
}: {
  message: ChatMessage;
  userLabel?: string;
  onImageClick?: (dataUrl: string) => void;
  density: "default" | "compact";
}) {
  const isUser = message.role === "user";
  const showImages = message.images && message.images.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
      )}
    >
      {isUser && userLabel && userLabel.length > 0 && (
        <span className="max-w-[88%] truncate pr-0.5 text-right text-[10px] font-medium text-text-tertiary">
          {userLabel}
        </span>
      )}
      {showImages && message.images && (
        <div
          className={cn(
            "flex flex-wrap gap-2",
            density === "compact" ? "max-w-[90%]" : "max-w-[85%]",
            isUser ? "justify-end" : "justify-start",
          )}
        >
          {message.images.map((src) => (
            <button
              key={src.slice(0, 48)}
              type="button"
              onClick={onImageClick ? () => onImageClick(src) : undefined}
              disabled={!onImageClick}
              className={cn(
                "block overflow-hidden rounded-md border border-border-subtle transition-colors",
                onImageClick &&
                  "cursor-zoom-in hover:border-accent/40 active:opacity-80",
              )}
              aria-label={
                onImageClick
                  ? "View attached screenshot"
                  : "Attached screenshot"
              }
            >
              {/* biome-ignore lint/performance/noImgElement: data URLs from screen capture */}
              <img
                src={src}
                alt={isUser ? "Attached by user" : "Attached"}
                className={cn(
                  "object-contain",
                  density === "compact"
                    ? "max-h-24 max-w-[140px]"
                    : "max-h-32 max-w-[180px]",
                )}
              />
            </button>
          ))}
        </div>
      )}
      {(message.text || (message.pending && !showImages)) && (
        <div
          className={cn(
            "max-w-[88%] rounded-lg leading-relaxed text-text-primary",
            density === "compact"
              ? "px-2.5 py-1.5 text-xs"
              : "px-3.5 py-2.5 text-sm",
            density === "compact"
              ? cn(
                  compactTextShadow,
                  isUser ? compactUserBubbleSurface : compactBubbleSurface,
                )
              : cn(
                  overlayTextShadow,
                  isUser ? overlayBubbleUser : overlayBubbleAssistant,
                ),
          )}
        >
          {isUser ? (
            <p className="m-0 whitespace-pre-wrap break-words">
              {message.text}
            </p>
          ) : message.pending && !message.text ? (
            <TypingIndicator />
          ) : (
            <div
              className={cn(
                "prose prose-invert max-w-none break-words prose-sm",
                "prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5",
                "prose-pre:my-2 prose-pre:rounded-md",
                "prose-headings:my-2 prose-headings:font-semibold",
                "prose-code:text-accent-text prose-code:before:content-none prose-code:after:content-none",
                "prose-a:text-accent-text",
              )}
            >
              <SafeMarkdown>{message.text}</SafeMarkdown>
              {message.pending && <CursorBlink />}
            </div>
          )}
        </div>
      )}
      {!isUser && !message.pending && message.text.length > 0 && (
        <CopyButton text={message.text} />
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="Assistant typing"
      className="flex items-center gap-1 py-1"
    >
      <span className="h-1.5 w-1.5 animate-recording-pulse rounded-full bg-accent" />
      <span className="h-1.5 w-1.5 animate-recording-pulse rounded-full bg-accent [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-recording-pulse rounded-full bg-accent [animation-delay:240ms]" />
    </div>
  );
}

function CursorBlink() {
  return (
    <span
      aria-hidden="true"
      className="-mb-[2px] ml-0.5 inline-block h-[14px] w-[7px] animate-recording-pulse bg-accent-text align-middle"
    />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          void navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-tertiary transition-colors hover:text-text-secondary"
      title="Copy answer"
      aria-label={copied ? "Copied to clipboard" : "Copy answer to clipboard"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
