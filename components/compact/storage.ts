/** sessionStorage keys and helpers for the compact surface.
 *
 *  The transcription itself lives in TranscriptionProvider so it doesn't
 *  need surface-level persistence. The chat thread is keyed under
 *  `compact-chat-messages` and is owned by the `useAskChat` hook — when
 *  restoring it on mount the hook reads that key directly. */

export const STORAGE_KEYS = {
  completion: "compact-completion",
  lastFlag: "compact-last-flag",
  outputMode: "compact-output-mode",
  chatMessages: "compact-chat-messages",
} as const;

export function readSession(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeSession(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* quota / unavailable — non-fatal */
  }
}
