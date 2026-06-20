/** CORS layer shared with Better Auth's trusted-origin allowlist. */

import { TRUSTED_ORIGINS as AUTH_TRUSTED_ORIGINS } from "../auth";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization,X-Requested-With";
const CORS_MAX_AGE = "86400";

/** Single source of truth for allowed origins, re-exported to Better Auth so
 *  CORS and the auth trusted-origin check never drift (previously the prod
 *  copilot domain was missing from Better Auth's allowlist). */
export const TRUSTED_ORIGINS: ReadonlySet<string> = new Set<string>(
  AUTH_TRUSTED_ORIGINS,
);

export function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowOrigin =
    origin && TRUSTED_ORIGINS.has(origin)
      ? origin
      : (TRUSTED_ORIGINS.values().next().value as string);

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  } satisfies Record<string, string>;
}

export function withCors(response: Response, request: Request): Response {
  const corsHeaders = buildCorsHeaders(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleOptions(request: Request): Response {
  const headers = buildCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers,
  });
}
