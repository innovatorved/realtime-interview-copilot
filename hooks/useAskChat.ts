"use client";

import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  humanizeError,
  humanizeHttpStatus,
  parseApiErrorResponse,
} from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
import { dbg } from "@/lib/debug";
import { parseSseStream } from "@/lib/sse";
import { FLAGS } from "@/lib/types";

/**
 * One turn in an Ask AI conversation.
 *
 * `pending` marks the assistant message that is currently streaming. The
 * UI uses this to show a typing indicator vs. a finished bubble. We never
 * persist `pending` to sessionStorage — a stale "pending" surviving a
 * reload would look like an interrupted stream forever.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Data-URL screenshots attached to this turn. Only the renderer uses
   *  this — it's also sent to the worker so the model can refer back to
   *  earlier screenshots when answering a follow-up question. */
  images?: string[];
  ts: number;
  /** True while this assistant message is still being streamed. Stripped
   *  before persisting and never restored from storage. */
  pending?: boolean;
}

interface UseAskChatOptions {
  /**
   * Optional sessionStorage key for persisting the message thread across
   * reloads. Pass `undefined` to keep history purely in memory (the
   * QuestionAssistant surface). The Compact surface uses this so a
   * window reload doesn't drop the conversation.
   */
  storageKey?: string;
  /**
   * Background / system context. Folded into the first user turn on the
   * server (see `buildAskAiPrompt` in the worker). Doesn't repeat each turn.
   */
  background?: string;
  /**
   * Cap on the number of messages sent in the request payload. Older
   * entries are dropped pair-wise (always starting from a user message).
   * Defaults to 16 = ~8 user + 8 assistant turns. The worker enforces
   * its own hard cap (24) so the server is authoritative.
   */
  sendCap?: number;
}

export interface UseAskChatHandle {
  messages: ChatMessage[];
  /** True while an assistant message is being streamed in. */
  isLoading: boolean;
  /** Convenience alias — same value as `isLoading`. */
  isStreaming: boolean;
  /** Most recent transport error, or null if everything's fine. */
  error: string | null;
  /**
   * Append a user message and stream the assistant's reply. No-op if a
   * stream is already in flight (the UI should disable the submit
   * button while `isLoading`).
   */
  send: (opts: { text: string; images?: string[] }) => Promise<void>;
  /**
   * Abort the in-flight stream. If text has already streamed in, the
   * partial assistant message is kept (with `pending: false`); if no
   * text arrived, the empty placeholder bubble is removed.
   */
  abort: () => void;
  /** Clear the entire conversation and any pending stream. */
  reset: () => void;
  /**
   * Clear just the last transport error without touching the message
   * thread. Used by UI dismiss buttons so a stale error banner doesn't
   * linger over a successful follow-up turn.
   */
  clearError: () => void;
  /** Retry the last failed send (same user message). */
  regenerate: () => Promise<void>;
  canRegenerate: boolean;
}

const DEFAULT_SEND_CAP = 16;

function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for very old environments — sessionStorage paths only need
  // uniqueness within a single browser session, so Date+rand is plenty.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadFromSession(key: string | undefined): ChatMessage[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filtering — never trust storage. A bad shape gets dropped
    // silently rather than crashing the surface on mount.
    return parsed
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === "object" &&
          ((m as ChatMessage).role === "user" ||
            (m as ChatMessage).role === "assistant") &&
          typeof (m as ChatMessage).text === "string",
      )
      .map((m) => ({
        id: typeof m.id === "string" ? m.id : generateId(),
        role: m.role,
        text: m.text,
        images: Array.isArray(m.images)
          ? m.images.filter((x: unknown) => typeof x === "string")
          : undefined,
        ts: typeof m.ts === "number" ? m.ts : Date.now(),
        // pending is intentionally stripped on hydrate.
      }));
  } catch {
    return [];
  }
}

/**
 * Cap the history sent to the server. Drops oldest first. If trimming
 * leaves the list starting with an assistant message, we drop that too —
 * both Gemini and OpenAI expect the conversation to open with a user
 * turn (and we want the model to see "what the user just asked", not
 * "an assistant reply to nothing").
 */
