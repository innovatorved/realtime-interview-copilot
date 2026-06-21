"use client";

/** Owns the single-shot Copilot/Summarizer completion flow for the
 *  compact surface (abort controller, error mapping, PostHog payload,
 *  SSE parsing). */

import posthog from "posthog-js";
import { useCallback, useRef } from "react";
import { humanizeHttpStatus } from "@/lib/api-errors";
import { dbg } from "@/lib/debug";
import {
  humanizeStreamError,
  isAbortError,
  streamCompletion,
} from "@/lib/stream-completion";
import { FLAGS } from "@/lib/types";
import {
  isVisionScreenshotDataUrl,
  VISION_FALLBACK_PROMPT,
} from "@/lib/vision-screenshot";
import type { CompactOutputMode } from "./OutputPanel";

interface UseCompactGenerateArgs {
  bg: string;
  transcribedText: string;
  attachedImages: string[];
  isLoading: boolean;
  setError: (msg: string | null) => void;
  setCompletion: React.Dispatch<React.SetStateAction<string>>;
  setIsLoading: (v: boolean) => void;
  setActiveFlag: (f: FLAGS | null) => void;
  setOutputCollapsed: (v: boolean) => void;
  setOutputMode: (m: CompactOutputMode) => void;
}

export interface CompactGenerateHandle {
  generate: (flag: FLAGS, customPrompt?: string) => Promise<void>;
  abort: () => void;
  controllerRef: React.MutableRefObject<AbortController | null>;
}

export function useCompactGenerate({
  bg,
  transcribedText,
  attachedImages,
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
    async (flag: FLAGS, customPrompt?: string) => {
      if (isLoading || controllerRef.current) return;
      const isTypedAsk = customPrompt !== undefined;
      let prompt = (customPrompt ?? transcribedText).trim();

      const validImages = isTypedAsk
        ? attachedImages
            .map((s) => s.trim())
            .filter((s) => isVisionScreenshotDataUrl(s))
        : [];
      const imagePayload: string | string[] | undefined =
        validImages.length === 0
          ? undefined
          : validImages.length === 1
            ? validImages[0]
            : validImages;
      if (validImages.length > 0 && !prompt) {
        prompt = VISION_FALLBACK_PROMPT;
      }

      if (!prompt) {
        setError(
          isTypedAsk
            ? humanizeHttpStatus(0, { kind: "ask-ai" })
            : humanizeHttpStatus(0, { kind: "no-input" }),
        );
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
        has_image: validImages.length > 0,
        image_count: validImages.length,
        source: isTypedAsk ? "typed" : "transcription",
        surface: "compact",
      });

      const t0 = performance.now();
      let sseEvents = 0;
      let firstTokenMs: number | null = null;
      dbg(
        "ask-completion",
        "POST /api/completion (compact) ·",
        flag,
        "· prompt_len:",
        prompt.length,
        "· images:",
        validImages.length,
        "· typed:",
        isTypedAsk,
      );

      try {
        await streamCompletion({
          flag,
          bg,
          prompt,
          image: imagePayload,
          signal: controllerRef.current.signal,
          resolveErrorMessage: (response, defaultMessage) => {
            if (
              isTypedAsk &&
              defaultMessage === humanizeHttpStatus(0, { kind: "no-input" })
            ) {
              return humanizeHttpStatus(response.status, { kind: "ask-ai" });
            }
            return defaultMessage;
          },
          onChunk: (text) => {
            sseEvents++;
            if (firstTokenMs === null) {
              firstTokenMs = Math.round(performance.now() - t0);
              dbg("ask-completion", "first token at", firstTokenMs, "ms");
            }
            setCompletion((current) => current + text);
          },
        });
        dbg(
          "ask-completion",
          "stream done · events:",
          sseEvents,
          "· total:",
          Math.round(performance.now() - t0),
          "ms",
        );
      } catch (err: unknown) {
        if (isAbortError(err)) {
          dbg(
            "ask-completion",
            "aborted after",
            Math.round(performance.now() - t0),
            "ms (",
            sseEvents,
            "events received)",
          );
        } else if (err instanceof Error) {
          console.error("Stream error:", err);
          dbg("ask-completion", "FAILED:", err.message);
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
      attachedImages,
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
