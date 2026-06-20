/** Shared sessionStorage keys for data that must survive compact ↔ full toggles. */

export const APP_SESSION_KEYS = {
  completion: "app-copilot-completion",
  flag: "app-copilot-flag",
  outputMode: "app-copilot-output-mode",
  askChat: "app-ask-chat-messages",
  interviewDraft: "app-interview-context-draft",
} as const;

const LEGACY_KEYS = {
  completion: "compact-completion",
  flag: "compact-last-flag",
  outputMode: "compact-output-mode",
  askChat: "compact-chat-messages",
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

/** Copy compact-era keys forward once so existing sessions keep their data. */
export function migrateLegacySessionKeys() {
  if (typeof window === "undefined") return;
  const pairs: [string, string][] = [
    [APP_SESSION_KEYS.completion, LEGACY_KEYS.completion],
    [APP_SESSION_KEYS.flag, LEGACY_KEYS.flag],
    [APP_SESSION_KEYS.outputMode, LEGACY_KEYS.outputMode],
    [APP_SESSION_KEYS.askChat, LEGACY_KEYS.askChat],
  ];
  for (const [next, legacy] of pairs) {
    if (!readAppSession(next) && readAppSession(legacy)) {
      writeAppSession(next, readAppSession(legacy));
    }
  }
}
