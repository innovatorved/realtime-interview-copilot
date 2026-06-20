/**
 * Translate fetch / SSE failures into short, user-readable messages.
 *
 * Why this exists: surfaces previously bubbled raw `HTTP error! status: 404`
 * straight into the UI, which is technically truthful but actively unhelpful
 * — especially for the "click Ask with no transcription" path that
 * consistently produces a 4xx from the worker. This module gives every
 * surface the same friendly translation so the user always sees something
 * actionable.
 */

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

export function humanizeQuotaExceeded(resetAt?: string | null): string {
  if (resetAt) {
    try {
      const date = new Date(resetAt);
      if (!Number.isNaN(date.getTime())) {
        return `You've reached your usage limit. Your quota resets on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`;
      }
    } catch {
      /* fall through */
    }
  }
  return "You've reached your usage limit for this billing cycle. Please try again later.";
}

function isQuotaExceededPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (obj.code === "quota_exceeded" || obj.error === "quota_exceeded") {
    return true;
  }
  if (
    typeof obj.error === "string" &&
    /quota[_\s-]?exceeded/i.test(obj.error)
  ) {
    return true;
  }
  return false;
}

/** Parse a failed API JSON body and return a friendly message when possible. */
export async function parseApiErrorResponse(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as Record<string, unknown>;
    if (isQuotaExceededPayload(data)) {
      const resetAt =
        typeof data.resetAt === "string"
          ? data.resetAt
          : typeof data.cycleResetAt === "string"
            ? data.cycleResetAt
            : null;
      return humanizeQuotaExceeded(resetAt);
    }
    if (typeof data.error === "string" && data.error.trim()) {
      if (/quota[_\s-]?exceeded/i.test(data.error)) {
        return humanizeQuotaExceeded(
          typeof data.resetAt === "string" ? data.resetAt : null,
        );
      }
      return data.error;
    }
  } catch {
    /* not JSON */
  }
  return humanizeHttpStatus(res.status);
}

/**
 * Map an HTTP `Response` (or just a status code) to a friendly message.
 *
 * Pass `kind: "no-input"` when the failure was preceded by an empty
 * transcription / question — we substitute a clearer "no data to work on"
 * message in that case so the user knows the fix is to add input rather
 * than retry the request as-is.
 */
export function humanizeHttpStatus(
  status: number,
  opts: { kind?: "no-input" | "generic" | "ask-ai" | "quota_exceeded" } = {},
): string {
  const { kind = "generic" } = opts;
  if (kind === "quota_exceeded" || status === 402) {
    return humanizeQuotaExceeded();
  }
  if (kind === "ask-ai") {
    // Tailored copy for the Ask AI surface — transcription is irrelevant
    // here, so the Copilot wording ("start transcription") would be wrong
    // and actively misleading. Cover both the empty-input 0 status and any
    // real 4xx from the worker with a single Ask-AI-specific message.
    if (status === 0) {
      return "Type a question or attach a screenshot to get started.";
    }
    if (status === 400 || status === 422) {
      return "Couldn't send that — type a question or attach a screenshot.";
    }
    if (status === 413) {
      return "Question or screenshots too large. Remove an image or shorten the prompt.";
    }
    // Fall through for non-input-related 4xx/5xx (auth, rate-limit, etc.)
    // — those messages below are already Ask-AI-friendly.
  }
  if (kind === "no-input") {
    return "No data to work on yet — start transcription or type a question first.";
  }
  if (status === 400 || status === 422) {
    return "Nothing to send — start transcription or type a question first.";
  }
  if (status === 401) {
    return "You're signed out. Please sign in again.";
  }
  if (status === 403) {
    return "You don't have access. Please sign in again.";
  }
  if (status === 404) {
    return "AI service not available right now. Please try again.";
  }
  if (status === 408 || status === 504) {
    return "The AI took too long to respond. Please try again.";
  }
  if (status === 429) {
    return "Too many requests — please wait a moment and try again.";
  }
  if (status >= 500) {
    return "AI service hiccup — please try again in a moment.";
  }
  return DEFAULT_MESSAGE;
}

/**
 * Translate any thrown value (including `Error`, `Response`, or random
 * objects) into a friendly message. Strips network jargon so the UI never
 * shows raw `HTTP error! status: NNN` or `Failed to fetch`.
 */
export function humanizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return ""; // caller should ignore
    const msg = err.message;
    if (/quota[_\s-]?exceeded/i.test(msg)) {
      return humanizeQuotaExceeded();
    }
    // "HTTP error! status: 404" → extract status, humanize.
    const match = msg.match(/status:\s*(\d{3})/i);
    if (match) {
      const status = Number.parseInt(match[1], 10);
      if (Number.isFinite(status)) return humanizeHttpStatus(status);
    }
    if (/^Failed to fetch$|NetworkError|net::/i.test(msg)) {
      return "Network error — check your connection and try again.";
    }
    if (/Response body is null/i.test(msg)) {
      return "AI service returned an empty response. Please try again.";
    }
    if (/SSE buffer overflow/i.test(msg)) {
      return "Response was too large to read. Please try a shorter prompt.";
    }
    // Otherwise fall through to the message itself if it's already short
    // and human-ish; clamp length defensively to avoid leaking giant
    // server stacks into the UI.
    if (msg && msg.length < 160) return msg;
  }
  return DEFAULT_MESSAGE;
}
