"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ContextCard } from "@/components/copilot/ContextCard";
import { OutputCard } from "@/components/copilot/OutputCard";
import { TranscriptionCard } from "@/components/copilot/TranscriptionCard";
import { AlertBanner } from "@/components/shell/AlertBanner";
import { useTranscription } from "@/components/TranscriptionContext";
import { useClientReady } from "@/hooks/useClientReady";
import { useCopilotSubmit } from "@/hooks/useCopilotSubmit";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useCopilotSession } from "@/components/CopilotSessionProvider";
import { useTab } from "@/components/TabContext";
import { authClient } from "@/lib/auth-client";
import { buildContextBlock } from "@/lib/prompt-context";
import { trackEvent } from "@/lib/session-tracking";
import { FLAGS, type HistoryData } from "@/lib/types";

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
  isActive?: boolean;
}

export function Copilot({ addInSavedData, isActive = false }: CopilotProps) {
  const isClientReady = useClientReady();
  const { data: session } = authClient.useSession();
  const { compactMode } = useTab();
  const {
    interviewNotes,
    resumeText,
    resumeFileName,
    jobDescription,
    setInterviewNotes,
    setJobDescription,
    setResumeParsed,
    clearResume,
    isLoading: contextLoading,
    isSaving,
    error: contextError,
  } = useInterviewContext();

  const { transcribedText, transcriptionSegments, clearTranscription } =
    useTranscription();
  const { flag, setFlag } = useCopilotSession();
  const transcriptionBoxRef = useRef<HTMLDivElement>(null);

  const effectiveBg = useMemo(
    () =>
      buildContextBlock({
        existingBg: interviewNotes,
        resumeText,
        jobDescription,
      }),
    [interviewNotes, resumeText, jobDescription],
  );

  const {
    completion,
    isLoading,
    error,
    submit,
    stop,
    regenerate,
    canRegenerate,
  } = useCopilotSubmit({
    flag,
    bg: effectiveBg,
    transcribedText,
  });

  useEffect(() => {
    if (transcriptionBoxRef.current) {
      transcriptionBoxRef.current.scrollTop =
        transcriptionBoxRef.current.scrollHeight;
    }
  }, [transcriptionSegments]);

  const handleFlag = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setFlag(FLAGS.SUMMARIZER);
        sendGTMEvent({ event: "switch_mode", mode: "summarizer" });
        posthog.capture("mode_switched", {
          mode: "summarizer",
          previous_mode: "copilot",
        });
        trackEvent("mode_switched", {
          metadata: { mode: "summarizer", previous_mode: "copilot" },
        });
      } else {
        setFlag(FLAGS.COPILOT);
        sendGTMEvent({ event: "switch_mode", mode: "copilot" });
        posthog.capture("mode_switched", {
          mode: "copilot",
          previous_mode: "summarizer",
        });
        trackEvent("mode_switched", {
          metadata: { mode: "copilot", previous_mode: "summarizer" },
        });
      }
    },
    [setFlag],
  );

  const formRef = useRef<HTMLFormElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTypingInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      switch (event.key.toLowerCase()) {
        case "enter":
          if (!isTypingInInput) {
            event.preventDefault();
            formRef.current?.dispatchEvent(
              new Event("submit", { cancelable: true, bubbles: true }),
            );
          }
          break;
        case "s":
          if (!isTypingInInput) {
            event.preventDefault();
            setFlag(FLAGS.SUMMARIZER);
          }
          break;
        case "c":
          if (!isTypingInInput) {
            event.preventDefault();
            setFlag(FLAGS.COPILOT);
          }
          break;
      }
    },
    [setFlag],
  );

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, isActive]);

  const handleSave = () => {
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summarizer",
    });
    sendGTMEvent({
      event: "save_completion",
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summarizer",
    });
    posthog.capture("completion_saved", {
      mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
      completion_length: completion.length,
    });
    trackEvent("completion_saved", {
      metadata: {
        mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
        completion_length: completion.length,
      },
    });
  };

  useEffect(() => {
    if (!isActive || compactMode) return;
    if (typeof window !== "undefined" && window.electronAPI && session) {
      window.electronAPI.windowSetSize(1180, 640);
    }
  }, [session, isActive, compactMode]);

  if (!isClientReady) {
    return <CopilotSkeleton />;
  }

  const displayError = error ?? (contextError ? new Error(contextError) : null);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      {displayError && (
        <AlertBanner
          message={displayError.message}
          className="fixed left-1/2 top-12 z-[60] max-w-md -translate-x-1/2 rounded-md animate-fade-in-scale"
          action={
            canRegenerate && error ? (
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void regenerate()}
              >
                Retry
              </button>
            ) : undefined
          }
        />
      )}

      <ContextCard
        interviewNotes={interviewNotes}
        onInterviewNotesChange={setInterviewNotes}
        resumeText={resumeText}
        resumeFileName={resumeFileName}
        jobDescription={jobDescription}
        onJobDescriptionChange={setJobDescription}
        onResumeParsed={setResumeParsed}
        onClearResume={clearResume}
        isSaving={isSaving}
        isLoading={contextLoading}
        formRef={formRef}
        flag={flag}
        isLoadingGenerate={isLoading}
        onFlagChange={handleFlag}
        onSubmit={submit}
        onStop={stop}
      />

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-lg border border-border-subtle/40 bg-transparent md:flex-row">
        <div className="flex min-h-[200px] min-w-0 flex-1 flex-col border-border-subtle/40 md:max-w-[45%] md:border-r">
          <TranscriptionCard
            transcriptionBoxRef={transcriptionBoxRef}
            segments={transcriptionSegments}
            onClear={clearTranscription}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <OutputCard completion={completion} onSave={handleSave} />
        </div>
      </div>
    </div>
  );
}

function CopilotSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <div className="surface-panel h-24 animate-skeleton" />
      <div className="mt-3 flex min-h-[320px] gap-0 overflow-hidden rounded-lg border border-border-subtle/40 bg-transparent">
        <div className="min-h-0 flex-1 border-r border-border-subtle/40 p-4">
          <div className="mb-3 h-3 w-32 animate-skeleton rounded" />
          <div className="h-full min-h-[200px] animate-skeleton rounded-md" />
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="mb-3 h-3 w-20 animate-skeleton rounded" />
          <div className="h-full min-h-[200px] animate-skeleton rounded-md" />
        </div>
      </div>
    </div>
  );
}
