/**
 * Client-side cache for the user's BYOK ("bring your own keys") runtime
 * configuration.
 *
 * Design contract:
 *   - The decrypted token is held ONLY in module-level memory; we never
 *     persist it to localStorage / sessionStorage / IndexedDB.
 *   - The cache lives until the page is closed or `clearByokConfig()` is
 *     called (e.g. after the user logs out, deletes a credential, or
 *     toggles BYOK off).
 *   - When BYOK is disabled by the feature flag the worker returns 403
 *     `feature_flag_disabled`; we cache the "off" state so subsequent
 *     callers don't re-hit the API on every render.
 *
 * Consumers:
 *   - `components/recorder.tsx`            uses `getByokConfig().deepgram`
 *   - `components/copilot.tsx`             uses `getByokConfig().openai`
 *   - `components/QuestionAssistant.tsx`   uses `getByokConfig().openai`
 *   - `app/settings/byok/page.tsx`         calls `clearByokConfig()` after save
 */

import { BACKEND_API_URL } from "@/lib/constant";

export interface ByokDeepgramConfig {
  baseUrl: string;
  host: string;
  token: string;
}

export interface ByokOpenAIConfig {
  baseUrl: string;
  host: string;
  token: string;
  modelName: string | null;
}

export interface ByokRuntimeConfig {
  deepgram: ByokDeepgramConfig | null;
  openai: ByokOpenAIConfig | null;
  enabled: boolean;
}

const EMPTY_CONFIG: ByokRuntimeConfig = {
  deepgram: null,
  openai: null,
  enabled: false,
};

let cached: ByokRuntimeConfig | null = null;
let inflight: Promise<ByokRuntimeConfig> | null = null;

async function fetchOnce(): Promise<ByokRuntimeConfig> {
  try {
    const res = await fetch(`${BACKEND_API_URL}/api/byok/runtime-config`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 403) {
      // Feature flag disabled — cache "off" so we don't keep retrying.
      return { ...EMPTY_CONFIG, enabled: false };
    }
    if (!res.ok) {
      // Treat any other non-OK as a soft failure: BYOK is unavailable for
      // this session but we do not block the worker fallback.
      return { ...EMPTY_CONFIG, enabled: false };
    }
    const json = (await res.json()) as {
      deepgram: ByokDeepgramConfig | null;
      openai: ByokOpenAIConfig | null;
    };
    return {
      enabled: true,
      deepgram: json.deepgram,
      openai: json.openai,
    };
  } catch {
    return { ...EMPTY_CONFIG, enabled: false };
  }
}

/**
 * Returns the user's BYOK runtime config, fetching from the worker on the
 * first call (and on every call after `clearByokConfig()`). All concurrent
 * callers share a single inflight request.
 */
export async function getByokConfig(): Promise<ByokRuntimeConfig> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetchOnce().then((value) => {
    cached = value;
    inflight = null;
    return value;
  });
  return inflight;
}

/** Drop the in-memory cache (call after settings save / logout). */
export function clearByokConfig(): void {
  cached = null;
  inflight = null;
}

export function getCachedByokConfig(): ByokRuntimeConfig | null {
  return cached;
}
