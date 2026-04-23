"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Square,
  MessageSquare,
  Sparkles,
  Camera,
  X,
  Image as ImageIcon,
  Loader2,
  ArrowDown,
} from "lucide-react";
import { BACKEND_API_URL } from "@/lib/constant";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import posthog from "posthog-js";

interface QuestionAssistantProps {
  isActive?: boolean;
}

export function QuestionAssistant({
  isActive = false,
}: QuestionAssistantProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
    }
  }, []);

  // Listen for global hotkey → attach screenshot + focus input
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.startsWith("data:image")) {
        setAttachedImage(detail);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("ask-ai:attach-screenshot", handler);
    return () =>
      window.removeEventListener("ask-ai:attach-screenshot", handler);
  }, []);

  // Auto-scroll to bottom while the answer streams, unless user has
  // scrolled up to read earlier content.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (!stickToBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [answer, isLoading]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 24;
    stickToBottomRef.current = atBottom;
    setShowScrollDown(!atBottom && el.scrollHeight > el.clientHeight + 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  const handleCaptureScreen = useCallback(async () => {
    if (!window.electronAPI?.screen) return;
    setIsCapturing(true);
    setError(null);
    try {
      const result = await window.electronAPI.screen.capture();
      if (result.success) {
        setAttachedImage(result.dataUrl);
        posthog.capture("screen_attached_to_question");
      } else {
        setError(`Could not capture screen: ${result.error}`);
      }
    } catch (err) {
      setError(
        `Could not capture screen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTypingInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key.toLowerCase() === "k" && !isTypingInInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && answer) {
        e.preventDefault();
        setAnswer("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [answer, isActive]);

  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isActive]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Guard against Enter-submitting (or the action button re-submitting)
    // the form while a request is already in flight. Without this, pressing
    // the Stop button was aborting the controller AND letting the form
    // submit, which kicked off a fresh request — looking like a restart.
    if (isLoading) return;
    if (!question.trim() && !attachedImage) return;

    setError(null);
    setAnswer("");
    setIsLoading(true);
    stickToBottomRef.current = true;
    setShowScrollDown(false);

    if (controller.current) controller.current.abort();
    controller.current = new AbortController();

    posthog.capture("question_asked", {
      question_length: question.length,
      has_image: !!attachedImage,
    });

    const effectivePrompt =
      question.trim() ||
      "Analyze this screenshot and explain what's happening. If it shows an interview question, answer it thoroughly.";

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: effectivePrompt,
          flag: "copilot",
          bg: "You are a professional interview coach. Provide detailed, comprehensive, interview-ready answers.",
          image: attachedImage ?? undefined,
        }),
        signal: controller.current.signal,
        credentials: "include",
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body is null");

      const decoder = new TextDecoder();
      let fullAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const eventStrings = chunk.split("\n\n");

        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;
          const dataMatch = eventString.match(/data: (.*)/);
          if (!dataMatch) continue;
          const data = dataMatch[1];
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullAnswer += parsed.text;
              setAnswer(fullAnswer);
            }
          } catch (err) {
            console.error("Error parsing response:", err);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Error:", err);
        setError("Failed to get answer. Please try again.");
        posthog.captureException(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      setIsLoading(false);
      controller.current = null;
    }
  };

  const handleStop = useCallback(() => {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
    }
    setIsLoading(false);
  }, []);

  const hasContent = !!answer || isLoading || !!error;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Sticky composer at the top: header + attachment chip + input */}
      <div className="shrink-0 border-b border-white/[0.04] bg-zinc-950/40 backdrop-blur-xl">
        <div className="w-full max-w-3xl mx-auto px-4 pt-5 pb-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/10 shrink-0">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                Ask AI Assistant
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              </h2>
              <p className="text-[11px] text-zinc-500">
                Get interview-ready answers instantly
              </p>
            </div>
          </div>

          {/* Attached screenshot preview */}
          {attachedImage && (
            <div className="mb-2 flex items-center gap-2 p-2 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/15 animate-fade-in-scale">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachedImage}
                  alt="Attached screenshot"
                  className="w-14 h-10 object-cover rounded-md border border-white/10"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-emerald-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3 h-3" />
                  Screenshot attached
                </p>
                <p className="text-[10px] text-zinc-500 truncate">
                  Ask a question about what&apos;s on your screen
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                aria-label="Remove screenshot"
                className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  attachedImage
                    ? "Add a question (optional) or press Enter..."
                    : "Type your question... (K)"
                }
                disabled={isLoading}
                className="glass-input h-11 text-sm border-0 pl-4 pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {isElectron && (
                  <button
                    type="button"
                    onClick={handleCaptureScreen}
                    disabled={isLoading || isCapturing}
                    aria-label="Attach screenshot"
                    title="Attach screenshot (⌘⇧1)"
                    className={`p-1.5 rounded-md transition-colors ${
                      isCapturing
                        ? "text-emerald-400 animate-pulse"
                        : attachedImage
                          ? "text-emerald-400 bg-emerald-500/10"
                          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                )}
                {!isLoading && (question.trim() || attachedImage) && (
                  <kbd className="text-[9px] text-zinc-600 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06] font-mono">
                    ↵
                  </kbd>
                )}
              </div>
            </div>
            <Button
              type={isLoading ? "button" : "submit"}
              disabled={!isLoading && !question.trim() && !attachedImage}
              onClick={isLoading ? handleStop : undefined}
              className={`h-11 px-5 rounded-xl font-medium transition-all text-sm shrink-0 ${
                isLoading
                  ? "bg-red-500/80 hover:bg-red-500 text-white"
                  : "accent-gradient text-white shadow-lg hover:shadow-emerald-500/20"
              }`}
            >
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Ask
                </span>
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Scrollable answer area */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto custom-scrollbar"
        >
          <div className="w-full max-w-3xl mx-auto px-4 py-5 pb-12">
            {error && (
              <div className="p-3 glass-card border-red-500/10 text-red-300 text-sm rounded-xl mb-4 animate-fade-in-scale">
                {error}
              </div>
            )}

            {/* Streaming indicator while waiting for first token */}
            {isLoading && !answer && (
              <div className="glass-card p-5 rounded-2xl animate-fade-in-scale">
                <div className="flex items-center gap-3 mb-4">
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                  <span className="text-sm text-zinc-300">
                    Thinking
                    <span className="inline-flex ml-1">
                      <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                      <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                      <span className="animate-bounce">.</span>
                    </span>
                  </span>
                </div>
                <div className="space-y-2.5 animate-pulse">
                  <div className="h-3 w-full bg-white/[0.06] rounded-md" />
                  <div className="h-3 w-5/6 bg-white/[0.04] rounded-md" />
                  <div className="h-3 w-2/3 bg-white/[0.04] rounded-md" />
                  <div className="h-3 w-4/5 bg-white/[0.03] rounded-md" />
                </div>
              </div>
            )}

            {/* Answer body */}
            {answer && (
              <div className="glass-card p-6 rounded-2xl animate-fade-in-up">
                <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed text-zinc-200 break-words
                  [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:my-2
                  [&_ul]:text-[13px] [&_ul]:my-2 [&_ol]:text-[13px] [&_ol]:my-2 [&_li]:my-0.5
                  [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2
                  [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2
                  [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5
                  [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1
                  [&_code]:text-[12px] [&_code]:break-words
                  [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre [&_pre]:my-2
                  [&_table]:block [&_table]:overflow-x-auto [&_table]:text-[12px]
                  [&_strong]:font-semibold [&_strong]:text-white
                  [&_blockquote]:text-[13px] [&_blockquote]:my-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {answer}
                  </ReactMarkdown>
                </div>
                {isLoading && (
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-emerald-400/70">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Streaming…
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {!hasContent && (
              <div className="flex flex-col items-center text-center pt-10 pb-8 space-y-4">
                <div className="grid grid-cols-2 gap-3 max-w-md w-full">
                  {[
                    "Tell me about yourself",
                    "Why this company?",
                    "Describe a challenge you overcame",
                    "What are your strengths?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setQuestion(suggestion)}
                      className="glass-card-hover p-3 text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-zinc-600 mt-4">
                  <span>
                    Press{" "}
                    <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-zinc-500 font-mono text-[9px]">
                      K
                    </kbd>{" "}
                    to focus
                  </span>
                  {isElectron && (
                    <span>
                      <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-zinc-500 font-mono text-[9px]">
                        ⌘⇧1
                      </kbd>{" "}
                      to attach screen anywhere
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Scroll-to-bottom affordance */}
        {showScrollDown && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Scroll to latest"
            className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-[11px] backdrop-blur-xl shadow-lg hover:bg-emerald-500/25 transition-colors animate-fade-in-scale"
          >
            <ArrowDown className="w-3 h-3" />
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
