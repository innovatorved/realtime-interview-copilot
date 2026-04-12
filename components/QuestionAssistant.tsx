"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Square, MessageSquare, Sparkles } from "lucide-react";
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
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Error:", err);
        setError("Failed to get answer. Please try again.");
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
      className={`w-full max-w-3xl mx-auto px-4 py-6 flex flex-col transition-all duration-500 ${
        !answer && !isLoading
          ? "justify-center min-h-[calc(100vh-140px)]"
          : "justify-start"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/10">
          <MessageSquare className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            Ask AI Assistant
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          </h2>
          <p className="text-xs text-zinc-500">
            Get interview-ready answers instantly
          </p>
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type your question... (K)"
            disabled={isLoading}
            className="glass-input h-11 text-sm border-0 pl-4 pr-10"
          />
          {!isLoading && question.trim() && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <kbd className="text-[9px] text-zinc-600 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06] font-mono">
                ↵
              </kbd>
            </div>
          )}
        </div>
        <Button
          type="submit"
          disabled={!isLoading && !question.trim()}
          onClick={isLoading ? handleStop : undefined}
          className={`h-11 px-5 rounded-xl font-medium transition-all text-sm ${
            isLoading
              ? "bg-red-500/80 hover:bg-red-500 text-white"
              : "accent-gradient text-white shadow-lg hover:shadow-emerald-500/20"
          }`}
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Square className="w-3.5 h-3.5" />
              Stop
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Ask
            </span>
          )}
        </Button>
      </form>

      {error && (
        <div className="p-3 glass-card border-red-500/10 text-red-300 text-sm rounded-xl mb-4 animate-fade-in-scale">
          {error}
        </div>
      )}

      {isLoading && !answer && (
        <div className="glass-card p-5 rounded-2xl space-y-3 animate-pulse">
          <div className="h-3 w-full bg-white/[0.06] rounded-md" />
          <div className="h-3 w-5/6 bg-white/[0.04] rounded-md" />
          <div className="h-3 w-2/3 bg-white/[0.04] rounded-md" />
          <div className="h-3 w-4/5 bg-white/[0.03] rounded-md" />
        </div>
      )}

      {answer && (
        <div className="glass-card p-6 rounded-2xl animate-fade-in-up min-h-[200px]">
          <div className="prose prose-invert prose-sm max-w-none text-zinc-200 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!answer && !isLoading && !error && (
        <div className="flex flex-col items-center text-center mt-8 space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-md w-full">
            {[
              "Tell me about yourself",
              "Why this company?",
              "Describe a challenge you overcame",
              "What are your strengths?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setQuestion(suggestion)}
                className="glass-card-hover p-3 text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-4">
            Press{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-zinc-500 font-mono text-[9px]">
              K
            </kbd>{" "}
            to focus the input
          </p>
        </div>
      )}
    </div>
  );
}
