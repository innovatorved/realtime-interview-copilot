"use client";

/** Owns the single-shot Copilot/Summarizer completion flow for the
 *  full Copilot surface. */

import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeHttpStatus } from "@/lib/api-errors";
import {
  humanizeStreamError,
  isAbortError,
  streamCompletion,
} from "@/lib/stream-completion";
import { FLAGS } from "@/lib/types";
import { useCopilotSession } from "@/components/CopilotSessionProvider";

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
  const { completion, setCompletion } = useCopilotSession();
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
        await streamCompletion({
          flag: runFlag,
          bg: runBg,
          prompt,
          signal: controller.current.signal,
          onChunk: (text) => {
            setCompletion((current) => current + text);
          },
        });
        lastFailedRef.current = null;
        setCanRegenerate(false);
      } catch (err: unknown) {
        if (!isAbortError(err)) {
          console.error("Stream error:", err);
          setError(new Error(humanizeStreamError(err)));
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
    [isLoading, setCompletion],
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
