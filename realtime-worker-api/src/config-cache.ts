/**
 * Resolves the effective admin_config (dashboard settings + env fallbacks)
 * and caches it in the shared CONFIG_KV namespace. Without this, every
 * /api/completion and /api/deepgram request pays a D1 round-trip.
 *
 * CONFIG_KV is the worker's general-purpose KV (see src/kv-keys.ts) — this
 * module owns only the `admin_config:*` keys there. The KV binding is
 * optional: callers fall back to the D1 loader when env.CONFIG_KV is
 * undefined (local dev, first deploy before namespace id is pasted in, etc.).
 */

import { getDb } from "./db";
import { adminConfig } from "./db/schema";
import { KV, KV_TTL_SECONDS } from "./kv-keys";

export interface ResolvedConfig {
  geminiModel: string;
  geminiKey: string;
  deepgramKey: string;
  customModelName: string;
  customBaseUrl: string;
  customApiKey: string;
  useCustom: boolean;
  cfAccountId: string;
  cfGatewayId: string;
  cfApiToken: string;
}

export interface ConfigCacheEnv {
  DB: D1Database;
  CONFIG_KV?: KVNamespace;
  GEMINI_MODEL?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_API_TOKEN?: string;
}

const DEFAULT_CF_ACCOUNT_ID = "b4ca0337fb21e846c53e1f2611ba436c";
const DEFAULT_CF_GATEWAY_ID = "gateway04";

async function loadFromD1(env: ConfigCacheEnv): Promise<ResolvedConfig> {
  try {
    const db = getDb(env);
    const rows = await db.select().from(adminConfig);
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const customModelName = map.get("custom_model_name") || "";
    const customBaseUrl = map.get("custom_base_url") || "";
    const customApiKey = map.get("custom_api_key") || "";
    const useCustom = Boolean(customModelName && customBaseUrl && customApiKey);

    return {
      geminiModel: map.get("gemini_model") || env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      geminiKey: map.get("gemini_key") || env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: map.get("deepgram_key") || env.DEEPGRAM_API_KEY || "",
      customModelName,
      customBaseUrl,
      customApiKey,
      useCustom,
      cfAccountId: map.get("cf_account_id") || env.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID,
      cfGatewayId: map.get("cf_gateway_id") || env.CF_GATEWAY_ID || DEFAULT_CF_GATEWAY_ID,
      cfApiToken: map.get("cf_api_token") || env.CF_API_TOKEN || "",
    };
  } catch (err) {
    console.error("[config-cache] D1 load failed, falling back to env:", err);
    return {
      geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: env.DEEPGRAM_API_KEY || "",
      customModelName: "",
      customBaseUrl: "",
      customApiKey: "",
      useCustom: false,
      cfAccountId: env.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID,
      cfGatewayId: env.CF_GATEWAY_ID || DEFAULT_CF_GATEWAY_ID,
      cfApiToken: env.CF_API_TOKEN || "",
    };
  }
}

export async function getCachedConfig(env: ConfigCacheEnv): Promise<ResolvedConfig> {
  if (!env.CONFIG_KV) {
    return loadFromD1(env);
  }

  const key = KV.adminConfig();
  try {
    const cached = await env.CONFIG_KV.get<ResolvedConfig>(key, "json");
    if (cached && typeof cached === "object" && "geminiModel" in cached) {
      return cached;
    }
  } catch (err) {
    console.warn("[config-cache] KV read failed, falling back to D1:", err);
  }

  const fresh = await loadFromD1(env);
  try {
    await env.CONFIG_KV.put(key, JSON.stringify(fresh), {
      expirationTtl: KV_TTL_SECONDS.adminConfig,
    });
  } catch (err) {
    console.warn("[config-cache] KV write failed:", err);
  }
  return fresh;
}

/**
 * Wipe the cached admin_config entry. Call after any admin_config write so the
 * next request sees fresh values instead of waiting for the TTL.
 */
export async function invalidateConfigCache(env: ConfigCacheEnv): Promise<void> {
  if (!env.CONFIG_KV) return;
  try {
    await env.CONFIG_KV.delete(KV.adminConfig());
  } catch (err) {
    console.warn("[config-cache] KV delete failed:", err);
  }
}
