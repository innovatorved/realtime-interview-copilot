import { createAuthClient } from "better-auth/react";
import { BACKEND_API_URL } from "./constant";

const SESSION_TOKEN_STORAGE_KEY = "ric_bearer_token";

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    /* ignore storage errors */
  }
}

export function clearStoredSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
}

export const authClient = createAuthClient({
  baseURL: `${BACKEND_API_URL}/api/auth`,
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => getStoredSessionToken() ?? "",
    },
  },
  trustedOrigins: [
    "null",
    "file://",
    "http://localhost:3000",
    "https://sso.vedgupta.in",
    "https://realtime-worker-api-prod.vedgupta.in",
  ],
});

export async function signOutAndTrack(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    /* ignore sign-out network errors */
  } finally {
    clearStoredSessionToken();
    window.dispatchEvent(new Event("auth:logout"));
  }
}
