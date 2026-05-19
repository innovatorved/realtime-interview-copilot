"use client";

import { useEffect, useState, useRef } from "react";
import SafeMarkdown from "@/components/SafeMarkdown";

interface HistoryItem {
  id: string;
  text: string;
}

export function AssistantView() {
  const [context, setContext] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentResponse, setCurrentResponse] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The main process does not yet implement onSyncContext /
    // onSyncCompletion IPC channels. Guard every call so the renderer
    // can't TypeError if it runs against an older preload build.
    if (typeof window === "undefined" || !window.electronAPI) return;
    const api = window.electronAPI;

    const unsubscribeContext =
      typeof api.onSyncContext === "function"
        ? api.onSyncContext((text) => setContext(text))
        : undefined;

    const unsubscribeCompletion =
      typeof api.onSyncCompletion === "function"
        ? api.onSyncCompletion((text, isNew) => {
            if (isNew) {
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
          })
        : undefined;

    return () => {
      unsubscribeContext?.();
      unsubscribeCompletion?.();
    };
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.electronAPI &&
      containerRef.current
    ) {
      const height = containerRef.current.scrollHeight;
      window.electronAPI.windowSetSize(0, height + 40);
    }
  }, [context, history, currentResponse]);

  return (
    <div className="min-h-screen bg-transparent p-4 overflow-hidden select-none flex flex-col items-center">
      <div
        ref={containerRef}
        className="w-full max-w-[min(100%,72ch)] space-y-4"
      >
        {context && (
          <div className="glass-card p-6 border-emerald-500/15 animate-in fade-in slide-in-from-top-4 duration-500">
            <h2 className="text-[10px] font-semibold text-emerald-400/90 mb-2 uppercase tracking-widest">
              Interview context
            </h2>
            <div className="text-sm text-[color:var(--app-text)] leading-relaxed font-medium prose prose-invert prose-sm max-w-none">
              <SafeMarkdown>{context}</SafeMarkdown>
            </div>
          </div>
        )}

        {history.map((item) => (
          <div
            key={item.id}
            className="glass-card p-5 animate-in fade-in slide-in-from-bottom-4 duration-500"
          >
            <div className="text-sm text-[color:color-mix(in_oklch,var(--app-text)_88%,transparent)] leading-relaxed prose prose-invert prose-sm max-w-none">
              <SafeMarkdown>{item.text}</SafeMarkdown>
            </div>
          </div>
        ))}

        {currentResponse && (
          <div className="glass-card p-5 border-emerald-500/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/35" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
              </span>
              <span className="text-[10px] text-emerald-400/90 font-mono tracking-wide">
                Streaming
              </span>
            </div>
            <div className="text-sm text-[color:var(--app-text)] leading-relaxed font-medium prose prose-invert prose-sm max-w-none">
              <SafeMarkdown>{currentResponse}</SafeMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
