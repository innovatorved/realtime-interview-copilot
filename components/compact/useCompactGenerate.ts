"use client";

/** Owns the single-shot Copilot/Summarizer completion flow for the
 *  compact surface (abort controller, error mapping, PostHog payload,
 *  SSE parsing). */

import posthog from "posthog-js";
import { useCallback, useRef } from "react";
import { humanizeHttpStatus } from "@/lib/api-errors";
import { createStreamFlusher } from "@/lib/stream-flush";
import {
  humanizeStreamError,
  isAbortError,
  streamCompletion,
} from "@/lib/stream-completion";
import { FLAGS } from "@/lib/types";
import type { CompactOutputMode } from "./OutputPanel";

interface UseCompactGenerateArgs {
  bg: string;
  transcribedText: string;
  isLoading: boolean;
  setError: (msg: string | null) => void;
  setCompletion: React.Dispatch<React.SetStateAction<string>>;
  setIsLoading: (v: boolean) => void;
  setActiveFlag: (f: FLAGS | null) => void;
  setOutputCollapsed: (v: boolean) => void;
  setOutputMode: (m: CompactOutputMode) => void;
}

export interface CompactGenerateHandle {
  generate: (flag: FLAGS) => Promise<void>;
  abort: () => void;
  controllerRef: React.MutableRefObject<AbortController | null>;
}

export function useCompactGenerate({
  bg,
  transcribedText,
  isLoading,
  setError,
  setCompletion,
  setIsLoading,
  setActiveFlag,
  setOutputCollapsed,
  setOutputMode,
}: UseCompactGenerateArgs): CompactGenerateHandle {
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setIsLoading(false);
      setActiveFlag(null);
    }
  }, [setActiveFlag, setIsLoading]);

  const generate = useCallback(
    async (flag: FLAGS) => {
      if (isLoading || controllerRef.current) return;
      const prompt = transcribedText.trim();

      if (!prompt) {
        setError(humanizeHttpStatus(0, { kind: "no-input" }));
        return;
      }

      setError(null);
      setCompletion("");
      setIsLoading(true);
      setActiveFlag(flag);
      setOutputCollapsed(false);
      setOutputMode("transcript");
      controllerRef.current = new AbortController();

      posthog.capture("completion_generated", {
        mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
        has_context: bg.length > 0,
        prompt_length: prompt.length,
        has_image: false,
        image_count: 0,
        source: "transcription",
        surface: "compact",
      });

      try {
        // Accumulate tokens locally; apply to state at a bounded rate.
        let acc = "";
        const flusher = createStreamFlusher(() => setCompletion(acc));
        try {
          await streamCompletion({
            flag,
            bg,
            prompt,
            signal: controllerRef.current.signal,
            onChunk: (text) => {
              acc += text;
              flusher.schedule();
            },
          });
          flusher.flush();
        } finally {
          flusher.dispose();
        }
      } catch (err: unknown) {
        if (!isAbortError(err) && err instanceof Error) {
          console.error("Stream error:", err);
          setError(humanizeStreamError(err));
          posthog.captureException(err);
        }
      } finally {
        setIsLoading(false);
        setActiveFlag(null);
        controllerRef.current = null;
      }
    },
    [
      bg,
      isLoading,
      setActiveFlag,
      setCompletion,
      setError,
      setIsLoading,
      setOutputCollapsed,
      setOutputMode,
      transcribedText,
    ],
  );

  return { generate, abort, controllerRef };
}
