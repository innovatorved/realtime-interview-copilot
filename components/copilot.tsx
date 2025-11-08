"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RecorderTranscriber from "@/components/recorder";
import { useCallback, useEffect, useRef, useState } from "react";

import { FLAGS, HistoryData, TranscriptionSegment } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
}

export function Copilot({ addInSavedData }: CopilotProps) {
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
    } else {
      setFlag(FLAGS.COPILOT);
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
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

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

    try {
      const response = await fetch(
        "https://realtime-worker-api.innovatorved.workers.dev/completion",
        {
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
        },
      );

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
  };

  return (
    <div className="grid w-full gap-4 mt-12">
      <h2 className="text-3xl underline text-green-600 font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
        Realtime Interview Copilot
      </h2>
      {error && (
        <div className="fixed top-0 left-0 w-full p-4 text-center text-xs bg-red-500 text-white">
          {error.message}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label
            htmlFor="system_prompt"
            className="text-white font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          >
            Interview Background
          </Label>
          <Textarea
            id="system_prompt"
            placeholder="Type or paste your text here."
            className="resize-none h-[50px] overflow-hidden bg-gray-900/60 backdrop-blur-md border-gray-600/50 text-white placeholder:text-gray-400"
            style={{ lineHeight: "1.5", maxHeight: "150px" }}
            value={bg}
            onChange={(e) => setBg(e.target.value)}
          />
          <RecorderTranscriber
            addTextinTranscription={addTextinTranscription}
            addTranscriptionSegment={addTranscriptionSegment}
          />
        </div>

        <div className="grid gap-1.5 my-2">
          <Label
            htmlFor="transcription"
            className="text-white font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          >
            Transcription{" "}
            <button
              type="button"
              className="text-xs text-red-400 hover:text-red-300 underline"
              onClick={clearTranscriptionChange}
            >
              clear
            </button>
          </Label>
          <div
            ref={transcriptionBoxRef}
            className="mt-2 h-[225px] overflow-y-auto border border-gray-600/50 rounded-lg p-2 bg-gray-900/60 backdrop-blur-md"
          >
            <TranscriptionDisplay segments={transcriptionSegments} />
          </div>
        </div>
      </div>
      <div>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="grid md:grid-cols-2 gap-2"
        >
          <div className="flex items-center justify-center w-full border border-gray-600/50 bg-gray-900/40 backdrop-blur-sm rounded px-2 py-1">
            <Label className="text-white font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-opacity duration-300">
              Summerizer
              <span className="opacity-85 text-xs p-2"> (S)</span>
            </Label>
            <Switch
              className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-600 m-2"
              onCheckedChange={handleFlag}
              defaultChecked
              checked={flag === FLAGS.COPILOT}
            />
            <Label className="text-white font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-opacity duration-300">
              Copilot<span className="opacity-85 text-xs p-2"> (C)</span>
            </Label>
          </div>

          <Button
            className="h-9 w-full bg-green-600 hover:bg-green-700 text-white transition-opacity duration-300 font-semibold"
            size="sm"
            variant="outline"
            disabled={isLoading}
            type="submit"
            onClick={isLoading ? stop : undefined}
          >
            {isLoading ? "Stop" : "Process"}
            <span className="opacity-85 text-xs p-2"> (Enter)</span>
          </Button>
        </form>
      </div>

      {/* AI Completion Section */}
      <div className="mx-2 md:mx-10 mt-8 mb-8">
        {completion && (
          <button
            type="button"
            className="text-xs text-green-400 hover:text-green-300 underline font-medium"
            onClick={handleSave}
          >
            save
          </button>
        )}
        <div className="flex whitespace-pre-wrap text-white bg-gray-900/60 backdrop-blur-md rounded-lg p-4 border border-gray-600/50">
          {completion}
        </div>
      </div>
    </div>
  );
}
