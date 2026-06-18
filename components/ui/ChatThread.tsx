"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import SafeMarkdown from "@/components/SafeMarkdown";
import type { ChatMessage } from "@/hooks/useAskChat";
import { cn } from "@/lib/utils";

interface ChatThreadProps {
  messages: ChatMessage[];
  /**
   * Shown in small type above user bubbles (name, or email handle if no
   * display name). Omit when not signed in.
   */
  userLabel?: string;
  /**
   * Optional click handler for an inline image attachment. Surfaces use
   * this to open the screenshot full-size in a lightbox. If omitted, the
   * image renders as a non-interactive thumbnail.
   */
  onImageClick?: (dataUrl: string) => void;
  /**
   * Visual density. `compact` is for the CompactCopilot drawer (tighter
   * padding, slightly smaller bubbles); `default` for the full Ask AI
   * surface.
   */
  density?: "default" | "compact";
  className?: string;
}

/**
 * Renders a chat conversation as alternating user / assistant bubbles.
 * User text is rendered verbatim (so a typed `*` doesn't accidentally
 * become italics); assistant text goes through `SafeMarkdown`. Streaming
 * assistant turns show a typing indicator while empty, and a blinking
 * cursor once tokens have started arriving.
 */
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
        <span className="max-w-[88%] truncate pr-0.5 text-right text-[10px] font-medium text-neutral-500">
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
                "block rounded-md overflow-hidden border border-white/[0.08] transition-colors",
                onImageClick &&
                  "hover:border-emerald-500/40 cursor-zoom-in active:opacity-80",
              )}
              aria-label={
                onImageClick
                  ? "View attached screenshot"
                  : "Attached screenshot"
              }
            >
              {/* biome-ignore lint/performance/noImgElement: data URLs from screen capture — Next/Image can't optimize them and would re-fetch the giant base64 string on every render */}
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
            "rounded-xl max-w-[88%] leading-relaxed",
            density === "compact"
              ? "px-2.5 py-1.5 text-xs"
              : "px-3.5 py-2.5 text-sm",
            isUser
              ? "bg-emerald-500/10 border border-emerald-500/15 text-neutral-100"
              : density === "compact"
                ? "bg-black/20 border border-white/[0.06] text-neutral-100 backdrop-blur-[2px]"
                : "bg-white/[0.04] border border-white/[0.06] text-neutral-200",
          )}
        >
          {isUser ? (
            // Plain text for user messages — preserve newlines but never
            // render markdown so a literal `*` or HTML tag stays literal.
            <p className="whitespace-pre-wrap break-words m-0">
              {message.text}
            </p>
          ) : message.pending && !message.text ? (
            <TypingIndicator />
          ) : (
            <div
              className={cn(
                "prose prose-invert max-w-none break-words",
                density === "compact" ? "prose-sm" : "prose-sm",
                // Tighten markdown vertical rhythm so chat bubbles don't
                // grow gigantic with lists / code blocks.
                "prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5",
                "prose-pre:my-2 prose-pre:rounded-md",
                "prose-headings:my-2 prose-headings:font-semibold",
                "prose-code:text-emerald-300 prose-code:before:content-none prose-code:after:content-none",
                "prose-a:text-emerald-300",
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
  // role="status" makes the aria-label valid (decorative <div>s can't
  // carry aria-label per the WAI spec) and announces to screen readers
  // that the assistant is composing a reply.
  return (
    <div
      role="status"
      aria-label="Assistant typing"
      className="flex items-center gap-1 py-1"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse [animation-delay:120ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse [animation-delay:240ms]" />
    </div>
  );
}

function CursorBlink() {
  // A blinking caret appended to a streaming bubble so the eye has
  // something to lock onto while tokens arrive. Hidden via CSS once the
  // assistant message is finalised (pending: false).
  return (
    <span
      aria-hidden="true"
      className="inline-block w-[7px] h-[14px] -mb-[2px] bg-emerald-300/70 animate-pulse align-middle ml-0.5"
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
          // Older Electron/Chromium contexts can throw; fail silently.
        }
      }}
      className="text-[10px] text-neutral-500 hover:text-neutral-300 inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
      title="Copy answer"
      aria-label={copied ? "Copied to clipboard" : "Copy answer to clipboard"}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
