/** HTTP retry helper for transient upstream failures. */

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export interface FetchWithRetryOpts {
  /** Number of retries after the initial attempt. */
  retries: number;
  /** Base backoff in ms; doubled each attempt with ±100ms jitter. */
  baseMs: number;
  /**
   * Hard upper bound for the request. Default semantics: aborts the entire
   * fetch (headers + body). For streaming consumers, pass `streaming: true`
   * — the timer is then cleared the moment the response headers arrive so
   * a long-running body read can never be killed by this timeout.
   */
  timeoutMs: number;
  /**
   * When true, `timeoutMs` only bounds time-to-first-byte; the body may
   * stream indefinitely afterwards. Required for SSE / chunked LLM streams
   * — without this a 30s+ completion is aborted at `timeoutMs`.
   */
  streaming?: boolean;
}

/**
 * Issue an HTTP request with bounded retries for transient upstream failures.
 * Only the initial request (headers + connection) is retried — once the body
 * has started streaming we hand control to the caller.
 *
 * Streaming note: pass `streaming: true` if you intend to read the response
 * body progressively. Without it, the same `timeoutMs` that bounds the
 * connection also bounds the read loop, which silently kills long LLM
 * completions at `timeoutMs` (was a real bug in completion-openai.ts).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOpts,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            `fetchWithRetry: timed out after ${opts.timeoutMs}ms`,
            "TimeoutError",
          ),
        ),
      opts.timeoutMs,
    );
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      // For streaming callers, drop the timer NOW so the body read isn't
      // killed mid-stream. For non-streaming callers, leave the timer
      // running so a hung upstream still gets cut off.
      if (opts.streaming) clearTimeout(timeoutId);
      if (
        resp.ok ||
        !RETRYABLE_STATUS.has(resp.status) ||
        attempt === opts.retries
      ) {
        if (!opts.streaming) clearTimeout(timeoutId);
        return resp;
      }
      try {
        await resp.body?.cancel();
      } catch {
        /* ignore */
      }
      if (!opts.streaming) clearTimeout(timeoutId);
      lastErr = new Error(`upstream ${resp.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (attempt === opts.retries) throw err;
    }
    const delay =
      opts.baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
