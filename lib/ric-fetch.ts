/**
 * Authenticated API fetch for mutating /api/* calls from the Electron renderer.
 * Sends X-Requested-With so the worker CSRF gate can distinguish our client
 * from cross-site form posts.
 */
import {
  clearStoredSessionToken,
  getStoredSessionToken,
} from "@/lib/auth-client";
import { notifySessionExpired } from "@/lib/auth-events";
import { BACKEND_API_URL } from "@/lib/constant";

export const RIC_CLIENT_HEADER = "RIC-Desktop";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function ricFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const bearerToken = getStoredSessionToken();
  if (bearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  if (
    MUTATING.has(method) &&
    path.startsWith("/api/") &&
    !path.startsWith("/api/auth")
  ) {
    headers.set("X-Requested-With", RIC_CLIENT_HEADER);
  }
  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${BACKEND_API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  }).then((res) => {
    // A 401 outside the auth endpoints means the session expired
    // mid-use — tell the AuthGuard so the user lands on sign-in.
    if (res.status === 401 && !path.startsWith("/api/auth")) {
      clearStoredSessionToken();
      notifySessionExpired();
    }
    return res;
  });
}
