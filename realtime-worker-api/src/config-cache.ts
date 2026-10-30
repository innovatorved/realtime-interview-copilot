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

/** Single source of truth for the fallback model when neither the
 *  dashboard nor env specifies one. gemini-2.5-flash-lite retires
 *  Oct 2026 — keep this pinned to a supported model. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

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

function globalModelParamsFromMap(map: Map<string, string>): ModelParams {
  const d = adminCfg.modelParams.defaults;
  const r = adminCfg.modelParams.ranges;
  return {
    maxOutputTokens: parseIntInRange(map.get("model_max_output_tokens"), r.maxOutputTokens.min, r.maxOutputTokens.max, d.maxOutputTokens),
    temperature: parseFloatInRange(map.get("model_temperature"), r.temperature.min, r.temperature.max, d.temperature),
    topP: parseFloatInRange(map.get("model_top_p"), r.topP.min, r.topP.max, d.topP),
    thinkingBudget: parseThinking(map.get("model_thinking_budget")),
  };
}

// Shape validator for anything we read back from KV. Secret fields are stored
// as AES-GCM ciphertexts (`enc:v1:<ivHex>:<cipherHex>`) derived from
// BETTER_AUTH_SECRET so a KV read hit never needs a D1 round-trip.
const CachedConfigSchema = z.object({
  geminiModel: z.string(),
  customModelName: z.string(),
  customBaseUrl: z.string(),
  useCustom: z.boolean(),
  provider: z.enum(["gemini", "openai"]).optional().default("gemini"),
  cfAccountId: z.string(),
  cfGatewayId: z.string(),
  modelMaxOutputTokens: z.number().int(),
  modelTemperature: z.number(),
  modelTopP: z.number(),
  modelThinkingBudget: z.enum(THINKING_VALUES),
  encGeminiKey: z.string(),
  encDeepgramKey: z.string(),
  encCustomApiKey: z.string(),
  encCfApiToken: z.string(),
});
type CachedConfig = z.infer<typeof CachedConfigSchema>;

export interface ResolvedConfig {
  geminiModel: string;
  geminiKey: string;
  deepgramKey: string;
  customModelName: string;
  customBaseUrl: string;
  customApiKey: string;
  useCustom: boolean;
  provider: Provider;
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
  BETTER_AUTH_SECRET?: string;
  GEMINI_MODEL?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_API_TOKEN?: string;
}

const ENC_PREFIX = "enc:v1:";
let cachedAesKeySecret: string | null = null;
let cachedAesKey: CryptoKey | null = null;

async function getKvCipherKey(secret: string | undefined): Promise<CryptoKey> {
  const material = secret || "ric-config-kv-default-secret";
  if (cachedAesKey && cachedAesKeySecret === material) {
    return cachedAesKey;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  cachedAesKeySecret = material;
  cachedAesKey = key;
  return key;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

export async function encryptSecretForKv(
  plaintext: string,
  envSecret: string | undefined,
): Promise<string> {
  if (!plaintext) return "";
  const key = await getKvCipherKey(envSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipherBuf))}`;
}

async function decryptSecretFromKv(
  payload: string,
  envSecret: string | undefined,
): Promise<string | null> {
  if (!payload) return "";
  if (!payload.startsWith(ENC_PREFIX)) return null;
  const rest = payload.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const iv = hexToBytes(rest.slice(0, sep));
  const cipher = hexToBytes(rest.slice(sep + 1));
  if (!iv || !cipher || iv.length !== 12) return null;
  try {
    const key = await getKvCipherKey(envSecret);
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}

const DEFAULT_CF_ACCOUNT_ID = "b4ca0337fb21e846c53e1f2611ba436c";
const DEFAULT_CF_GATEWAY_ID = "gateway04";

export type Provider = "gemini" | "openai";

/**
 * Resolve the active AI provider from an admin_config key/value map.
 * Defaults to "gemini" — the OpenAI-compatible path only runs when an
 * admin has explicitly switched to it AND all three custom_* credentials
 * are present (see `isCustomActive`). Pure function; unit-testable.
 */
export function resolveProvider(map: Map<string, string>): Provider {
  return map.get("active_provider") === "openai" ? "openai" : "gemini";
}

/** Whether the OpenAI-compatible path should actually serve completions. */
export function isCustomActive(map: Map<string, string>): boolean {
  if (resolveProvider(map) !== "openai") return false;
  return Boolean(
    map.get("custom_model_name") &&
      map.get("custom_base_url") &&
      map.get("custom_api_key"),
  );
}

