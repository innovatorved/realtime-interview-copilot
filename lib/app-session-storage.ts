/** Shared sessionStorage keys for data that must survive compact ↔ full toggles. */

export const APP_SESSION_KEYS = {
  completion: "app-copilot-completion",
  flag: "app-copilot-flag",
  outputMode: "app-copilot-output-mode",
  askChat: "app-ask-chat-messages",
  interviewDraft: "app-interview-context-draft",
} as const;

export function readAppSession(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeAppSession(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* quota / unavailable */
  }
}
