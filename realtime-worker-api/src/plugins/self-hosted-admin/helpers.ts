/** Pure helpers (no closure deps) used across endpoints. */

import { APIError } from "better-auth/api";
import {
  DEFAULT_LIMIT,
  DISPOSABLE_DOMAINS,
  MAX_LIMIT,
  MAX_QUERY_LEN,
  SECRET_KEY_SUFFIXES,
  USAGE_WINDOW_MS,
} from "./constants";
import { usageWindowQuerySchema } from "./query-schemas";

export function getUserAgentStr(headers: Headers | undefined): string | null {
  return headers?.get("user-agent") ?? null;
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}

export function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function parseOffset(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Parse the `?window=` query param, defaulting to 30d. Throws a BAD_REQUEST
 *  for unknown values so clients learn about typos instead of silently
 *  getting the wrong data. */
export function resolveUsageWindow(raw: string | null): {
  window: string;
  since: Date;
} {
  const windowParsed = usageWindowQuerySchema.safeParse(raw ?? undefined);
  const key = windowParsed.success && windowParsed.data ? windowParsed.data : (raw ?? "30d").trim();
  const ms = USAGE_WINDOW_MS[key];
  if (!ms) {
    throw new APIError("BAD_REQUEST", {
      message: "window must be one of 1h, 24h, 7d, 30d, 90d",
    });
  }
  return { window: key, since: new Date(Date.now() - ms) };
}

export function sanitizeSearch(q: string | null): string | null {
  if (q === null || q === undefined) return null;
  const t = q.trim();
  if (t.length === 0) return null;
  return t.slice(0, MAX_QUERY_LEN);
}

export function isSecretConfigKey(key: string): boolean {
  return SECRET_KEY_SUFFIXES.some((s) => key.endsWith(s));
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Detect masked placeholders (from GET /config or the admin UI) so we never
 *  persist them as real secrets. */
export function isDisplayMaskedSecret(value: string): boolean {
  return value.includes("…") || value.includes("...");
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

/** Parse and validate admin GET query params with Zod. Throws BAD_REQUEST on failure. */
export function parseAdminQuery<T extends import("zod").ZodTypeAny>(
  url: URL,
  schema: T,
  fields: readonly string[],
): import("zod").infer<T> {
  const input: Record<string, string | undefined> = {};
  for (const field of fields) {
    const raw = url.searchParams.get(field);
    input[field] = raw === null || raw === "" ? undefined : raw;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new APIError("BAD_REQUEST", { message: formatZodError(parsed.error) });
  }
  return parsed.data;
}
