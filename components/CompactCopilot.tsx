"use client";

import posthog from "posthog-js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAskScreenshotBridge } from "@/components/ask/useAskScreenshotBridge";
import { useAskKeyboard } from "@/components/ask/useAskKeyboard";
import { useTranscription } from "@/components/TranscriptionContext";
import { useSharedAskChat } from "@/components/AskChatProvider";
import { useCopilotSession } from "@/components/CopilotSessionProvider";
import { useAskMic } from "@/hooks/useAskMic";
import { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { dbg } from "@/lib/debug";
import { FLAGS, type HistoryData } from "@/lib/types";
import {
  isVisionScreenshotDataUrl,
  VISION_FALLBACK_PROMPT,
} from "@/lib/vision-screenshot";
import { CompactAskComposer } from "./compact/CompactAskComposer";
import { CompactContextDrawer } from "./compact/CompactContextDrawer";
import { CompactLiveTranscript } from "./compact/CompactLiveTranscript";
import { CompactToolbar } from "./compact/CompactToolbar";
import { OutputPanel } from "./compact/OutputPanel";
import { useCompactGenerate } from "./compact/useCompactGenerate";
import {
  resolveCompactHeight,
  type CompactLayoutState,
} from "@/hooks/useCompactWindowSize";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { authClient } from "@/lib/auth-client";
import { buildContextBlock, hasAttachedContext } from "@/lib/prompt-context";
import { sessionDisplayName } from "@/lib/session-display";

// Hard cap on attached screenshots — mirrors MAX_IMAGES in QuestionAssistant
// and MAX_IMAGES_PER_REQUEST on the worker. Keeps payload bounded and the UX
// consistent between the full Ask AI tab and this compact drawer.
const MAX_IMAGES = 4;

interface CompactCopilotProps {
  addInSavedData: (data: HistoryData) => void;
  onExitCompact?: () => void;
  onCompactHeightChange?: (height: number) => void;
}

export function CompactCopilot({
  addInSavedData,
  onExitCompact,
  onCompactHeightChange,
}: CompactCopilotProps) {
  const { interviewNotes, resumeText, jobDescription, setInterviewNotes } =
    useInterviewContext();
  const { transcribedText, clearTranscription } = useTranscription();
  const {
    completion,
    setCompletion,
    flag: sessionFlag,
    setFlag: setSessionFlag,
    outputMode,
    setOutputMode,
  } = useCopilotSession();
  const [askMode, setAskMode] = useState<boolean>(false);
  const [askInput, setAskInput] = useState<string>("");
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

  const effectiveBg = buildContextBlock({
    existingBg: interviewNotes,
    resumeText,
    jobDescription,
  });

  const contextAttached = hasAttachedContext({
    resumeText,
    jobDescription,
  });

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
  const chat = useSharedAskChat();

  const syncActiveFlag = useCallback(
    (f: FLAGS | null) => {
      setActiveFlag(f);
      if (f !== null) setSessionFlag(f);
    },
    [setSessionFlag],
  );

  const {
    generate,
    abort: abortGeneration,
    controllerRef: generateControllerRef,
  } = useCompactGenerate({
    bg: effectiveBg,
    transcribedText,
    attachedImages,
    isLoading,
    setError,
    setCompletion,
    setIsLoading,
    setActiveFlag: syncActiveFlag,
    setOutputCollapsed,
    setOutputMode,
  });

  const stop = abortGeneration;

  const handleGenerate = useCallback(
    (flag: FLAGS) => {
      setAskMode(false);
      void generate(flag);
    },
    [generate],
  );

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

  const submitAskInput = useCallback(
    async (textOverride?: string) => {
      if (isLoading) return;
      if (chat.isStreaming) return;
      const raw = textOverride ?? askInput;
      if (!raw.trim() && attachedImages.length === 0) return;

      const text = raw.trim() || VISION_FALLBACK_PROMPT;
      const imagesSnapshot =
        attachedImages.length > 0 ? [...attachedImages] : undefined;

      setOutputMode("chat");
      setOutputCollapsed(false);
      setAskInput("");
      clearAttachedImages();
      micPrefixRef.current = "";
      posthog.capture("question_asked", {
        question_length: text.length,
        has_image: !!imagesSnapshot,
        image_count: imagesSnapshot?.length ?? 0,
        surface: "compact",
        chat_turn: Math.floor(chat.messages.length / 2) + 1,
        is_follow_up: chat.messages.length > 0,
      });
      void chat.send({ text, images: imagesSnapshot });
    },
    [
      askInput,
      attachedImages,
      chat.isStreaming,
      chat.messages.length,
      chat.send,
      clearAttachedImages,
      isLoading,
      setOutputCollapsed,
      setOutputMode,
    ],
  );

  // Mic dictation for the compact Ask AI drawer. Mirrors QuestionAssistant:
  // interim transcripts live-fill the input, stop auto-submits, cancel
  // (drag-off) just drops the recording.
  const askMic = useAskMic({
    onTranscript: (text) => {
      setAskInput(micPrefixRef.current + text);
    },
    onFinal: (finalText) => {
      const merged = (micPrefixRef.current + finalText).trim();
      void submitAskInput(merged);
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

  const toggleAskComposer = useCallback(() => {
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
        void handleGenerate(wantFlag);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyA") {
        e.preventDefault();
        dbg("ask-ui", "Alt+A → toggle Ask input");
        toggleAskComposer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    abortGeneration,
    activeFlag,
    handleGenerate,
    isLoading,
    toggleAskComposer,
    transcribedText,
  ]);

  const handleSave = useCallback(() => {
    if (!completion.trim()) return;
    const modeFlag = activeFlag ?? sessionFlag;
    const tag = modeFlag === FLAGS.SUMMARIZER ? "Summarizer" : "Copilot";
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
  }, [activeFlag, addInSavedData, completion, sessionFlag]);

  const clearAll = useCallback(() => {
    clearTranscription();
    setCompletion("");
    setError(null);
    chat.reset();
    setOutputMode("transcript");
    setSessionFlag(FLAGS.COPILOT);
  }, [chat, clearTranscription, setCompletion, setOutputMode, setSessionFlag]);

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

  const showLiveTranscript =
    transcribedText.trim().length > 0 &&
    !askMode &&
    !hasVisibleOutput &&
    !showContext;

  const compactLayout: CompactLayoutState = {
    showContext,
    askMode,
    hasVisibleOutput,
    hasTranscript: showLiveTranscript,
    hasAttachedImages: attachedImages.length > 0,
  };
  const compactHeight = resolveCompactHeight(compactLayout);

  useLayoutEffect(() => {
    onCompactHeightChange?.(compactHeight);
  }, [compactHeight, onCompactHeightChange]);

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
        hasContextAttached={contextAttached}
        hasOutput={hasOutput}
        outputCollapsed={outputCollapsed}
        completion={completion}
        onGenerate={(f) => handleGenerate(f)}
        onStop={stop}
        onCaptureScreen={() => void handleCaptureScreen()}
        onToggleAskMode={toggleAskComposer}
        onToggleContext={() => setShowContext((s) => !s)}
        onToggleOutputCollapsed={() => setOutputCollapsed((c) => !c)}
        onSave={handleSave}
        onClearTranscription={clearTranscription}
        onClearAll={clearAll}
        onExitCompact={onExitCompact}
      />

      {showLiveTranscript && <CompactLiveTranscript text={transcribedText} />}

      {showContext && (
        <CompactContextDrawer
          bg={interviewNotes}
          onChange={setInterviewNotes}
          hasSavedResumeOrJd={contextAttached}
        />
      )}

      {askMode && (
        <CompactAskComposer
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
          setOutputMode={setOutputMode}
          setOutputCollapsed={setOutputCollapsed}
          submitAskInput={submitAskInput}
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
