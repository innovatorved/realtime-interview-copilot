/** CSRF defence: cookies are SameSite=None so a malicious site COULD issue
 *  a cross-origin POST to our worker with the user's session cookie. We
 *  block any state-changing request whose Origin is not in our trusted
 *  list. Same-origin requests from the Electron build send `null`
 *  (file://) — we let those through. */

import { TRUSTED_ORIGINS } from "./cors";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function originIsTrusted(request: Request): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return true;
  const origin = request.headers.get("Origin");
  // Browsers always send Origin on cross-site POSTs from script. The
  // Electron renderer sends "null" (file://) which is fine — that's not
  // attacker-controllable from the web.
  if (origin === null || origin === "null") return true;
  return TRUSTED_ORIGINS.has(origin);
}
