/** Module-level in-memory cache for provider health probes.
 *
 *  The cache is intentionally per-isolate — Cloudflare's request-isolate
 *  model means each instance has its own fresh map. That's fine: a brief
 *  cache miss after a deploy or cold-start is preferable to threading a
 *  KV namespace through every probe call. */

import { HEALTH_CACHE_TTL_MS } from "../constants";
import type { HealthCheckResult } from "../types";

const healthCache = new Map<string, { ts: number; result: HealthCheckResult }>();
const encoder = new TextEncoder();

export async function healthCacheKey(
  provider: string,
  parts: readonly string[],
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(parts)),
  );
  const fingerprint = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `${provider}:${fingerprint}`;
}

export function getCachedHealth(key: string): HealthCheckResult | null {
  const entry = healthCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > HEALTH_CACHE_TTL_MS) {
    healthCache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedHealth(key: string, result: HealthCheckResult) {
  healthCache.set(key, { ts: Date.now(), result });
}
