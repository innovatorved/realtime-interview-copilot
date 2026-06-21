"use client";

import {
  ArrowDown,
  Camera,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AskListeningBanner } from "@/components/ask/AskListeningBanner";
import { useAskScreenshotBridge } from "@/components/ask/useAskScreenshotBridge";
import { AskMicDebugHud } from "@/components/ui/AskMicDebugHud";
import { Button } from "@/components/ui/button";
import { ChatThread } from "@/components/ui/ChatThread";
import { Input } from "@/components/ui/input";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { LevelMeter } from "@/components/ui/LevelMeter";
import { useSharedAskChat } from "@/components/AskChatProvider";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useAskMic } from "@/hooks/useAskMic";
import { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { dbg } from "@/lib/debug";
import { hasAttachedContext } from "@/lib/prompt-context";
import { trackEvent } from "@/lib/session-tracking";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  overlayErrorBlock,
  overlayInput,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import {
  isVisionScreenshotDataUrl,
  VISION_FALLBACK_PROMPT,
} from "@/lib/vision-screenshot";

interface QuestionAssistantProps {
  isActive?: boolean;
}

// Hard cap on attached screenshots — keeps total payload size for /api/completion
// and per-request model token cost bounded. Must match MAX_IMAGES_PER_REQUEST
// in the worker so the server-side parser silently drops any extras a stale
// renderer might send.
const MAX_IMAGES = 4;

export function QuestionAssistant({
  isActive = false,
}: QuestionAssistantProps) {
  const { data: session } = authClient.useSession();
  const [question, setQuestion] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const stickToBottomRef = useRef(true);

  // Shared Ask AI thread — same conversation in full mode and compact drawer.
  const chat = useSharedAskChat();
  const { messages, isLoading } = chat;
  const { resumeText, jobDescription, interviewNotes } = useInterviewContext();
  const contextAttached = hasAttachedContext({ resumeText, jobDescription });
  const hasNotes = !!interviewNotes.trim();
  // Surface-level error state — used for screenshot capture failures
  // (e.g. user denied screen recording permission, electron API
  // unavailable). Distinct from `chat.error` which is owned by the chat
  // hook and reflects API/transport failures during a completion. We
  // merge the two for display below so the user sees whichever is set.
  const [captureError, setCaptureError] = useState<string | null>(null);
  const error = chat.error ?? captureError;
  // Local alias so the existing capture-error code that referenced
  // `setError` continues to work without a sweeping rename.
  const setError = setCaptureError;

  // Snapshot of the question/images at the moment the mic was started, so a
  // user who's already typed something can dictate an addition without
  // losing the prefix (we restore the prefix and append the transcript).
  const micPrefixRef = useRef<string>("");

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
    }
  }, []);

  // Append new screenshots up to MAX_IMAGES. We append (not replace) so the
  // Cmd+Shift+1 hotkey can be pressed repeatedly to attach several screens to
  // one question. Silently caps; the UI surfaces the "N/4" counter.
  const appendImage = useCallback((dataUrl: string) => {
    setAttachedImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      // Skip exact duplicates so accidental double-presses of the hotkey
      // don't waste a slot with the same screen.
      if (prev.includes(dataUrl)) return prev;
      return [...prev, dataUrl];
    });
  }, []);

  const removeImageAt = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Listen for global hotkey → attach screenshot + focus input. Each press
  // appends another image (up to MAX_IMAGES).
  useAskScreenshotBridge({ appendImage, inputRef });

  // Track the length of the last message's text so the effect re-runs as
  // tokens stream in (chat.messages identity doesn't change between
  // setMessages calls in the same array shape — but the array length and
  // tail text length DO change, which is what we want).
  const lastMessageText =
    messages.length > 0 ? messages[messages.length - 1].text : "";

  // Auto-scroll to the newest turn while a new turn appears / streams, unless the
  // user has scrolled up to re-read an earlier answer. The deps are
  // there to TRIGGER this effect on every token / new turn — the effect
  // body itself reads them only through scrollRef, which biome's
  // useExhaustiveDependencies can't see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps drive re-run, not body reads
  useEffect(() => {
    if (!scrollRef.current) return;
    if (!stickToBottomRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [messages.length, lastMessageText, isLoading]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromTop = el.scrollTop;
    const atTop = distanceFromTop < 24;
    stickToBottomRef.current = atTop;
    setShowScrollDown(!atTop && el.scrollHeight > el.clientHeight + 80);
  }, []);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  const handleCaptureScreen = useCallback(async () => {
    if (!window.electronAPI?.screen) return;
    // Guard the UI before invoking the (expensive) native capture.
    if (attachedImages.length >= MAX_IMAGES) {
      setError(
        `You can attach at most ${MAX_IMAGES} screenshots per question.`,
      );
      return;
    }
    setIsCapturing(true);
    setError(null);
    try {
      const result = await window.electronAPI.screen.capture();
      if (result.success) {
        const dataUrl = result.dataUrl.trim();
        if (!isVisionScreenshotDataUrl(dataUrl)) {
          setError(
            "Screenshot could not be attached (invalid image data). Try again.",
          );
          return;
        }
        appendImage(dataUrl);
        posthog.capture("screen_attached_to_question", {
          attached_count: Math.min(attachedImages.length + 1, MAX_IMAGES),
        });
        trackEvent("screen_capture", { metadata: { source: "ask-ai" } });
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
  }, [appendImage, attachedImages.length]);

  const submitQuestion = useCallback(
    async (textOverride?: string) => {
      if (isLoading) return;
      const raw = textOverride ?? question;
      if (!raw.trim() && attachedImages.length === 0) return;

      stickToBottomRef.current = true;
      setShowScrollDown(false);

      const turnNumber = messages.length / 2 + 1;
      posthog.capture("question_asked", {
        question_length: raw.length,
        has_image: attachedImages.length > 0,
        image_count: attachedImages.length,
        chat_turn: Math.floor(turnNumber),
        is_follow_up: messages.length > 0,
      });
      trackEvent("question_asked", {
        metadata: {
          question_length: raw.length,
          has_image: attachedImages.length > 0,
          image_count: attachedImages.length,
          chat_turn: Math.floor(turnNumber),
          is_follow_up: messages.length > 0,
        },
      });

      const effectivePrompt = raw.trim() || VISION_FALLBACK_PROMPT;
      const imagesSnapshot =
        attachedImages.length > 0 ? [...attachedImages] : undefined;

      setQuestion("");
      setAttachedImages([]);
      micPrefixRef.current = "";

      await chat.send({ text: effectivePrompt, images: imagesSnapshot });
    },
    [attachedImages, chat.send, isLoading, messages.length, question],
  );

  // Mic-driven dictation. Interim transcripts live-update the question
  // input; on `stop()` (commit) we finalize and auto-submit. `cancel()`
  // (drag-off / window blur) clears the WS without submitting.
  const askMic = useAskMic({
    onTranscript: (text) => {
      setQuestion(micPrefixRef.current + text);
    },
    onFinal: (finalText) => {
      const merged = (micPrefixRef.current + finalText).trim();
      void submitQuestion(merged);
    },
  });

  // Captured at arm-time so a user who's already typed something can hold
  // the mic, dictate more, and the captured prefix is preserved.
  const onMicArm = useCallback(() => {
    micPrefixRef.current = question ? `${question} ` : "";
  }, [question]);

  // Push-to-talk: hold the mic button — or Space anywhere (Ctrl+Space
  // as an override when the textarea has content) — to record. Release
  // auto-submits. Disabled while a completion is in flight so a stray
  // hold can't kick off a duplicate request mid-stream.
  const ptt = useMicPushToTalk(askMic, {
    onArm: onMicArm,
    enableHotkey: isActive,
    disabled: isLoading,
  });

  // Declared up here (above the keydown effect) so the effect's dep
  // array can reference these without hitting a temporal-dead-zone
  // error during render.
  const handleStop = useCallback(
    (e?: React.MouseEvent<HTMLButtonElement>) => {
      // Belt + braces: prevent the click from bubbling up and triggering
      // a form submit (which would restart the request), and blur the
      // button so a subsequent Enter key press doesn't re-activate it.
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.blur();
      }
      chat.abort();
    },
    [chat.abort],
  );

  // Start a brand new conversation — clears the thread, any in-flight
  // stream, the composer text, and attached screenshots. Wired both to
  // the toolbar button and to Mod+Shift+N for keyboard discoverability.
  const handleNewChat = useCallback(() => {
    chat.reset();
    setQuestion("");
    setAttachedImages([]);
    setShowScrollDown(false);
    stickToBottomRef.current = true;
    inputRef.current?.focus();
    posthog.capture("ask_new_chat");
  }, [chat.reset]);

  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTypingInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // NOTE: Space / Ctrl+Space push-to-talk is owned by
      // `useMicPushToTalk` — do NOT re-bind it here or both handlers
      // will fire (start twice).

      if (e.key.toLowerCase() === "k" && !isTypingInInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }

      // Mod+Shift+N → new chat. Works from anywhere on the Ask AI tab,
      // including while focused in the composer textarea, because it's
      // a modified shortcut that won't collide with literal typing.
      const modKey = e.ctrlKey || e.metaKey;
      if (modKey && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewChat();
        return;
      }

      // Esc semantics, in order of priority:
      //   1. If the mic is recording (incl. tap-toggle mode) → cancel
      //      the mic without submitting. This is the ONLY way to bail
      //      out of a tap-toggle session without sending the question.
      //   2. Else if a completion is in flight → abort it (keeps any
      //      partial assistant text already streamed in).
      //   3. Else if the composer has text → clear it (lets the user
      //      bail mid-typing without sending). The chat thread itself
      //      is NEVER cleared by Esc — use New Chat (Mod+Shift+N) for
      //      that, so a stray Esc never destroys the conversation.
      if (e.key === "Escape") {
        if (askMic.isActive) {
          e.preventDefault();
          dbg("ask-ui", "Esc → cancel active mic recording");
          ptt.cancel();
        } else if (isLoading) {
          e.preventDefault();
          dbg("ask-ui", "Esc → abort in-flight completion");
          chat.abort();
        } else if (question) {
          e.preventDefault();
          setQuestion("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    askMic.isActive,
    chat.abort,
    handleNewChat,
    isActive,
    isLoading,
    ptt,
    question,
  ]);

  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isActive]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      void submitQuestion();
    },
    [submitQuestion],
  );

  const hasContent = messages.length > 0 || isLoading || !!error;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="shrink-0 app-toolbar">
        <div className="w-full max-w-3xl mx-auto px-3 pt-2.5 pb-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-accent-muted">
              <MessageSquare className="h-3 w-3 text-accent-text" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-[12px] font-semibold leading-none text-text-primary">
                Ask AI
                <span
                  className="relative flex h-1.5 w-1.5 shrink-0"
                  aria-hidden
                >
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                {messages.length > 0 && (
                  <span className="text-[10px] font-normal tabular-nums text-text-tertiary">
                    · {Math.ceil(messages.length / 2)} turn
                    {messages.length > 2 ? "s" : ""}
                  </span>
                )}
              </h2>
              {session?.user && (
                <p
                  className="mt-1 truncate text-[10px] text-text-tertiary"
                  title={sessionUserTitle(session.user)}
                >
                  {sessionDisplayName(session.user)}
                </p>
              )}
            </div>
            {/* New Chat — only shown once a thread exists so it doesn't
                clutter the empty state. Mod+Shift+N is the global
                keyboard equivalent, displayed in the tooltip below. */}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleNewChat}
                aria-label="Start a new chat"
                title={`Start a new chat (${formatShortcut(["Mod", "Shift", "N"])})`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[10px] text-text-tertiary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>New chat</span>
                <Kbd
                  keys={["Mod", "Shift", "N"]}
                  size="xs"
                  className="hidden md:inline-flex ml-0.5 text-neutral-500"
                />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {resumeText?.trim() && (
              <span className="text-[9px] text-sky-300/90 bg-sky-500/[0.08] px-2 py-0.5 rounded-full border border-sky-500/15">
                Resume attached
              </span>
            )}
            {jobDescription.trim() && (
              <span className="text-[9px] text-violet-300/90 bg-violet-500/[0.08] px-2 py-0.5 rounded-full border border-violet-500/15">
                JD attached
              </span>
            )}
            {hasNotes && !contextAttached && (
              <span className="text-[9px] text-emerald-500/60 bg-emerald-500/[0.06] px-2 py-0.5 rounded-full border border-emerald-500/10">
                Notes included
              </span>
            )}
            {!contextAttached && !hasNotes && (
              <span className="text-[9px] text-neutral-500">
                No saved context — add resume or JD in Copilot tab
              </span>
            )}
            {messages.length > 0 && (contextAttached || hasNotes) && (
              <span className="text-[9px] text-neutral-600">
                · New chat picks up latest context
              </span>
            )}
          </div>

          {/* Attached screenshots: horizontal row of thumbnails with a per-thumb
              remove button. Cap is MAX_IMAGES; the small counter on the right
              hints at the remaining slots so the cap isn't surprising. */}
          {attachedImages.length > 0 && (
            <div className="mb-1.5 flex items-center gap-2 p-1.5 rounded-lg bg-emerald-500/[0.04] border border-emerald-500/15 animate-fade-in-scale">
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
                {attachedImages.map((src, idx) => (
                  // `appendImage` dedupes by full string so the leading
                  // 48 chars of the data URL are stable + unique enough to
                  // key off of without resorting to the array index.
                  <div
                    key={src.slice(0, 48)}
                    className="relative shrink-0 group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Attached screenshot ${idx + 1}`}
                      className="w-12 h-8 object-cover rounded-md border border-[color:var(--app-border)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeImageAt(idx)}
                      aria-label={`Remove screenshot ${idx + 1}`}
                      className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[color:var(--app-surface)] border border-[color:var(--app-border)] text-neutral-300 hover:text-white hover:bg-[color:color-mix(in_oklch,var(--app-surface-elev)_90%,transparent)] opacity-80 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)]"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="shrink-0 text-[10px] font-medium text-emerald-300 flex items-center gap-1 pr-1">
                <ImageIcon className="w-3 h-3" />
                {attachedImages.length}/{MAX_IMAGES}
              </p>
            </div>
          )}

          {/* Live "listening" banner while a hold is active — gives the
              user an unambiguous "yes, the mic is on right now" signal,
              with a live audio-level meter so they can see their voice
              register even if they haven't said enough to transcribe yet.
              Critical UX: without this, a silently denied mic permission
              looks identical to "I just haven't talked yet". */}
          <AskListeningBanner askMic={askMic} ptt={ptt} density="default" />

          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle/50 bg-transparent p-1.5"
          >
            <div className="relative min-w-0 flex-1">
              <Input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  askMic.state === "recording"
                    ? "Listening… speak your question"
                    : attachedImages.length > 0
                      ? "Add a question (optional) or press Enter..."
                      : "Ask the AI anything… (K)"
                }
                disabled={isLoading}
                className={cn(
                  "h-9 border-0 bg-transparent pl-3 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  isElectron ? "pr-24" : "pr-16",
                )}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {/* Press-and-hold mic — walkie-talkie UX. Pointer down arms
                    the recording, pointer up auto-submits, drag-off / window
                    blur cancels. The same gesture is bound globally as
                    Space (Ctrl+Space override when the textarea has text)
                    by useMicPushToTalk. */}
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
                    "relative p-1.5 rounded-md transition-all flex items-center gap-1 select-none touch-none",
                    askMic.state === "recording"
                      ? ptt.isTapLocked
                        ? "text-red-300 bg-red-500/20 ring-2 ring-red-500/60 ring-offset-1 ring-offset-neutral-950 shadow-[0_0_22px_-2px] shadow-red-500/60"
                        : "text-red-300 bg-red-500/15 ring-2 ring-red-500/40 ring-offset-1 ring-offset-neutral-950 shadow-[0_0_18px_-2px] shadow-red-500/40"
                      : askMic.state === "fetching-key" ||
                          askMic.state === "connecting"
                        ? "text-emerald-300 bg-emerald-500/10 animate-pulse"
                        : "text-neutral-500 hover:text-neutral-200 hover:bg-white/5 active:bg-white/10",
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
                      activeClassName="bg-red-300"
                      inactiveClassName="bg-red-500/20"
                      className="h-3"
                    />
                  )}
                  {askMic.state === "recording" && (
                    <span className="pointer-events-none absolute inset-0 rounded-md bg-red-500/10 animate-pulse" />
                  )}
                </button>
                {isElectron && (
                  <button
                    type="button"
                    onClick={handleCaptureScreen}
                    disabled={
                      isLoading ||
                      isCapturing ||
                      attachedImages.length >= MAX_IMAGES
                    }
                    aria-label="Attach screenshot"
                    title={
                      attachedImages.length >= MAX_IMAGES
                        ? `Maximum ${MAX_IMAGES} screenshots attached`
                        : `Attach screenshot (${formatShortcut(["Mod", "Shift", "1"])})`
                    }
                    className={`p-1.5 rounded-md transition-colors ${
                      isCapturing
                        ? "text-emerald-400 animate-pulse"
                        : attachedImages.length > 0
                          ? "text-emerald-400 bg-emerald-500/10"
                          : "text-neutral-500 hover:text-neutral-200 hover:bg-white/5"
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <Kbd
                      keys={["Mod", "Shift", "1"]}
                      size="xs"
                      className="hidden xl:inline-flex ml-0.5 text-emerald-300/90"
                    />
                  </button>
                )}
                {!isLoading &&
                  (question.trim() || attachedImages.length > 0) && (
                    <Kbd keys="↵" size="xs" className="text-neutral-600" />
                  )}
              </div>
            </div>
            <Button
              type={isLoading ? "button" : "submit"}
              disabled={
                !isLoading && !question.trim() && attachedImages.length === 0
              }
              onClick={isLoading ? handleStop : undefined}
              title={isLoading ? "Stop (Esc)" : "Ask (Enter)"}
              className={cn(
                "h-9 shrink-0 px-3 text-xs",
                isLoading && "bg-destructive hover:bg-destructive/90",
              )}
              variant={isLoading ? "destructive" : "default"}
            >
              {isLoading ? (
                <span className="flex items-center gap-1">
                  <Square className="w-3 h-3" />
                  Stop
                  <Kbd keys="Esc" size="xs" className="text-white/80 ml-0.5" />
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Ask
                </span>
              )}
            </Button>
          </form>

          {/* Mic-specific surface error (separate from generic completion errors). */}
          {askMic.error && (
            <p className="mt-2 text-[11px] text-red-300/90">{askMic.error}</p>
          )}

          {/* Debug HUD — auto-visible in dev / `?askmic_debug=1`. Lets the
              user (and us) see exactly which stage of the mic pipeline is
              broken: chunks flowing? events arriving? captioning anything?
              This is the answer to "I speak and nothing appears" — the
              counters tell you immediately whether the bug is mic, WS, or
              Deepgram. */}
          <AskMicDebugHud
            state={askMic.state}
            level={askMic.level}
            stats={askMic.stats}
            error={askMic.error}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto custom-scrollbar"
        >
          <div className="w-full max-w-3xl mx-auto px-3 py-3 pb-8">
            {error && (
              <div
                className={`mb-2 p-2 text-xs text-destructive animate-fade-in-scale ${overlayErrorBlock}`}
              >
                {error}
              </div>
            )}

            {/* Conversation thread. Each user/assistant pair is rendered
                as a bubble; the pending assistant bubble at the tail
                shows a typing indicator until tokens arrive, then a
                blinking caret while text streams. */}
            {messages.length > 0 && (
              <ChatThread
                messages={messages}
                density="compact"
                userLabel={
                  session?.user ? sessionDisplayName(session.user) : undefined
                }
              />
            )}

            {!hasContent && (
              <div className="flex flex-col items-center text-center pt-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                  {[
                    "Tell me about yourself",
                    "Why this company?",
                    "Describe a challenge you overcame",
                    "What are your strengths?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setQuestion(suggestion)}
                      className={`rounded-md border border-border-subtle/50 p-2 text-left text-[11px] text-text-secondary transition-colors hover:text-text-primary ${overlayInput} ${overlayTextShadow}`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-neutral-500 mt-2">
                  <span className="inline-flex items-center gap-1">
                    <Kbd keys="Space" size="xs" />
                    <span className="text-[10px]">tap or hold to talk</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd keys="K" size="xs" />
                    <span className="text-[10px]">focus</span>
                  </span>
                  {isElectron && (
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys={["Mod", "Shift", "1"]} size="xs" />
                      <span className="text-[10px]">attach screen</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Kbd keys="↵" size="xs" />
                    <span className="text-[10px]">send</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd keys="Esc" size="xs" />
                    <span className="text-[10px]">stop</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd keys={["Mod", "Shift", "N"]} size="xs" />
                    <span className="text-[10px]">new chat</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {showScrollDown && (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Scroll to latest"
            className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-[11px] backdrop-blur-md shadow-lg hover:bg-emerald-500/25 transition-colors animate-fade-in-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)]"
          >
            <ArrowDown className="w-3 h-3" />
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
