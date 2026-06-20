/**
 * Authenticated API fetch for mutating /api/* calls from the Electron renderer.
 * Sends X-Requested-With so the worker CSRF gate can distinguish our client
 * from cross-site form posts.
 */
import { BACKEND_API_URL } from "@/lib/constant";

export const RIC_CLIENT_HEADER = "RIC-Desktop";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function ricFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
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
  });
}
