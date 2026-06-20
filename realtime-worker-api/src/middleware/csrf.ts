/** CSRF defence: cookies are SameSite=None so a malicious site COULD issue
 *  a cross-origin POST to our worker with the user's session cookie. We
 *  block any state-changing request whose Origin is not in our trusted
 *  list. Same-origin requests from the Electron build send `null`
 *  (file://) — we let those through.
 *
 *  Defense-in-depth: mutating /api/* (except /api/auth/*) must also send
 *  X-Requested-With: RIC-Desktop from our desktop client. */

import { TRUSTED_ORIGINS } from "./cors";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const RIC_CLIENT_HEADER = "RIC-Desktop";

export type CsrfFailureReason = "forbidden_origin" | "missing_client_header";

export function csrfCheck(request: Request): CsrfFailureReason | null {
  if (!STATE_CHANGING_METHODS.has(request.method)) return null;

  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== "null" && !TRUSTED_ORIGINS.has(origin)) {
    return "forbidden_origin";
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path.startsWith("/api/") && !path.startsWith("/api/auth")) {
    const clientHeader = request.headers.get("X-Requested-With");
    if (clientHeader !== RIC_CLIENT_HEADER) {
      return "missing_client_header";
    }
  }

  return null;
}

/** @deprecated use csrfCheck — kept for tests */
export function originIsTrusted(request: Request): boolean {
  return csrfCheck(request) === null;
}
