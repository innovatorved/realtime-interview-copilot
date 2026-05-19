"use client";

/** Owns the single-shot Copilot/Summarizer completion flow for the
 *  full Copilot surface.
 *
 *  Strictly behavior-preserving: the abort controller, error mapping,
 *  GTM / PostHog payloads, and the SSE parser configuration mirror the
 *  previous inline `handleSubmit` in `components/copilot.tsx`. */

import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeError, humanizeHttpStatus } from "@/lib/api-errors";
import { BACKEND_API_URL } from "@/lib/constant";
import { parseSseStream } from "@/lib/sse";
import { FLAGS } from "@/lib/types";

interface UseCopilotSubmitArgs {
  flag: FLAGS;
  bg: string;
  transcribedText: string;
}

export interface CopilotSubmitHandle {
  completion: string;
  setCompletion: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  error: Error | null;
  setError: (err: Error | null) => void;
  submit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  stop: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export function useCopilotSubmit({
  flag,
  bg,
  transcribedText,
}: UseCopilotSubmitArgs): CopilotSubmitHandle {
  const [completion, setCompletion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    }
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsLoading(false);
    }
  }, []);

  // Abort any in-flight completion stream on unmount. Without this the SSE
  // reader keeps running and attempts setCompletion on an unmounted tree
  // when the user toggles compact mode mid-generation.
  useEffect(() => {
    return () => {
      if (controller.current) {
        controller.current.abort();
        controller.current = null;
      }
    };
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLoading) return;
      if (controller.current) return;

      // Empty prompt → friendly message instead of letting the worker
      // 404/422 us. This is the path the user reported: pressing Generate
      // with nothing transcribed used to surface "HTTP error! status: 404".
      if (!transcribedText.trim()) {
        setError(new Error(humanizeHttpStatus(0, { kind: "no-input" })));
        return;
      }

      setError(null);
      setCompletion("");
      setIsLoading(true);

      controller.current = new AbortController();

      sendGTMEvent({ event: "generate_completion", flag: flag });
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
          throw new Error(humanizeHttpStatus(response.status));
        }

        // Shared SSE parser with a 1MB client-side carry-buffer cap so a
        // broken upstream can't balloon memory. Behavior matches the
        // previous inline loop: `[DONE]` is skipped, `{ error }` payloads
        // throw, parse errors per event are logged but the stream
        // continues so a single malformed chunk doesn't drop the rest.
        let streamError: string | null = null;
        await parseSseStream(response, {
          signal: controller.current.signal,
          maxBufferChars: 1_000_000,
          onChunk: (delta) => {
            if (delta.text) {
              setCompletion((text) => text + delta.text!);
            }
          },
          onError: (message) => {
            streamError = message;
          },
          onParseError: (err) => {
            console.error("Error parsing SSE data:", err);
          },
        });
        if (streamError) {
          throw new Error(streamError);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Stream error:", err);
          setError(new Error(humanizeError(err)));
          posthog.captureException(err);
        }
      } finally {
        setIsLoading(false);
        controller.current = null;
      }
    },
    [bg, flag, isLoading, transcribedText],
  );

  return {
    completion,
    setCompletion,
    isLoading,
    error,
    setError,
    submit,
    stop,
  };
}
