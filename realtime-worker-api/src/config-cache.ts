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

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { adminConfig, userModelParams } from "./db/schema";
import { KV, KV_TTL_SECONDS } from "./kv-keys";
import adminCfg from "./config.json";

export type ThinkingBudget = "off" | "low" | "medium" | "high";

export interface ModelParams {
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  thinkingBudget: ThinkingBudget;
}

const THINKING_VALUES = ["off", "low", "medium", "high"] as const;

function parseThinking(v: string | undefined): ThinkingBudget {
  return (THINKING_VALUES as readonly string[]).includes(v ?? "")
    ? (v as ThinkingBudget)
    : (adminCfg.modelParams.defaults.thinkingBudget as ThinkingBudget);
}

function parseIntInRange(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = v !== undefined ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseFloatInRange(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = v !== undefined ? Number.parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function globalModelParamsFromMap(map: Map<string, string>): ModelParams {
  const d = adminCfg.modelParams.defaults;
  const r = adminCfg.modelParams.ranges;
  return {
    maxOutputTokens: parseIntInRange(map.get("model_max_output_tokens"), r.maxOutputTokens.min, r.maxOutputTokens.max, d.maxOutputTokens),
    temperature: parseFloatInRange(map.get("model_temperature"), r.temperature.min, r.temperature.max, d.temperature),
    topP: parseFloatInRange(map.get("model_top_p"), r.topP.min, r.topP.max, d.topP),
    thinkingBudget: parseThinking(map.get("model_thinking_budget")),
  };
}

// Shape validator for anything we read back from KV. We strip secret fields
// from what we cache and require callers to re-fetch those from D1 each
// request — an attacker who compromises KV should not get keys for free.
const NonSecretConfigSchema = z.object({
  geminiModel: z.string(),
  customModelName: z.string(),
  customBaseUrl: z.string(),
  useCustom: z.boolean(),
  cfAccountId: z.string(),
  cfGatewayId: z.string(),
  modelMaxOutputTokens: z.number().int(),
  modelTemperature: z.number(),
  modelTopP: z.number(),
  modelThinkingBudget: z.enum(THINKING_VALUES),
});
type NonSecretConfig = z.infer<typeof NonSecretConfigSchema>;

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
  modelMaxOutputTokens: number;
  modelTemperature: number;
  modelTopP: number;
  modelThinkingBudget: ThinkingBudget;
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
    const mp = globalModelParamsFromMap(map);

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
      modelMaxOutputTokens: mp.maxOutputTokens,
      modelTemperature: mp.temperature,
      modelTopP: mp.topP,
      modelThinkingBudget: mp.thinkingBudget,
    };
  } catch (err) {
    console.error("[config-cache] D1 load failed, falling back to env:", err);
    const d = adminCfg.modelParams.defaults;
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
      modelMaxOutputTokens: d.maxOutputTokens,
      modelTemperature: d.temperature,
      modelTopP: d.topP,
      modelThinkingBudget: d.thinkingBudget as ThinkingBudget,
    };
  }
}

export async function getCachedConfig(env: ConfigCacheEnv): Promise<ResolvedConfig> {
  if (!env.CONFIG_KV) {
    return loadFromD1(env);
  }

  const key = KV.adminConfig();
  // KV only stores the non-secret shape; secret fields are loaded from D1
  // every request. We still strictly validate what we read back — a
  // malformed / truncated JSON blob must not reach the hot path.
  let cachedNonSecret: NonSecretConfig | null = null;
  try {
    const raw = await env.CONFIG_KV.get<unknown>(key, "json");
    if (raw) {
      const parsed = NonSecretConfigSchema.safeParse(raw);
      if (parsed.success) {
        cachedNonSecret = parsed.data;
      } else {
        console.warn("[config-cache] KV blob failed schema; refreshing");
      }
    }
  } catch (err) {
    console.warn("[config-cache] KV read failed, falling back to D1:", err);
  }

  if (cachedNonSecret) {
    // We always hit D1 for the secret columns so they never live in KV.
    const fresh = await loadFromD1(env);
    return {
      ...fresh,
      geminiModel: cachedNonSecret.geminiModel,
      customModelName: cachedNonSecret.customModelName,
      customBaseUrl: cachedNonSecret.customBaseUrl,
      useCustom: cachedNonSecret.useCustom,
      cfAccountId: cachedNonSecret.cfAccountId,
      cfGatewayId: cachedNonSecret.cfGatewayId,
      modelMaxOutputTokens: cachedNonSecret.modelMaxOutputTokens,
      modelTemperature: cachedNonSecret.modelTemperature,
      modelTopP: cachedNonSecret.modelTopP,
      modelThinkingBudget: cachedNonSecret.modelThinkingBudget,
    };
  }

  const fresh = await loadFromD1(env);
  const nonSecret: NonSecretConfig = {
    geminiModel: fresh.geminiModel,
    customModelName: fresh.customModelName,
    customBaseUrl: fresh.customBaseUrl,
    useCustom: fresh.useCustom,
    cfAccountId: fresh.cfAccountId,
    cfGatewayId: fresh.cfGatewayId,
    modelMaxOutputTokens: fresh.modelMaxOutputTokens,
    modelTemperature: fresh.modelTemperature,
    modelTopP: fresh.modelTopP,
    modelThinkingBudget: fresh.modelThinkingBudget,
  };
  try {
    await env.CONFIG_KV.put(key, JSON.stringify(nonSecret), {
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

/**
 * Returns the effective model generation params for a given user, merging
 * per-user overrides (from `user_model_params`) on top of the global
 * defaults from admin_config. Any NULL column in the override row means
 * "inherit from global".
 *
 * Called on every /api/completion request, so the KV-backed
 * `getCachedConfig` is reused for the global side and only the per-user
 * row is fetched from D1.
 */
export async function getEffectiveModelParams(
  env: ConfigCacheEnv,
  userId: string | null | undefined,
): Promise<ModelParams> {
  const cfg = await getCachedConfig(env);
  const globals: ModelParams = {
    maxOutputTokens: cfg.modelMaxOutputTokens,
    temperature: cfg.modelTemperature,
    topP: cfg.modelTopP,
    thinkingBudget: cfg.modelThinkingBudget,
  };
  if (!userId) return globals;

  try {
    const db = getDb(env);
    const [row] = await db
      .select()
      .from(userModelParams)
      .where(eq(userModelParams.userId, userId));
    if (!row) return globals;

    const r = adminCfg.modelParams.ranges;
    return {
      maxOutputTokens:
        row.maxOutputTokens != null
          ? Math.min(r.maxOutputTokens.max, Math.max(r.maxOutputTokens.min, Math.trunc(row.maxOutputTokens)))
          : globals.maxOutputTokens,
      temperature:
        row.temperature != null
          ? Math.min(r.temperature.max, Math.max(r.temperature.min, row.temperature))
          : globals.temperature,
      topP:
        row.topP != null
          ? Math.min(r.topP.max, Math.max(r.topP.min, row.topP))
          : globals.topP,
      thinkingBudget:
        row.thinkingBudget && (THINKING_VALUES as readonly string[]).includes(row.thinkingBudget)
          ? (row.thinkingBudget as ThinkingBudget)
          : globals.thinkingBudget,
    };
  } catch (err) {
    console.warn("[config-cache] user model params lookup failed:", err);
    return globals;
  }
}
