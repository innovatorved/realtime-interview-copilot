"use client";

/** Owns the single-shot Copilot/Summarizer completion flow for the
 *  compact surface (abort controller, error mapping, PostHog payload,
 *  SSE parsing). */

import posthog from "posthog-js";
import { useCallback, useRef } from "react";
import {
  humanizeError,
  humanizeHttpStatus,
  parseApiErrorResponse,
} from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
import { dbg } from "@/lib/debug";
import { parseSseStream } from "@/lib/sse";
import { FLAGS } from "@/lib/types";
import {
  isVisionScreenshotDataUrl,
  VISION_FALLBACK_PROMPT,
} from "@/lib/vision-screenshot";
import type { CompactOutputMode } from "./OutputPanel";

const SSE_CLIENT_BUFFER_MAX = 1_000_000;

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
  /** Aborts any in-flight stream. No-op if nothing is in flight. */
  abort: () => void;
  /** True while a single-shot SSE stream is open. Mirror of the
   *  callback ref the parent uses for keyboard-shortcut decisions. */
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

      // Filter to only valid vision data URLs at submit time. We don't trust
      // the in-memory state — anything that fails validation here would
      // otherwise be rejected by the worker as well.
      const validImages = isTypedAsk
        ? attachedImages
            .map((s) => s.trim())
            .filter((s) => isVisionScreenshotDataUrl(s))
        : [];
      // Worker contract: single string when there's exactly one image,
      // array when there's more (preserves backwards compatibility with
      // older worker versions that didn't accept arrays).
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
      // Single-shot transcript-driven generations are NOT chat — switch
      // the output panel back to the transcript surface so the new
      // completion isn't hidden behind the chat thread.
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
        const response = await ricFetch("/api/completion", {
          method: "POST",
          body: JSON.stringify({
            bg,
            flag,
            prompt,
            ...(imagePayload !== undefined ? { image: imagePayload } : {}),
          }),
          signal: controllerRef.current.signal,
        });

        dbg(
          "ask-completion",
          "response status:",
          response.status,
          "· headers received in",
          Math.round(performance.now() - t0),
          "ms",
        );
        if (!response.ok) {
          // Surface a friendly message instead of "HTTP error! status: 404".
          // For the typed Ask AI path we use the ask-ai kind so the user
          // doesn't get told to "start transcription" (they're typing).
          throw new Error(
            await parseApiErrorResponse(response).then((msg) =>
              isTypedAsk && msg === humanizeHttpStatus(0, { kind: "no-input" })
                ? humanizeHttpStatus(response.status, { kind: "ask-ai" })
                : msg,
            ),
          );
        }
        // Shared SSE parser with the same 1MB carry-buffer cap. Per-event
        // parse failures are logged via console.error so a malformed
        // chunk doesn't silently drop the rest of the stream, and
        // `{ error }` payloads bubble up as a thrown Error.
        let streamError: string | null = null;
        await parseSseStream(response, {
          signal: controllerRef.current.signal,
          maxBufferChars: SSE_CLIENT_BUFFER_MAX,
          onChunk: (delta) => {
            if (delta.text) {
              sseEvents++;
              if (firstTokenMs === null) {
                firstTokenMs = Math.round(performance.now() - t0);
                dbg("ask-completion", "first token at", firstTokenMs, "ms");
              }
              setCompletion((t) => t + delta.text!);
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
        dbg(
          "ask-completion",
          "stream done · events:",
          sseEvents,
          "· total:",
          Math.round(performance.now() - t0),
          "ms",
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
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
          // humanizeError will pass through messages already translated
          // by humanizeHttpStatus above and rewrite anything raw.
          setError(humanizeError(err));
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
