"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendIcon, Mic, GripHorizontal } from "lucide-react";

interface QuestionAssistantProps {
  onQuestionSubmit?: (question: string) => void;
}

export function QuestionAssistant({ onQuestionSubmit }: QuestionAssistantProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const controller = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!question.trim()) return;

    setError(null);
    setAnswer("");
    setIsLoading(true);

    if (controller.current) controller.current.abort();
    controller.current = new AbortController();

    try {
      const response = await fetch("/api/completion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: question,
          flag: "copilot",
          bg: `You are a professional interview coach helping candidates ace technical and behavioral interviews.

IMPORTANT: Provide DETAILED, COMPREHENSIVE, INTERVIEW-READY answers. This is NOT for simple definitions - it's to help candidates answer interview questions perfectly.

For ANY question:
1. Start with clear definition or core concept
2. Explain WHY it matters in interviews/industry
3. Provide real-world examples and use cases
4. Share key points/features/advantages they should mention
5. Include practical tips on how to discuss this in an interview
6. Add relevant best practices or common pitfalls to avoid
7. Format with bullet points for clarity

Guidelines:
- NO filler words ('alright', 'umm', 'ha', 'you know', 'basically', 'like')
- Be detailed enough that candidate can use the answer directly
- Include examples they can mention
- Professional and authoritative tone
- Structure answer for easy reference during interview`,
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

      if (onQuestionSubmit) {
        onQuestionSubmit(question);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Error:", err);
        setError("Failed to get answer. Please try again.");
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

  // Simulate listening state
  useEffect(() => {
    setIsListening(true);
  }, []);

  // Handle mouse drag
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    setIsDragging(true);
    const rect = containerRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Keep within bounds
      const maxX = window.innerWidth - 288; // w-72 = 18rem = 288px
      const maxY = window.innerHeight - 100;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={containerRef}
      className="fixed w-72 z-40 select-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? "grabbing" : "grab",
      }}
    >
      {/* Listening Indicator */}
      {isListening && !isLoading && (
        <div className="mb-2 px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full flex items-center gap-1.5 shadow-sm">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse animation-delay-100" />
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse animation-delay-200" />
          </div>
          <span className="text-white text-xs font-medium flex-1">Listening...</span>
        </div>
      )}

      {/* Main Box */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        {/* Drag Handle Header */}
        <div
          onMouseDown={handleMouseDown}
          className="bg-gradient-to-r from-green-600 to-green-700 text-white px-2.5 py-1.5 flex items-center gap-1.5 cursor-grab active:cursor-grabbing hover:from-green-700 hover:to-green-800 transition-colors"
        >
          <GripHorizontal size={12} />
          <span className="text-xs font-medium flex-1">Ask AI</span>
        </div>

        {/* Compact Input Area */}
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 p-2.5">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask..."
            disabled={isLoading}
            className="flex-1 border-0 text-xs h-7 placeholder-gray-400 focus:ring-1 focus:ring-green-500"
          />
          <Button
            type="submit"
            disabled={isLoading || !question.trim()}
            onClick={isLoading ? handleStop : undefined}
            className={`${
              isLoading
                ? "bg-red-500 hover:bg-red-600"
                : "bg-green-600 hover:bg-green-700"
            } text-white h-6 w-6 p-0 rounded transition-colors flex items-center justify-center`}
            size="sm"
          >
            {isLoading ? "✕" : <SendIcon size={12} />}
          </Button>
        </form>

        {/* Loading State */}
        {isLoading && (
          <div className="px-2.5 py-1.5 border-t border-gray-100 flex items-center gap-1.5">
            <div className="w-2 h-2 animate-spin rounded-full border border-green-600 border-t-transparent" />
            <span className="text-xs text-gray-600">Processing...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-2.5 py-1.5 border-t border-gray-100 bg-red-50 text-red-600 text-xs">
            {error}
          </div>
        )}

        {/* Answer */}
        {answer && (
          <div className="px-2.5 py-2 border-t border-gray-100 bg-gradient-to-b from-green-50 to-white max-h-48 overflow-y-auto">
            <div className="text-gray-800 text-xs leading-relaxed whitespace-pre-wrap">
              {answer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
