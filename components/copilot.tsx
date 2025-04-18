"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RecorderTranscriber from "@/components/recorder";
import { useCallback, useEffect, useRef, useState } from "react";

import { FLAGS, HistoryData } from "@/lib/types";
import { Switch } from "@/components/ui/switch";

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
}

export function Copilot({ addInSavedData }: CopilotProps) {
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");
  const [completion, setCompletion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

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
    if (event.ctrlKey) {
      switch (event.key) {
        case "Enter":
          event.preventDefault();
          if (formRef.current) {
            const submitEvent = new Event("submit", {
              cancelable: true,
              bubbles: true,
            });
            formRef.current.dispatchEvent(submitEvent);
          }
          break;
        case "s":
          event.preventDefault();
          setFlag(FLAGS.SUMMERIZER);
          break;
        case "c":
          event.preventDefault();
          setFlag(FLAGS.COPILOT);
          break;
      }
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

  const handleTranscriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setTranscribedText(e.target.value);
  };

  const clearTranscriptionChange = () => {
    setTranscribedText("");
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
      const response = await fetch("/api/completion", {
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
        console.log("chunk:", chunk);

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
            console.log(parsed);
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
      <h2 className="text-3xl underline text-green-700">
        Realtime Interview Copilot
      </h2>
      {error && (
        <div className="fixed top-0 left-0 w-full p-4 text-center text-xs bg-red-500 text-white">
          {error.message}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="system_prompt" className="text-green-800">
            Interview Background
          </Label>
          <Textarea
            id="system_prompt"
            placeholder="Type or paste your text here."
            className="resize-none h-[50px] overflow-hidden"
            style={{ lineHeight: "1.5", maxHeight: "150px" }}
            value={bg}
            onChange={(e) => setBg(e.target.value)}
          />
          <RecorderTranscriber
            addTextinTranscription={addTextinTranscription}
          />
        </div>

        <div className="grid gap-1.5 my-2">
          <Label htmlFor="transcription" className="text-green-800">
            Transcription{" "}
            <button
              type="button"
              className="text-xs text-red-500 hover:text-red-800 underline"
              onClick={clearTranscriptionChange}
            >
              clear
            </button>
          </Label>
          <Textarea
            id="transcription"
            className="h-[100px] min-h-[100px] mt-2"
            placeholder="Your transcribed text will appear here."
            value={transcribedText}
            onChange={handleTranscriptionChange}
          />
        </div>
      </div>
      <div>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="grid md:grid-cols-2 gap-2"
        >
          <div className="flex items-center justify-center w-full border">
            <Label className="text-green-800  transition-opacity duration-300">
              Summerizer
              <span className="opacity-85 text-xs p-2"> (Ctrl + s)</span>
            </Label>
            <Switch
              className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-200 m-2"
              onCheckedChange={handleFlag}
              defaultChecked
              checked={flag === FLAGS.COPILOT}
            />
            <Label className="text-green-800  transition-opacity duration-300">
              Copilot<span className="opacity-85 text-xs p-2"> (Ctrl + c)</span>
            </Label>
          </div>

          <Button
            className="h-9 w-full bg-green-600 hover:bg-green-800 text-white transition-opacity duration-300"
            size="sm"
            variant="outline"
            disabled={isLoading}
            type="submit"
            onClick={isLoading ? stop : undefined}
          >
            {isLoading ? "Stop" : "Process"}
            <span className="opacity-85 text-xs p-2"> (Ctrl + Enter)</span>
          </Button>
        </form>
      </div>

      <div className="mx-2 md:mx-10 mt-4 mb-8">
        {completion && (
          <button
            type="button"
            className="text-xs text-green-500 hover:text-green-800 underline"
            onClick={handleSave}
          >
            save
          </button>
        )}
        <div className="flex whitespace-pre-wrap">{completion}</div>
      </div>
    </div>
  );
}
