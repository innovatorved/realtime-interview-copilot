"use client";

import { useEffect, useState, useRef } from "react";
import { Card } from "@/components/ui/card";

interface HistoryItem {
  id: string;
  text: string;
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantView() {
  const [context, setContext] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentResponse, setCurrentResponse] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      // Sync Background Context
      const unsubscribeContext = window.electronAPI.onSyncContext((text) => {
        setContext(text);
      });

      // Sync Responses
      const unsubscribeCompletion = window.electronAPI.onSyncCompletion(
        (text, isNew) => {
          if (isNew) {
            // If we have a current response, push it to history before starting new
            setCurrentResponse((prev) => {
              if (prev) {
                setHistory((h) => [
                  ...h,
                  { id: Date.now().toString(), text: prev },
                ]);
              }
              return text;
            });
          } else {
            setCurrentResponse((prev) => prev + text);
          }
        },
      );

      return () => {
        unsubscribeContext();
        unsubscribeCompletion();
      };
    }
  }, []);

  // Update window size when content changes
  useEffect(() => {
    if (window.electronAPI && containerRef.current) {
      const height = containerRef.current.scrollHeight;
      // Add some padding and limit/clamp if necessary, but user asked for "same as window size"
      window.electronAPI.windowSetSize(0, height + 40); // 0 width keeps current width
    }
  }, [context, history, currentResponse]);

  return (
    <div className="min-h-screen bg-transparent p-4 overflow-hidden select-none flex flex-col items-center">
      <div ref={containerRef} className="w-full space-y-4">
        {/* Context Card (Big Card) */}
        {context && (
          <Card className="w-full bg-gray-900/90 backdrop-blur-xl border-green-900/50 shadow-2xl rounded-2xl overflow-hidden border p-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <h2 className="text-xs font-bold text-green-500 mb-2 uppercase tracking-widest">
              Interview Context
            </h2>
            <div className="text-sm text-gray-200 leading-relaxed font-medium prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {context}
              </ReactMarkdown>
            </div>
          </Card>
        )}

        {/* History Cards */}
        {history.map((item) => (
          <Card
            key={item.id}
            className="w-full bg-gray-800/90 backdrop-blur-xl border-gray-700/50 shadow-xl rounded-xl overflow-hidden border p-5 animate-in fade-in slide-in-from-bottom-4 duration-500"
          >
            <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {item.text}
              </ReactMarkdown>
            </div>
          </Card>
        ))}

        {/* Current Streaming Response Card */}
        {currentResponse && (
          <Card className="w-full bg-gray-800/95 backdrop-blur-xl border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)] rounded-xl overflow-hidden border p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] text-green-400 font-mono">
                GENERATING...
              </span>
            </div>
            <div className="text-sm text-white leading-relaxed font-medium prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {currentResponse}
              </ReactMarkdown>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
