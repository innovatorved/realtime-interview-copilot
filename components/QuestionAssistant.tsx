"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendIcon } from "lucide-react";
import { BACKEND_API_URL } from "@/lib/constant";
import { Label } from "@/components/ui/label";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import posthog from "posthog-js";

interface QuestionAssistantProps {
  onQuestionSubmit?: (question: string) => void;
}

export function QuestionAssistant({
  onQuestionSubmit,
  isActive = false,
}: QuestionAssistantProps & { isActive?: boolean }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
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

  // Auto-focus input when active
  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isActive]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!question.trim()) return;

    setError(null);
    setAnswer("");
    setIsLoading(true);

    if (controller.current) controller.current.abort();
    controller.current = new AbortController();

    // Capture question asked event with PostHog
    posthog.capture("question_asked", {
      question_length: question.length,
    });

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: question,
          flag: "copilot",
          bg: "You are a professional interview coach. Provide detailed, comprehensive, interview-ready answers.",
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
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Error:", err);
        setError("Failed to get answer. Please try again.");
        // Capture error with PostHog
        posthog.captureException(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      setIsLoading(false);
      controller.current = null;
    }
  };

  const handleStop = () => {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`w-full max-w-3xl mx-auto space-y-6 mt-12 flex flex-col transition-all duration-500 ${
        !answer && !isLoading
          ? "justify-center min-h-[calc(100vh-140px)]"
          : "justify-start"
      }`}
    >
      <div className="flex flex-col gap-2">
        <Label className="text-white font-semibold flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Ask AI Assistant
        </Label>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type your question... (K)"
            disabled={isLoading}
            className="flex-1 glass-input border-0 focus:ring-1 focus:ring-green-500"
          />
          <Button
            type="submit"
            disabled={isLoading || !question.trim()}
            onClick={isLoading ? handleStop : undefined}
            className={`${
              isLoading
                ? "bg-red-500 hover:bg-red-600"
                : "bg-green-600 hover:bg-green-700"
            } text-white px-6 transition-colors`}
          >
            {isLoading ? "Stop" : "Ask"}
          </Button>
        </form>
      </div>

      {error && (
        <div className="p-3 glass border-0 text-red-300 text-sm rounded-lg">
          {error}
        </div>
      )}

      {isLoading && !answer && (
        <div className="p-4 glass border-0 rounded-lg space-y-2">
          <div className="h-4 w-full bg-white/10 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-white/10 rounded animate-pulse" />
          <div className="h-4 w-2/3 bg-white/10 rounded animate-pulse" />
        </div>
      )}

      {answer && (
        <div className="p-4 glass border-0 rounded-lg fade-in-answer min-h-[200px]">
          <div className="text-white text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