async function loadFromD1(env: ConfigCacheEnv): Promise<ResolvedConfig> {
  try {
    const db = getDb(env);
    const rows = await db.select().from(adminConfig);
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const customModelName = map.get("custom_model_name") || "";
    const customBaseUrl = map.get("custom_base_url") || "";
    const customApiKey = map.get("custom_api_key") || "";
    const useCustom = isCustomActive(map);
    const mp = globalModelParamsFromMap(map);

    return {
      geminiModel: map.get("gemini_model") || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      geminiKey: map.get("gemini_key") || env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: map.get("deepgram_key") || env.DEEPGRAM_API_KEY || "",
      customModelName,
      customBaseUrl,
      customApiKey,
      useCustom,
      provider: resolveProvider(map),
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
      geminiModel: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: env.DEEPGRAM_API_KEY || "",
      customModelName: "",
      customBaseUrl: "",
      customApiKey: "",
      useCustom: false,
      provider: "gemini",
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

const MEMORY_CONFIG_TTL_MS = 30_000;
let memoryConfigCache: { ts: number; cfg: ResolvedConfig } | null = null;

export async function getCachedConfig(env: ConfigCacheEnv): Promise<ResolvedConfig> {
  if (memoryConfigCache && Date.now() - memoryConfigCache.ts < MEMORY_CONFIG_TTL_MS) {
    return memoryConfigCache.cfg;
  }

  if (!env.CONFIG_KV) {
    const fresh = await loadFromD1(env);
    memoryConfigCache = { ts: Date.now(), cfg: fresh };
    return fresh;
  }

  const key = KV.adminConfig();
  let cachedBlob: CachedConfig | null = null;
  try {
    const raw = await env.CONFIG_KV.get<unknown>(key, "json");
    if (raw) {
      const parsed = CachedConfigSchema.safeParse(raw);
      if (parsed.success) {
        cachedBlob = parsed.data;
      } else {
        console.warn("[config-cache] KV blob failed schema; refreshing");
      }
    }
  } catch (err) {
    console.warn("[config-cache] KV read failed, falling back to D1:", err);
  }

  if (cachedBlob) {
    const [geminiKey, deepgramKey, customApiKey, cfApiToken] = await Promise.all([
      decryptSecretFromKv(cachedBlob.encGeminiKey, env.BETTER_AUTH_SECRET),
      decryptSecretFromKv(cachedBlob.encDeepgramKey, env.BETTER_AUTH_SECRET),
      decryptSecretFromKv(cachedBlob.encCustomApiKey, env.BETTER_AUTH_SECRET),
      decryptSecretFromKv(cachedBlob.encCfApiToken, env.BETTER_AUTH_SECRET),
    ]);

    if (
      geminiKey !== null &&
      deepgramKey !== null &&
      customApiKey !== null &&
      cfApiToken !== null
    ) {
      const resolved: ResolvedConfig = {
        geminiModel: cachedBlob.geminiModel,
        geminiKey: geminiKey || env.GOOGLE_GENERATIVE_AI_API_KEY || "",
        deepgramKey: deepgramKey || env.DEEPGRAM_API_KEY || "",
        customModelName: cachedBlob.customModelName,
        customBaseUrl: cachedBlob.customBaseUrl,
        customApiKey,
        useCustom: cachedBlob.useCustom,
        provider: cachedBlob.provider,
        cfAccountId: cachedBlob.cfAccountId,
        cfGatewayId: cachedBlob.cfGatewayId,
        cfApiToken: cfApiToken || env.CF_API_TOKEN || "",
        modelMaxOutputTokens: cachedBlob.modelMaxOutputTokens,
        modelTemperature: cachedBlob.modelTemperature,
        modelTopP: cachedBlob.modelTopP,
        modelThinkingBudget: cachedBlob.modelThinkingBudget,
      };
      memoryConfigCache = { ts: Date.now(), cfg: resolved };
      return resolved;
    }
    console.warn("[config-cache] KV secret decryption failed; refreshing from D1");
  }

  const fresh = await loadFromD1(env);
  try {
    const [encGeminiKey, encDeepgramKey, encCustomApiKey, encCfApiToken] =
      await Promise.all([
        encryptSecretForKv(fresh.geminiKey, env.BETTER_AUTH_SECRET),
        encryptSecretForKv(fresh.deepgramKey, env.BETTER_AUTH_SECRET),
        encryptSecretForKv(fresh.customApiKey, env.BETTER_AUTH_SECRET),
        encryptSecretForKv(fresh.cfApiToken, env.BETTER_AUTH_SECRET),
      ]);
    const toCache: CachedConfig = {
      geminiModel: fresh.geminiModel,
      customModelName: fresh.customModelName,
      customBaseUrl: fresh.customBaseUrl,
      useCustom: fresh.useCustom,
      provider: fresh.provider,
      cfAccountId: fresh.cfAccountId,
      cfGatewayId: fresh.cfGatewayId,
      modelMaxOutputTokens: fresh.modelMaxOutputTokens,
      modelTemperature: fresh.modelTemperature,
      modelTopP: fresh.modelTopP,
      modelThinkingBudget: fresh.modelThinkingBudget,
      encGeminiKey,
      encDeepgramKey,
      encCustomApiKey,
      encCfApiToken,
    };
    await env.CONFIG_KV.put(key, JSON.stringify(toCache), {
      expirationTtl: KV_TTL_SECONDS.adminConfig,
    });
  } catch (err) {
    console.warn("[config-cache] KV write failed:", err);
  }
  memoryConfigCache = { ts: Date.now(), cfg: fresh };
  return fresh;
}

/**
 * Wipe the cached admin_config entry. Call after any admin_config write so the
 * next request sees fresh values instead of waiting for the TTL.
 */
export async function invalidateConfigCache(env: ConfigCacheEnv): Promise<void> {
  memoryConfigCache = null;
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
  resolvedCfg?: ResolvedConfig,
): Promise<ModelParams> {
  const cfg = resolvedCfg ?? (await getCachedConfig(env));
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
