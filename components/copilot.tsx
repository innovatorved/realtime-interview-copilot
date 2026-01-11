"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { FLAGS, HistoryData, TranscriptionSegment } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import { useClientReady } from "@/hooks/useClientReady";
import { BACKEND_API_URL } from "@/lib/constant";
import { authClient } from "@/lib/auth-client";
import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => <RecorderFallback />,
});

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
  isActive?: boolean;
}

export function Copilot({ addInSavedData, isActive = false }: CopilotProps) {
  const isClientReady = useClientReady();
  const { data: session } = authClient.useSession();
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [transcriptionSegments, setTranscriptionSegments] = useState<
    TranscriptionSegment[]
  >([]);
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");
  const [completion, setCompletion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const transcriptionBoxRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcription box to bottom
  useEffect(() => {
    if (transcriptionBoxRef.current) {
      transcriptionBoxRef.current.scrollTop =
        transcriptionBoxRef.current.scrollHeight;
    }
  }, [transcriptionSegments]);

  const handleFlag = useCallback((checked: boolean) => {
    if (!checked) {
      setFlag(FLAGS.SUMMERIZER);
      sendGTMEvent({ event: "switch_mode", mode: "summerizer" });
      // Capture mode switch with PostHog
      posthog.capture("mode_switched", {
        mode: "summarizer",
        previous_mode: "copilot",
      });
    } else {
      setFlag(FLAGS.COPILOT);
      sendGTMEvent({ event: "switch_mode", mode: "copilot" });
      // Capture mode switch with PostHog
      posthog.capture("mode_switched", {
        mode: "copilot",
        previous_mode: "summarizer",
      });
    }
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Check if user is typing in an input or textarea
    const target = event.target as HTMLElement;
    const isTypingInInput =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    switch (event.key.toLowerCase()) {
      case "enter":
        // Only trigger global Enter if NOT in an input/textarea
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
          setFlag(FLAGS.SUMMERIZER);
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

  const addTextinTranscription = (text: string) => {
    setTranscribedText((prev) => prev + " " + text);
  };

  const addTranscriptionSegment = (segment: TranscriptionSegment) => {
    setTranscriptionSegments((prev) => {
      // Check if this is an update to an existing interim segment or a new final segment
      const existingIndex = prev.findIndex((s) => s.id === segment.id);
      if (existingIndex !== -1) {
        // Update existing segment
        const updated = [...prev];
        updated[existingIndex] = segment;
        return updated;
      }
      // Add new segment
      return [...prev, segment];
    });
  };

  const clearTranscriptionChange = () => {
    setTranscribedText("");
    setTranscriptionSegments([]);
  };

  const stop = () => {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Clear any previous state
    setError(null);
    setCompletion("");
    setIsLoading(true);

    // Create a new AbortController for this request
    if (controller.current) controller.current.abort();
    controller.current = new AbortController();

    sendGTMEvent({ event: "generate_completion", flag: flag });
    // Capture completion generation request with PostHog
    posthog.capture("completion_generated", {
      mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
      has_context: bg.length > 0,
      transcription_length: transcribedText.length,
    });

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bg,
          flag,
          prompt: transcribedText,
        }),
        signal: controller.current.signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is null");
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode the stream chunk
        const chunk = decoder.decode(value, { stream: true });

        // Process Server-Sent Events
        const eventStrings = chunk.split("\n\n");
        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;

          // Extract the data part of the SSE
          const dataMatch = eventString.match(/data: (.*)/);
          if (!dataMatch) continue;

          const data = dataMatch[1];
          if (data === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.text) {
              setCompletion((text) => text + parsed.text);
            }
          } catch (err) {
            console.error("Error parsing SSE data:", err);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream error:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        // Capture error with PostHog
        posthog.captureException(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      setIsLoading(false);
      controller.current = null;
    }
  };

  useEffect(() => {
    const savedBg = localStorage.getItem("bg");
    if (savedBg) {
      setBg(savedBg);
    }
  }, []);

  useEffect(() => {
    if (!bg) return;
    localStorage.setItem("bg", bg);
  }, [bg]);

  const handleSave = () => {
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summerizer",
    });
    sendGTMEvent({
      event: "save_completion",
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summerizer",
    });
    // Capture completion saved event with PostHog
    posthog.capture("completion_saved", {
      mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
      completion_length: completion.length,
    });
  };

  // Dynamic Window Resizing
  useEffect(() => {
    if (!isActive) return;
    if (typeof window !== "undefined" && window.electronAPI && session) {
      // Keep window at expanded size
      window.electronAPI.windowSetSize(1000, 600);
    }
  }, [session, isActive]);

  if (!isClientReady) {
    return <CopilotSkeleton />;
  }

  return (
    <div className="flex flex-col h-full gap-4 pt-4 px-2 overflow-hidden">
      {error && (
        <div className="fixed top-8 left-0 w-full p-2 text-center text-[10px] bg-red-500/80 backdrop-blur-md text-white z-[60] animate-fade-in-scale">
          {error.message}
        </div>
      )}

      {/* Top Section: Context & Transcription */}
      <div className="grid gap-4 md:grid-cols-2 h-[45%] min-h-[320px] shrink-0">
        {/* Context & Controls Card */}
        <div className="glass-card p-4 flex flex-col gap-3 h-full">
          <div className="flex items-center justify-between shrink-0">
            <Label
              htmlFor="system_prompt"
              className="text-zinc-400 font-semibold tracking-wide text-[10px] uppercase"
            >
              Interview Context
            </Label>
          </div>

          <Textarea
            id="system_prompt"
            placeholder="Paste job description, resume, or interview topic here..."
            className="flex-1 min-h-[80px] resize-none bg-transparent border-0 focus-visible:ring-0 p-0 text-zinc-100 placeholder:text-zinc-600 text-xs leading-relaxed"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
          />

          <div className="pt-3 border-t border-white/5 space-y-3">
            <RecorderTranscriber
              addTextinTranscription={addTextinTranscription}
              addTranscriptionSegment={addTranscriptionSegment}
            />

            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="w-full flex items-center justify-between gap-4"
            >
              {/* Mode Switcher */}
              <div className="flex items-center gap-2 bg-black/20 rounded-full px-3 py-1 border border-white/5">
                <span
                  className={`text-[10px] font-medium transition-colors ${flag === FLAGS.SUMMERIZER ? "text-green-400" : "text-zinc-500"}`}
                >
                  Summarizer
                </span>
                <Switch
                  className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-zinc-700"
                  onCheckedChange={handleFlag}
                  defaultChecked
                  checked={flag === FLAGS.COPILOT}
                />
                <span
                  className={`text-[10px] font-medium transition-colors ${flag === FLAGS.COPILOT ? "text-green-400" : "text-zinc-500"}`}
                >
                  Copilot
                </span>
              </div>

              <Button
                className="w-40 h-8 bg-green-600 hover:bg-green-500 text-white font-medium shadow-[0_0_15px_rgba(22,163,74,0.3)] transition-all active:scale-[0.98] text-[10px] uppercase tracking-wider"
                disabled={isLoading}
                type="submit"
                onClick={isLoading ? stop : undefined}
              >
                {isLoading ? (
                  <div className="flex items-center gap-1">
                    <span
                      className="w-1 h-1 bg-white rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-1 h-1 bg-white rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-1 h-1 bg-white rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                ) : (
                  <span>Enter ↵</span>
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* Transcription Card */}
        <div className="glass-card p-4 flex flex-col h-full min-h-[180px]">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <Label
              htmlFor="transcription"
              className="text-zinc-400 font-semibold tracking-wide text-[10px] uppercase"
            >
              Live Transcription
            </Label>
            <button
              type="button"
              className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors uppercase font-medium tracking-wide"
              onClick={clearTranscriptionChange}
            >
              Clear
            </button>
          </div>
          <div
            ref={transcriptionBoxRef}
            className="flex-1 min-h-0 max-h-[250px] overflow-y-auto rounded-lg custom-scrollbar -mr-2 pr-2"
          >
            <TranscriptionDisplay segments={transcriptionSegments} />
          </div>
        </div>
      </div>

      {/* AI Output Section */}
      <div className="flex-1 min-h-0 relative group">
        <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          {completion && (
            <button
              type="button"
              className="text-xs bg-green-900/40 text-green-400 hover:bg-green-900/600 px-3 py-1 rounded-full border border-green-500/20 transition-colors"
              onClick={handleSave}
            >
              Save Note
            </button>
          )}
        </div>

        <div className="glass-card w-full h-full p-6 overflow-y-auto custom-scrollbar relative">
          {!completion ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-2">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                <span className="text-2xl animate-pulse">✨</span>
              </div>
              <p className="text-sm">
                Ready to assist. Start recording or type context.
              </p>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-zinc-100 text-sm leading-relaxed prose prose-invert max-w-none">
              {completion}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopilotSkeleton() {
  return (
    <div className="grid w-full gap-4 mt-12 animate-pulse">
      <div className="h-8 w-64 bg-gray-800/60 rounded" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="h-4 w-40 bg-gray-800/60 rounded" />
          <div className="h-[150px] bg-gray-800/60 rounded" />
          <div className="h-9 bg-gray-800/60 rounded" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-32 bg-gray-800/60 rounded" />
          <div className="h-[225px] bg-gray-800/60 rounded" />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <div className="h-9 bg-gray-800/60 rounded" />
        <div className="h-9 bg-gray-800/60 rounded" />
      </div>
      <div className="h-40 bg-gray-800/60 rounded" />
    </div>
  );
}

function RecorderFallback() {
  return (
    <div className="flex h-9 items-center justify-center rounded bg-gray-900/40 text-xs text-gray-400">
      Initializing recorder...
    </div>
  );
}
