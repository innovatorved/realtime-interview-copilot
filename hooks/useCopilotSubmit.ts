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
import {
  humanizeError,
  humanizeHttpStatus,
  parseApiErrorResponse,
} from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
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
  regenerate: () => Promise<void>;
  canRegenerate: boolean;
}

export function useCopilotSubmit({
  flag,
  bg,
  transcribedText,
}: UseCopilotSubmitArgs): CopilotSubmitHandle {
  const [completion, setCompletion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [canRegenerate, setCanRegenerate] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastFailedRef = useRef<{
    flag: FLAGS;
    bg: string;
    prompt: string;
  } | null>(null);

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

  const runCompletion = useCallback(
    async (runFlag: FLAGS, runBg: string, prompt: string) => {
      if (isLoading || controller.current) return;
      if (!prompt.trim()) {
        setError(new Error(humanizeHttpStatus(0, { kind: "no-input" })));
        return;
      }

      setError(null);
      setCompletion("");
      setIsLoading(true);
      controller.current = new AbortController();

      sendGTMEvent({ event: "generate_completion", flag: runFlag });
      posthog.capture("completion_generated", {
        mode: runFlag === FLAGS.COPILOT ? "copilot" : "summarizer",
        has_context: runBg.length > 0,
        transcription_length: prompt.length,
      });

      try {
        const response = await ricFetch("/api/completion", {
          method: "POST",
          body: JSON.stringify({
            bg: runBg,
            flag: runFlag,
            prompt,
          }),
          signal: controller.current.signal,
        });

        if (!response.ok) {
          throw new Error(await parseApiErrorResponse(response));
        }

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
        lastFailedRef.current = null;
        setCanRegenerate(false);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Stream error:", err);
          setError(new Error(humanizeError(err)));
          posthog.captureException(err);
          lastFailedRef.current = {
            flag: runFlag,
            bg: runBg,
            prompt,
          };
          setCanRegenerate(true);
        }
      } finally {
        setIsLoading(false);
        controller.current = null;
      }
    },
    [isLoading],
  );

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      await runCompletion(flag, bg, transcribedText);
    },
    [bg, flag, runCompletion, transcribedText],
  );

  const regenerate = useCallback(async () => {
    const last = lastFailedRef.current;
    if (!last) return;
    await runCompletion(last.flag, last.bg, last.prompt);
  }, [runCompletion]);

  return {
    completion,
    setCompletion,
    isLoading,
    error,
    setError,
    submit,
    stop,
    regenerate,
    canRegenerate,
  };
}
