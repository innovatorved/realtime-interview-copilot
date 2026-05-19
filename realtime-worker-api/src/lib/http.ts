/** Shared HTTP helpers — JSON response factory, common error responses,
 *  and the byte encoder used by streaming routes. */

import { WorkerError } from "./errors";

export const jsonHeaders = {
  "content-type": "application/json",
};

export const encoder = new TextEncoder();

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

/** Shortcut response factories. The body shape (single `error` string) is
 *  the existing contract — callers can keep using `jsonResponse({ error })`
 *  directly when they want a custom message. */
export function unauthorized(message = "Unauthorized"): Response {
  return jsonResponse({ error: message }, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return jsonResponse({ error: message }, 403);
}

export function notFound(message = "Not found"): Response {
  return jsonResponse({ error: message }, 404);
}

export function methodNotAllowed(message = "Method not allowed"): Response {
  return jsonResponse({ error: message }, 405);
}

/** Translate a thrown `WorkerError` to the canonical `{ error }` JSON
 *  envelope. Unknown errors get a generic 500 — never leak `e.message`
 *  to clients for non-`WorkerError` throws. */
export function workerErrorToResponse(err: unknown): Response {
  if (err instanceof WorkerError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  return jsonResponse({ error: "Internal error" }, 500);
}
