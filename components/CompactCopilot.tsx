"use client";

import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAskScreenshotBridge } from "@/components/ask/useAskScreenshotBridge";
import { useAskKeyboard } from "@/components/ask/useAskKeyboard";
import { useTranscription } from "@/components/TranscriptionContext";
import { useAskChat } from "@/hooks/useAskChat";
import { useAskMic } from "@/hooks/useAskMic";
import { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { dbg } from "@/lib/debug";
import { FLAGS, type HistoryData } from "@/lib/types";
import { isVisionScreenshotDataUrl } from "@/lib/vision-screenshot";
import { AskDrawer } from "./compact/AskDrawer";
import { CompactContextDrawer } from "./compact/CompactContextDrawer";
import { CompactToolbar } from "./compact/CompactToolbar";
import { OutputPanel } from "./compact/OutputPanel";
import { STORAGE_KEYS, writeSession } from "./compact/storage";
import { useCompactGenerate } from "./compact/useCompactGenerate";
import {
  useCompletionState,
  useLastFlag,
  useOutputMode,
} from "./compact/useCompactSession";
import { authClient } from "@/lib/auth-client";
import { sessionDisplayName } from "@/lib/session-display";

// Hard cap on attached screenshots — mirrors MAX_IMAGES in QuestionAssistant
// and MAX_IMAGES_PER_REQUEST on the worker. Keeps payload bounded and the UX
// consistent between the full Ask AI tab and this compact drawer.
const MAX_IMAGES = 4;

// Background / system instructions for the Ask AI chat. Mirrors the
// QuestionAssistant surface so behaviour matches whichever surface the
// user is on. The bg field is appended only to the FIRST user turn by
// the worker, so it doesn't grow the prompt as the conversation goes on.
const ASK_AI_BACKGROUND =
  "You are a professional interview coach. Provide detailed, comprehensive, interview-ready answers. When the user follows up with a clarifying question, treat it as a continuation of the same conversation and reference your earlier answers when relevant.";

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
  // Completion is per-surface and reflects the LAST single-shot output
  // (Copilot transcript-driven or Summarizer). Persisted across compact
  // remounts so the user doesn't lose the answer when toggling to full
  // mode. The Ask AI chat lives separately in `chat.messages`.
  const [completion, setCompletion] = useCompletionState();
  // Which output surface to render in the bottom panel:
  //   - "transcript" → the single `completion` blob (Copilot / Summarizer)
  //   - "chat"       → the multi-turn `chat.messages` thread (Ask AI)
  // Persisted so a reload restores the right view.
  const [outputMode, setOutputMode] = useOutputMode();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeFlag, setActiveFlag] = useState<FLAGS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState<boolean>(false);
  const [outputCollapsed, setOutputCollapsed] = useState<boolean>(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const { data: session } = authClient.useSession();
  const askInputRef = useRef<HTMLInputElement | null>(null);
  const askFormRef = useRef<HTMLFormElement | null>(null);

  const bgHydratedRef = useRef(false);

  // Captured prefix for mic dictation — see QuestionAssistant for rationale.
  const micPrefixRef = useRef<string>("");

  const appendImage = useCallback((dataUrl: string) => {
    setAttachedImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      if (prev.includes(dataUrl)) return prev;
      return [...prev, dataUrl];
    });
  }, []);

  const removeImageAt = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachedImages = useCallback(() => setAttachedImages([]), []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
    }
  }, []);

  // Match full Ask AI panel: ⌘⇧1 / Ctrl+Shift+1 dispatches globally; compact
  // mode has no QuestionAssistant mounted, so we attach here. Each press
  // appends another screenshot (up to MAX_IMAGES). The compact surface
  // also opens the Ask drawer so the just-attached thumbnail is visible.
  useAskScreenshotBridge({
    appendImage,
    inputRef: askInputRef,
    onAttach: () => setAskMode(true),
  });

  // Multi-turn Ask AI chat. The hook persists messages to sessionStorage
  // under the key passed in, so toggling compact ↔ full mode keeps the
  // conversation visible (matches the existing `completion` UX for the
  // transcript-driven flows). Distinct from `completion` so a Copilot/
  // Summarizer run doesn't blow away the chat thread.
  const chat = useAskChat({
    storageKey: STORAGE_KEYS.chatMessages,
    background: ASK_AI_BACKGROUND,
    sendCap: 16,
  });

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

  const {
    generate,
    abort: abortGeneration,
    controllerRef: generateControllerRef,
  } = useCompactGenerate({
    bg,
    transcribedText,
    attachedImages,
    isLoading,
    setError,
    setCompletion,
    setIsLoading,
    setActiveFlag,
    setOutputCollapsed,
    setOutputMode,
  });

  const stop = abortGeneration;

  const handleCaptureScreen = useCallback(async () => {
    if (!window.electronAPI?.screen) return;
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
        setAskMode(true);
        posthog.capture("screen_attached_to_question", {
          surface: "compact",
          attached_count: Math.min(attachedImages.length + 1, MAX_IMAGES),
        });
        setTimeout(() => askInputRef.current?.focus(), 50);
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

  // Abort any in-flight completion stream when the surface unmounts (user
  // toggles compact off / closes the app). Without this, the SSE reader
  // would keep running and try to setCompletion on an unmounted tree.
  useEffect(() => {
    return () => {
      if (generateControllerRef.current) {
        generateControllerRef.current.abort();
        generateControllerRef.current = null;
      }
    };
  }, [generateControllerRef]);

  // Mic dictation for the compact Ask AI drawer. Mirrors QuestionAssistant:
  // interim transcripts live-fill the input, stop auto-submits, cancel
  // (drag-off) just drops the recording.
  const askMic = useAskMic({
    onTranscript: (text) => {
      setAskInput(micPrefixRef.current + text);
    },
    onFinal: (finalText) => {
      const merged = (micPrefixRef.current + finalText).trim();
      setAskInput(merged);
      if (!merged && attachedImages.length === 0) return;
      // Auto-submit on next tick so React commits setAskInput first.
      setTimeout(() => {
        askFormRef.current?.requestSubmit();
      }, 0);
    },
  });

  // Captured at arm-time so a user who's already typed something can hold
  // the mic and dictate an addition (the typed prefix is preserved).
  // Also opens the drawer + focuses the input so the live transcript
  // appears in front of the user as they speak.
  const onMicArm = useCallback(() => {
    if (!askMode) setAskMode(true);
    micPrefixRef.current = askInput ? `${askInput} ` : "";
    setTimeout(() => askInputRef.current?.focus(), 50);
  }, [askInput, askMode]);

  // Push-to-talk: hold the mic button — or Space anywhere (Ctrl+Space
  // as an override when the input has content) — to record. Release
  // auto-submits. Disabled mid-completion so a stray hold can't race a
  // duplicate request. The global hotkey is always on for this surface
  // so the user can dictate without first opening the Ask drawer.
  const ptt = useMicPushToTalk(askMic, {
    onArm: onMicArm,
    enableHotkey: true,
    disabled: isLoading,
  });

  const toggleAskDrawer = useCallback(() => {
    if (askMode) {
      clearAttachedImages();
      setAskMode(false);
    } else {
      setAskMode(true);
      setTimeout(() => askInputRef.current?.focus(), 50);
    }
  }, [askMode, clearAttachedImages]);

  useAskKeyboard({
    enabled: true,
    isMicActive: askMic.isActive,
    isChatStreaming: chat.isStreaming,
    onMicCancel: () => ptt.cancel(),
    onChatAbort: () => chat.abort(),
    onNewChat: () => {
      chat.reset();
      setAskInput("");
      clearAttachedImages();
      setOutputMode("chat");
      setAskMode(true);
    },
    onEscapeFallback: () => {
      if (isLoading && generateControllerRef.current) {
        abortGeneration();
        return true;
      }
      const target = document.activeElement as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isTypingInInput =
        tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;
      if (askMode && !isTypingInInput) {
        setAskMode(false);
        return true;
      }
      return false;
    },
  });

  // Compact-only shortcuts: Mod+Enter / Mod+Shift+Enter (Copilot/Summarize)
  // and Alt+A (toggle Ask drawer). Mod+Shift+N and Esc live in useAskKeyboard.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modKey = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isTypingInInput =
        tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;

      if (modKey && (e.key === "Enter" || e.key === "Return")) {
        // Let the Ask drawer handle Enter / Mod+Enter for chat submit.
        if (isTypingInInput) return;
        if (!transcribedText.trim()) return;
        const wantSummarize = e.shiftKey;
        const wantFlag = wantSummarize ? FLAGS.SUMMARIZER : FLAGS.COPILOT;
        if (isLoading) {
          if (activeFlag === wantFlag) {
            e.preventDefault();
            dbg("ask-ui", "Mod+Enter while streaming → stop");
            abortGeneration();
          }
          return;
        }
        e.preventDefault();
        dbg(
          "ask-ui",
          wantSummarize
            ? "Mod+Shift+Enter → Summarize"
            : "Mod+Enter → Ask (Copilot)",
        );
        void generate(wantFlag);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyA") {
        e.preventDefault();
        dbg("ask-ui", "Alt+A → toggle Ask AI drawer");
        toggleAskDrawer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    abortGeneration,
    activeFlag,
    generate,
    isLoading,
    toggleAskDrawer,
    transcribedText,
  ]);

  const lastFlagRef = useLastFlag(activeFlag);

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
  }, [addInSavedData, completion, lastFlagRef]);

  const clearAll = useCallback(() => {
    clearTranscription();
    setCompletion("");
    setError(null);
    chat.reset();
    setOutputMode("transcript");
    writeSession(STORAGE_KEYS.completion, "");
  }, [chat.reset, clearTranscription, setCompletion, setOutputMode]);

  // hasOutput drives both the visibility of the output panel and the
  // parent's "needs expanded window" signal. We treat ANY pending state
  // (single-shot loading or chat streaming) and ANY actual content
  // (completion text, chat messages, or surfaced error) as output.
  const hasOutput =
    completion.length > 0 ||
    chat.messages.length > 0 ||
    isLoading ||
    chat.isStreaming ||
    error !== null ||
    chat.error !== null;
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
      <CompactToolbar
        askMic={askMic}
        ptt={ptt}
        isLoading={isLoading}
        activeFlag={activeFlag}
        transcribedText={transcribedText}
        attachedImages={attachedImages}
        maxImages={MAX_IMAGES}
        isElectron={isElectron}
        isCapturing={isCapturing}
        askMode={askMode}
        showContext={showContext}
        hasOutput={hasOutput}
        outputCollapsed={outputCollapsed}
        completion={completion}
        onGenerate={(f) => void generate(f)}
        onStop={stop}
        onCaptureScreen={() => void handleCaptureScreen()}
        onToggleAskMode={toggleAskDrawer}
        onToggleContext={() => setShowContext((s) => !s)}
        onToggleOutputCollapsed={() => setOutputCollapsed((c) => !c)}
        onSave={handleSave}
        onClearTranscription={clearTranscription}
        onClearAll={clearAll}
        onExitCompact={onExitCompact}
      />

      {showContext && <CompactContextDrawer bg={bg} onChange={setBg} />}

      {askMode && (
        <AskDrawer
          askInput={askInput}
          setAskInput={setAskInput}
          askInputRef={askInputRef}
          askFormRef={askFormRef}
          attachedImages={attachedImages}
          removeImageAt={removeImageAt}
          clearAttachedImages={clearAttachedImages}
          maxImages={MAX_IMAGES}
          chat={chat}
          askMic={askMic}
          ptt={ptt}
          isLoading={isLoading}
          isCapturing={isCapturing}
          isElectron={isElectron}
          onCaptureScreen={() => void handleCaptureScreen()}
          setOutputMode={setOutputMode}
          setOutputCollapsed={setOutputCollapsed}
        />
      )}

      {hasVisibleOutput && (
        <OutputPanel
          outputMode={outputMode}
          chatMessages={chat.messages}
          chatError={chat.error}
          chatIsStreaming={chat.isStreaming}
          completion={completion}
          error={error}
          activeFlag={activeFlag}
          chatUserLabel={
            session?.user ? sessionDisplayName(session.user) : undefined
          }
          onDismissError={() => {
            // Clear both error surfaces so a stale banner doesn't hover
            // over a fresh, successful chat thread. `chat.clearError`
            // wipes just the transport error without touching the
            // conversation; `setError(null)` clears the local capture
            // failure store.
            dbg("ask-ui", "Dismiss error banner (compact)");
            setError(null);
            chat.clearError();
          }}
        />
      )}
    </div>
  );
}

export default CompactCopilot;
