"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RecorderTranscriber from "@/components/recorder";
import { useCallback, useEffect, useRef, useState } from "react";
import { FLAGS, HistoryData } from "@/lib/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { ComponentProps } from 'react';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Define models directly here instead of importing from JSON
// This avoids Edge Runtime issues with JSON imports
const MODELS = {
  defaultModel: "openai/gpt-4o-mini",
  availableModels: [
    "openai/gpt-4o-mini",
    "openai/o4-mini",
    "google/gemini-2.5-pro-preview-03-25",
    "google/gemini-2.0-flash-001",
    "agentica-org/deepcoder-14b-preview:free",
    "qwen/qwen2.5-vl-32b-instruct",
    "qwen/qwq-32b" 
    
  ]
};

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
}
export function Copilot({ addInSavedData }: CopilotProps) {
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [selectedModel, setSelectedModel] = useState<string>(MODELS.defaultModel);

  // State for manual stream handling
  const [completion, setCompletion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // --- Manual Fetch and Stream Handling (Moved Before handleKeyDown) ---
  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement> | Event) => {
    // Check if it's a real form event or a synthetic one from handleKeyDown
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    setIsLoading(true);
    setCompletion(""); // Clear previous completion
    setError(null);    // Clear previous error

    try {
      const response = await fetch("/api/completion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bg,
          flag,
          prompt: transcribedText, // Send transcribedText as prompt
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process buffer line by line for SSE events
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
          const line = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 1);

          if (line.startsWith("data:")) {
            const jsonString = line.substring(5).trim();
            if (jsonString === '[DONE]') { // Handle potential Vercel AI SDK specific DONE message if needed
              done = true;
              break;
            }
            try {
              const parsed = JSON.parse(jsonString);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                setCompletion((prev) => prev + delta);
              }
            } catch (e) {
              console.error("Failed to parse JSON chunk:", jsonString, e);
              // Decide how to handle parse errors, maybe log or ignore
            }
          }
          boundary = buffer.indexOf('\n');
        }
      }
       // Process any remaining data in the buffer after the loop
       if (buffer.startsWith("data:")) {
          const jsonString = buffer.substring(5).trim();
          if (jsonString !== '[DONE]') {
            try {
              const parsed = JSON.parse(jsonString);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                setCompletion((prev) => prev + delta);
              }
            } catch (e) {
               console.error("Failed to parse final JSON chunk:", jsonString, e);
            }
          }
       }

    } catch (err: any) {
      console.error("Error during fetch/stream processing:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [bg, flag, transcribedText, selectedModel, setCompletion, setIsLoading, setError]); // Add dependencies
  // --- End Manual Fetch and Stream Handling ---

  const handleFlag = useCallback((checked: boolean) => {
    if (!checked) {
      setFlag(FLAGS.SUMMERIZER);
    } else {
      setFlag(FLAGS.COPILOT);
    }
  }, []);

  const handleLanguageChange = useCallback((checked: boolean) => {
    setLanguage(checked ? "ru" : "en");
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey) {
      switch (event.key) {
        case "Enter":
          event.preventDefault();
          if (formRef.current) {
            // Directly call handleSubmit for manual fetch
            handleSubmit(new Event('submit') as any); // Cast needed as synthetic event isn't directly created
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
  }, [handleSubmit]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const addTextinTranscription = useCallback((text: string) => {
    setTranscribedText((prev) => prev + " " + text);
  }, [setTranscribedText]);

  const handleTranscriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setTranscribedText(e.target.value);
  };

  const clearTranscriptionChange = useCallback(() => {
    setTranscribedText("");
  }, [setTranscribedText]);

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

  const handleSave = useCallback(() => {
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summerizer",
    });
  }, [addInSavedData, completion, flag]);

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
          <div className="grid gap-1.5 mt-2">
            <Label htmlFor="model-select" className="text-green-800 text-sm">Select Model</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger id="model-select" className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-zinc-950 z-50">
                {MODELS.availableModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="flex-grow">Language</Label>
            <RadioGroup
              defaultValue={language}
              onValueChange={(value: "ru" | "en") => setLanguage(value)}
              className="flex space-x-2"
              value={language}
            >
              <div className="flex items-center space-x-1">
                <RadioGroupItem value="en" id="lang-en" />
                <Label htmlFor="lang-en">EN</Label>
              </div>
              <div className="flex items-center space-x-1">
                <RadioGroupItem value="ru" id="lang-ru" />
                <Label htmlFor="lang-ru">RU</Label>
              </div>
            </RadioGroup>
          </div>
          <RecorderTranscriber
            addTextinTranscription={addTextinTranscription}
            language={language}
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
          >
            Process
            <span className="opacity-85 text-xs p-2"> (Ctrl + Enter)</span>
          </Button>
        </form>
      </div>

      <div className="mx-2 md:mx-10 mt-4 mb-8">
        {completion && (
          <button
            type="button"
            className="text-xs text-green-500 hover:text-green-800 underline mb-2"
            onClick={handleSave}
          >
            save
          </button>
        )}
        <div className="prose prose-sm dark:prose-invert max-w-none border rounded p-2 min-h-[200px] bg-gray-50">
          <ReactMarkdown
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                return match ? (
                  // @ts-ignore - Suppress persistent type errors for now
                  <SyntaxHighlighter
                    // @ts-ignore - Style prop type mismatch
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {completion}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
