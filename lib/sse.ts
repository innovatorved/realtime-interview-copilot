/** Shared Server-Sent Events reader for the worker's `/api/completion`
 *  streams.
 *
 *  The three historical implementations (`copilot.tsx`, `CompactCopilot`,
 *  `useAskChat`) all parsed the same `data: <json>\n\n` framing but with
 *  subtle differences in buffer-split semantics and abort handling.
 *  This helper preserves the strictest semantics (the one in
 *  `useAskChat.send`):
 *
 *   • Decode each read with `{ stream: true }` so multi-byte UTF-8
 *     boundaries don't corrupt.
 *   • Split on `\n\n` and keep the trailing fragment for the next read.
 *   • Match `data:` lines with `^data:\s*(.*)$` (multiline) so an event
 *     can interleave non-data fields without us picking them up.
 *   • `[DONE]` is the protocol-level terminator and is skipped silently.
 *   • `{ error: string }` payloads are surfaced via `onError` and stop
 *     iteration.
 *   • Parse errors per event are reported via `onParseError` without
 *     aborting the stream — a malformed chunk should not lose the
 *     remaining tokens. */

export interface CompletionDelta {
  text?: string;
  error?: string;
}

export interface ParseSseStreamOptions {
  signal?: AbortSignal;
  /** Called for every successfully parsed `data:` payload (excluding
   *  `[DONE]`). Returning `false` stops iteration. */
  onChunk: (delta: CompletionDelta) => boolean | void;
  /** Called when a payload includes `{ error: string }`. After this
   *  callback returns, iteration stops. */
  onError?: (message: string) => void;
  /** Optional reporter for per-event JSON parse failures. The stream
   *  continues regardless. */
  onParseError?: (err: unknown) => void;
  /** Optional cap on the client-side carry buffer in characters. If the
   *  unconsumed buffer grows past this threshold we throw with the
   *  message `"SSE buffer overflow"` — matches the historical
   *  `copilot.tsx` behavior so a broken upstream can't balloon
   *  client memory. */
  maxBufferChars?: number;
}

/** Walk a `Response.body` ReadableStream as Server-Sent Events. Returns
 *  when the stream closes, the signal aborts, an error payload arrives,
 *  or `onChunk` returns `false`. Throws if the response has no body. */
export async function parseSseStream(
  response: Response,
  options: ParseSseStreamOptions,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is null");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (
        typeof options.maxBufferChars === "number" &&
        buffer.length > options.maxBufferChars
      ) {
        throw new Error("SSE buffer overflow");
      }
      const events = buffer.split("\n\n");
      // Last fragment is incomplete — keep it for the next read.
      buffer = events.pop() ?? "";
      for (const ev of events) {
        const trimEv = ev.trim();
        if (!trimEv) continue;
        const dm = /^data:\s*(.*)$/m.exec(trimEv);
        if (!dm) continue;
        const data = dm[1];
        if (data === "[DONE]") continue;
        let parsed: CompletionDelta | null = null;
        try {
          parsed = JSON.parse(data) as CompletionDelta;
        } catch (parseErr) {
          options.onParseError?.(parseErr);
          continue;
        }
        if (parsed && typeof parsed.error === "string") {
          options.onError?.(parsed.error);
          return;
        }
        const cont = options.onChunk(parsed ?? {});
        if (cont === false) return;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
