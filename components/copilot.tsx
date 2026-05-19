"use client";

import dynamic from "next/dynamic";
import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextCard } from "@/components/copilot/ContextCard";
import { OutputCard } from "@/components/copilot/OutputCard";
import { TranscriptionCard } from "@/components/copilot/TranscriptionCard";
import { useTranscription } from "@/components/TranscriptionContext";
import { useClientReady } from "@/hooks/useClientReady";
import { useCopilotSubmit } from "@/hooks/useCopilotSubmit";
import { authClient } from "@/lib/auth-client";
import { trackEvent } from "@/lib/session-tracking";
import { FLAGS, type HistoryData } from "@/lib/types";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => <RecorderFallback />,
});

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
  isActive?: boolean;
  presetContext?: string;
}

export function Copilot({
  addInSavedData,
  isActive = false,
  presetContext = "",
}: CopilotProps) {
  const isClientReady = useClientReady();
  const { data: session } = authClient.useSession();
  // Transcription state lives in TranscriptionProvider so it survives
  // toggling between full Copilot and the compact toolbar without
  // tearing down the live recording session.
  const { transcribedText, transcriptionSegments, clearTranscription } =
    useTranscription();
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");
  const transcriptionBoxRef = useRef<HTMLDivElement>(null);

  const { completion, isLoading, error, submit, stop } = useCopilotSubmit({
    flag,
    bg,
    transcribedText,
  });

  useEffect(() => {
    if (transcriptionBoxRef.current) {
      transcriptionBoxRef.current.scrollTop =
        transcriptionBoxRef.current.scrollHeight;
    }
  }, [transcriptionSegments]);

  // Preset context (from the active preset) always wins over the cached
  // value. Hydration below only runs once on mount, so we flip this flag to
  // skip the storage read whenever the preset already provided context.
  const bgHydratedRef = useRef(false);
  useEffect(() => {
    if (presetContext) {
      setBg(presetContext);
      bgHydratedRef.current = true;
    }
  }, [presetContext]);

  const handleFlag = useCallback((checked: boolean) => {
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
  }, []);

  const formRef = useRef<HTMLFormElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const isTypingInInput =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    switch (event.key.toLowerCase()) {
      case "enter":
        if (!isTypingInInput) {
          event.preventDefault();
          if (formRef.current) {
            const submitEvent = new Event("submit", {
              cancelable: true,
              bubbles: true,
            });
            formRef.current.dispatchEvent(submitEvent);
          }
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
  }, []);

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown, isActive]);

  // Background context can include resume / JD / PII. Keep it in
  // sessionStorage so it's cleared when the tab closes rather than surviving
  // indefinitely in localStorage. Also skip hydration if the preset already
  // populated the field.
  useEffect(() => {
    if (bgHydratedRef.current) return;
    try {
      const savedBg = sessionStorage.getItem("bg");
      if (savedBg) setBg(savedBg);
    } catch {
      // sessionStorage unavailable (e.g. disabled storage)
    }
    bgHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!bg) return;
    try {
      sessionStorage.setItem("bg", bg);
    } catch {
      // Quota or unavailable — non-fatal.
    }
  }, [bg]);

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
    if (!isActive) return;
    if (typeof window !== "undefined" && window.electronAPI && session) {
      window.electronAPI.windowSetSize(1180, 640);
    }
  }, [session, isActive]);

  if (!isClientReady) {
    return <CopilotSkeleton />;
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 overflow-hidden">
      {error && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 px-4 py-2 text-center text-xs bg-red-600/95 text-white z-[60] animate-fade-in-scale rounded-xl border border-red-500/35 shadow-xl max-w-md">
          {error.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 h-[280px] shrink-0">
        <ContextCard
          bg={bg}
          onBgChange={setBg}
          presetContext={presetContext}
          recorder={<RecorderTranscriber />}
          formRef={formRef}
          flag={flag}
          isLoading={isLoading}
          onFlagChange={handleFlag}
          onSubmit={submit}
          onStop={stop}
        />
        <TranscriptionCard
          transcriptionBoxRef={transcriptionBoxRef}
          segments={transcriptionSegments}
          onClear={clearTranscription}
        />
      </div>

      <OutputCard completion={completion} onSave={handleSave} />
    </div>
  );
}

function CopilotSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass-card p-5 space-y-3">
          <div className="h-3 w-28 bg-white/[0.04] rounded-md" />
          <div className="h-[120px] bg-white/[0.03] rounded-xl" />
          <div className="h-9 bg-white/[0.03] rounded-xl" />
        </div>
        <div className="glass-card p-5 space-y-3">
          <div className="h-3 w-32 bg-white/[0.04] rounded-md" />
          <div className="h-[160px] bg-white/[0.03] rounded-xl" />
        </div>
      </div>
      <div className="glass-card p-6 h-40">
        <div className="h-3 w-48 bg-white/[0.04] rounded-md mx-auto" />
      </div>
    </div>
  );
}

function RecorderFallback() {
  return (
    <div className="flex h-9 items-center justify-center rounded-xl border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_70%,transparent)] text-xs text-[color:var(--app-muted)]">
      Initializing recorder...
    </div>
  );
}