function trimForServer(history: ChatMessage[], cap: number): ChatMessage[] {
  if (history.length <= cap) return history.slice();
  const dropped = history.slice(history.length - cap);
  if (dropped[0]?.role === "assistant") return dropped.slice(1);
  return dropped;
}

export function useAskChat(options: UseAskChatOptions = {}): UseAskChatHandle {
  const { storageKey, background = "", sendCap = DEFAULT_SEND_CAP } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadFromSession(storageKey),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRegenerate, setCanRegenerate] = useState(false);

  // In-flight request handle so callers can abort the SSE stream.
  const controllerRef = useRef<AbortController | null>(null);
  const lastFailedSendRef = useRef<{ text: string; images?: string[] } | null>(
    null,
  );
  // Snapshot of state for the memoized `send` to read from without
  // triggering a re-create of the callback every render.
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const optsRef = useRef({ background, sendCap, storageKey });
  optsRef.current = { background, sendCap, storageKey };

  // Persist on every mutation. Strip `pending` so a reload after an
  // interrupted stream doesn't leave a forever-spinning bubble.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const persistable = messages.map(
        ({ pending: _pending, ...rest }) => rest,
      );
      sessionStorage.setItem(storageKey, JSON.stringify(persistable));
    } catch {
      // Quota exceeded etc — in-memory state remains authoritative.
    }
  }, [messages, storageKey]);

  // Abort on unmount so an SSE stream doesn't outlive the surface.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const reset = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setMessages([]);
    setError(null);
    setIsLoading(false);
    setCanRegenerate(false);
    lastFailedSendRef.current = null;
    const key = optsRef.current.storageKey;
    if (key && typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const send = useCallback(
    async ({ text, images }: { text: string; images?: string[] }) => {
      // Single-stream-at-a-time. The button is disabled while loading so
      // this is mostly defensive against double-submits and Enter-key
      // races. Returning silently is friendlier than throwing here.
      if (controllerRef.current) {
        dbg("ask-chat", "send refused — already streaming");
        return;
      }
      const trimmed = text.trim();
      const hasImages = !!images && images.length > 0;
      if (!trimmed && !hasImages) return;

      const { background: bg, sendCap: cap } = optsRef.current;

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        text: trimmed,
        images: hasImages ? [...images] : undefined,
        ts: now,
      };
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        text: "",
        ts: now + 1,
        pending: true,
      };

      // Snapshot the history that goes in the wire payload — current
      // state PLUS the new user message we're about to append. Reading
      // messagesRef avoids capturing a stale value in this callback.
      const historyForWire = [...messagesRef.current, userMsg];

      // Optimistic UI: append BOTH the user msg and an empty pending
      // assistant placeholder so the user sees instant feedback.
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setError(null);
      setCanRegenerate(false);
      setIsLoading(true);

      const trimmedHistory = trimForServer(historyForWire, cap);
      // Backward-compatibility shim: include the legacy `prompt` / `image`
      // fields alongside the new `messages` array. A worker that
      // understands chat ignores them (it uses `messages`); a pre-chat
      // worker version ignores `messages` and falls back to single-shot
      // on the latest user turn, so the request still succeeds — the
      // model just won't see the prior context. Avoids a hard 400 if the
      // frontend gets deployed before the worker.
      const legacyImage: string | string[] | undefined = hasImages
        ? images.length === 1
          ? images[0]
          : images
        : undefined;
      const payload = {
        bg,
        flag: FLAGS.ASK_AI,
        prompt: trimmed,
        ...(legacyImage !== undefined ? { image: legacyImage } : {}),
        messages: trimmedHistory.map((m) => ({
          role: m.role,
          text: m.text,
          // Only include images on user turns — some OpenAI-compatible
          // providers reject image_url on assistant messages, and we
          // never have model-generated images anyway.
          images:
            m.role === "user" && m.images && m.images.length > 0
              ? m.images
              : undefined,
        })),
      };

      const t0 = performance.now();
      let sseEvents = 0;
      let firstTokenMs: number | null = null;

      const controller = new AbortController();
      controllerRef.current = controller;
      dbg(
        "ask-chat",
        "POST /api/completion · turns:",
        trimmedHistory.length,
        "· last_prompt_len:",
        trimmed.length,
        "· images:",
        hasImages ? images.length : 0,
      );

      try {
        const res = await ricFetch("/api/completion", {
          method: "POST",
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        dbg(
          "ask-chat",
          "response status:",
          res.status,
          "· headers in",
          Math.round(performance.now() - t0),
          "ms",
        );
        if (!res.ok) {
          throw new Error(await parseApiErrorResponse(res));
        }

        // Shared SSE parser. Behavior matches the previous inline loop:
        //   - carry-buffer for events split across reads (`{ stream: true }`)
        //   - `[DONE]` skipped silently
        //   - `{ error }` payloads bubble up as a thrown Error so the
        //     outer catch handles them uniformly
        //   - per-event JSON parse failures are logged via dbg() but
        //     don't abort the stream
        let full = "";
        let streamError: string | null = null;
        await parseSseStream(res, {
          signal: controller.signal,
          onChunk: (delta) => {
            if (typeof delta.text === "string") {
              sseEvents++;
              if (firstTokenMs === null) {
                firstTokenMs = Math.round(performance.now() - t0);
                dbg("ask-chat", "first token at", firstTokenMs, "ms");
              }
              full += delta.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsg.id ? { ...msg, text: full } : msg,
                ),
              );
            }
          },
          onError: (message) => {
            streamError = message;
          },
          onParseError: (parseErr) => {
            dbg(
              "ask-chat",
              "SSE parse error:",
              parseErr instanceof Error ? parseErr.message : String(parseErr),
            );
          },
        });
        if (streamError) {
          throw new Error(streamError);
        }
        dbg(
          "ask-chat",
          "stream done · events:",
          sseEvents,
          "· chars:",
          full.length,
          "· total:",
          Math.round(performance.now() - t0),
          "ms",
        );
        // Finalize — clear `pending` so the UI removes the typing indicator.
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsg.id ? { ...msg, pending: false } : msg,
          ),
        );
        lastFailedSendRef.current = null;
        setCanRegenerate(false);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          dbg(
            "ask-chat",
            "aborted after",
            Math.round(performance.now() - t0),
            "ms (",
            sseEvents,
            "events received)",
          );
          setMessages((prev) => {
            const placeholder = prev.find((m) => m.id === assistantMsg.id);
            if (!placeholder) return prev;
            // Empty placeholder — drop it so we don't leave a blank bubble.
            if (placeholder.text.length === 0) {
              return prev.filter((m) => m.id !== assistantMsg.id);
            }
            // Has streamed text — keep the partial answer, just unflag.
            return prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, pending: false } : m,
            );
          });
        } else {
          const humanized =
            err instanceof Error ? humanizeError(err) : "Something went wrong.";
          dbg(
            "ask-chat",
            "FAILED:",
            humanized || (err instanceof Error ? err.message : String(err)),
          );
          setError(humanized || "Something went wrong. Please try again.");
          lastFailedSendRef.current = {
            text: trimmed,
            images: hasImages ? images : undefined,
          };
          setCanRegenerate(true);
          // Drop the empty placeholder so the thread doesn't render a
          // ghost assistant bubble. The user's message stays — they can
          // retry by hitting Send again.
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
          try {
            posthog.captureException(err);
          } catch {
            // Never let telemetry failures bubble back into the chat flow.
          }
        }
      } finally {
        controllerRef.current = null;
        setIsLoading(false);
      }
    },
    [],
  );

  const regenerate = useCallback(async () => {
    const last = lastFailedSendRef.current;
    if (!last || controllerRef.current) return;
    await send(last);
  }, [send]);

  return {
    messages,
    isLoading,
    isStreaming: isLoading,
    error,
    send,
    abort,
    reset,
    clearError,
    regenerate,
    canRegenerate,
  };
}
