/**
 * self-hosted-admin — A Better Auth plugin that replicates Better Auth
 * Infrastructure features (dash + sentinel + audit logs) entirely
 * self-hosted on Cloudflare Workers + D1.
 *
 * Features:
 *   • Schema: adds isBanned, banReason, lastActiveAt to `user`, plus
 *     auditEvent, securityEvent, rateLimitEntry tables.
 *   • Hooks: auto-logs sign-up/sign-in/sign-out audit events, blocks
 *     banned users, enforces rate limits, blocks disposable emails.
 *   • Endpoints: admin-gated APIs at /self-hosted-admin/* for the
 *     admin dashboard to consume.
 *
 * Usage:
 *   import { selfHostedAdmin } from "./plugins/self-hosted-admin";
 *
 *   betterAuth({
 *     plugins: [
 *       selfHostedAdmin({
 *         getDb: () => drizzleDb,
 *         env,
 *         adminEmails: ["admin@example.com"],
 *       }),
 *     ],
 *   })
 */

import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, createAuthEndpoint, sessionMiddleware, APIError } from "better-auth/api";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  account,
  auditEvent,
  securityEvent,
  rateLimitEntry,
  user,
  session,
  adminConfig,
  savedNote,
  interviewPreset,
} from "../db/schema";
import type * as schemaTypes from "../db/schema";
import { count, desc, eq, gte, like, or, and, lt, asc } from "drizzle-orm";
import { z } from "zod";
import adminCfg from "../config.json";
import { validateOutboundUrl } from "../url-guard";

// ─── Central Config ─────────────────────────────────────────────────────────

const DISPOSABLE_DOMAINS = new Set(adminCfg.sentinel.disposableDomains);
const RATE_LIMIT_WINDOW_MS = adminCfg.sentinel.rateLimits.windowMs;
const ALLOWED_CONFIG_KEYS = adminCfg.allowedConfigKeys as readonly string[];

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const safeIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

const updateUserSchema = z.object({
  userId: safeIdSchema,
  isApproved: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().max(500).optional(),
});

const deleteUserSchema = z.object({
  userId: safeIdSchema,
});

const revokeSessionSchema = z.object({
  sessionId: safeIdSchema,
});

const revokeAllSessionsSchema = z.object({
  userId: safeIdSchema,
});

const configKeyEnum = z.enum(ALLOWED_CONFIG_KEYS as [string, ...string[]]);

const updateConfigSchema = z.object({
  key: configKeyEnum,
  value: z.string().min(1).max(500),
});

const deleteConfigSchema = z.object({
  key: configKeyEnum,
});

const testModelSchema = z.object({
  modelName: z.string().min(1).max(200),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().min(1).max(500),
});

const bulkUserIdsSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
});

const bulkApproveSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
  approve: z.boolean(),
});

const bulkBanSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
  ban: z.boolean(),
  banReason: z.string().max(500).optional(),
});

const adminDeleteNoteSchema = z.object({
  noteId: safeIdSchema,
});

const adminCreatePresetSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  context: z.string().min(1).max(5000),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  isBuiltIn: z.boolean().optional(),
});

const adminUpdatePresetSchema = z.object({
  presetId: safeIdSchema,
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  context: z.string().min(1).max(5000).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
});

const adminDeletePresetSchema = z.object({
  presetId: safeIdSchema,
});

const revealConfigSchema = z.object({
  key: configKeyEnum,
});

// Upstream fetches performed on behalf of an admin should never hang a
// request. All admin-triggered outbound calls share this timeout.
const ADMIN_FETCH_TIMEOUT_MS = 10_000;
const SECRET_KEY_SUFFIXES = ["_key", "_token", "_api_key", "_secret"] as const;

function isSecretConfigKey(key: string): boolean {
  return SECRET_KEY_SUFFIXES.some((s) => key.endsWith(s));
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// ─── AI Gateway / Health schemas ──────────────────────────────────────────

const HEALTH_CACHE_TTL_MS = 30_000;

// Allow-list prevents SSRF / header injection by forwarding only known keys.
const AI_GATEWAY_LOG_QUERY_KEYS = [
  "page",
  "per_page",
  "start_date",
  "end_date",
  "provider",
  "model",
  "model_type",
  "success",
  "cached",
  "search",
  "order_by",
  "order_by_direction",
  "direction",
  "min_duration",
  "max_duration",
  "min_cost",
  "max_cost",
  "min_tokens_in",
  "max_tokens_in",
  "min_tokens_out",
  "max_tokens_out",
  "min_total_tokens",
  "max_total_tokens",
  "feedback",
  "meta_info",
] as const;

const SUMMARY_WINDOW_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

// ─── Types ─────────────────────────────────────────────────────────────────

export type AuditEventType =
  | "user_signed_up"
  | "user_signed_in"
  | "user_signed_out"
  | "user_profile_updated"
  | "user_email_verified"
  | "user_banned"
  | "user_unbanned"
  | "user_deleted"
  | "user_approved"
  | "user_approval_revoked"
  | "session_created"
  | "session_revoked"
  | "sessions_revoked_all"
  | "password_changed"
  | "password_reset_requested"
  | "password_reset_completed"
  | "security_blocked"
  | "security_rate_limited"
  | "security_disposable_email"
  | "security_credential_stuffing"
  | "admin_action";

export type SecurityAction = "log" | "challenge" | "block";

export type SecurityEventType =
  | "credential_stuffing"
  | "rate_limit_exceeded"
  | "disposable_email"
  | "suspicious_ip"
  | "velocity_exceeded";

export interface SelfHostedAdminOptions {
  getDb: () => DrizzleD1Database<typeof schemaTypes>;
  d1: D1Database;
  adminEmails: string[];
  sentinel?: {
    maxLoginAttemptsPerHour?: number;
    maxSignupsPerHour?: number;
    blockDisposableEmails?: boolean;
  };
  runtimeInfo?: () => Record<string, unknown>;
  /** Invoked whenever admin_config is written/deleted so KV caches can flush. */
  onConfigChange?: () => Promise<void> | void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getClientIp(headers: Headers | undefined): string | null {
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

function getUserAgentStr(headers: Headers | undefined): string | null {
  return headers?.get("user-agent") ?? null;
}


function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_QUERY_LEN = 120;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}
function parseOffset(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}
function sanitizeSearch(q: string | null): string | null {
  if (q === null || q === undefined) return null;
  const t = q.trim();
  if (t.length === 0) return null;
  return t.slice(0, MAX_QUERY_LEN);
}

// ─── Module-level caches ───────────────────────────────────────────────────

interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  lastProbe: string;
  source?: string;
  configured?: boolean;
  accountConfigured?: boolean;
  gatewayConfigured?: boolean;
}
const healthCache = new Map<string, { ts: number; result: HealthCheckResult }>();

function getCachedHealth(key: string): HealthCheckResult | null {
  const entry = healthCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > HEALTH_CACHE_TTL_MS) {
    healthCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedHealth(key: string, result: HealthCheckResult) {
  healthCache.set(key, { ts: Date.now(), result });
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const selfHostedAdmin = (opts: SelfHostedAdminOptions) => {
  const maxLogins = opts.sentinel?.maxLoginAttemptsPerHour ?? adminCfg.sentinel.rateLimits.maxLoginAttemptsPerHour;
  const maxSignups = opts.sentinel?.maxSignupsPerHour ?? adminCfg.sentinel.rateLimits.maxSignupsPerHour;
  const blockDisposable = opts.sentinel?.blockDisposableEmails !== false;
  const adminSet = new Set(opts.adminEmails.map((e) => e.toLowerCase()));

  // ── Internal helpers ─────────────────────────────────────────────

  async function recordAudit(params: {
    eventType: AuditEventType;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const db = opts.getDb();
      await db.insert(auditEvent).values({
        id: crypto.randomUUID(),
        eventType: params.eventType,
        userId: params.userId ?? null,
        userEmail: params.userEmail ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("[SelfHostedAdmin] audit write failed:", e);
    }
  }

  async function recordSecurity(params: {
    eventType: SecurityEventType;
    ipAddress?: string | null;
    userEmail?: string | null;
    action: SecurityAction;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const db = opts.getDb();
      await db.insert(securityEvent).values({
        id: crypto.randomUUID(),
        eventType: params.eventType,
        ipAddress: params.ipAddress ?? null,
        userEmail: params.userEmail ?? null,
        action: params.action,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("[SelfHostedAdmin] security write failed:", e);
    }
  }

  /**
   * Fail-closed atomic rate limit.
   *
   * The row id is a deterministic hash of the rate-limit key (`rl:<key>`),
   * which makes the primary-key INSERT-or-UPDATE single-statement and
   * eliminates the select→update race the previous implementation had.
   * ON CONFLICT(id) uses the existing PRIMARY KEY (no migration required)
   * and we read the post-write count back via RETURNING so concurrent
   * attempts on the same key serialise cleanly.
   */
  async function checkRateLimit(key: string, maxAttempts: number) {
    try {
      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);
      const expiresSec = nowSec + Math.floor(RATE_LIMIT_WINDOW_MS / 1000);
      const cutoffSec = nowSec - Math.floor(RATE_LIMIT_WINDOW_MS / 1000);

      // Periodic cleanup of expired rows. Best-effort; failures must not
      // change the decision below.
      try {
        const db = opts.getDb();
        await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
      } catch { /* best-effort */ }

      // Deterministic id so repeated calls with the same `key` target the
      // same row and ON CONFLICT(id) can upsert atomically.
      const idBytes = new TextEncoder().encode(`rl:${key}`);
      const digest = await crypto.subtle.digest("SHA-256", idBytes);
      const id = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 64);

      const result = await opts.d1
        .prepare(
          `INSERT INTO rate_limit (id, key, count, windowStart, expiresAt)
           VALUES (?1, ?2, 1, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET
             count = CASE WHEN rate_limit.windowStart < ?5 THEN 1 ELSE rate_limit.count + 1 END,
             windowStart = CASE WHEN rate_limit.windowStart < ?5 THEN ?3 ELSE rate_limit.windowStart END,
             expiresAt = CASE WHEN rate_limit.windowStart < ?5 THEN ?4 ELSE rate_limit.expiresAt END
           RETURNING count`,
        )
        .bind(id, key, nowSec, expiresSec, cutoffSec)
        .first<{ count: number }>();

      const newCount = result?.count ?? 1;
      return { allowed: newCount <= maxAttempts, count: newCount };
    } catch (err) {
      console.error("[SelfHostedAdmin] rate limit check failed, failing closed:", err);
      return { allowed: false, count: maxAttempts + 1 };
    }
  }

  function isAdmin(email: string) {
    return adminSet.size > 0 && adminSet.has(email.toLowerCase());
  }

  // ── AI Gateway helpers ───────────────────────────────────────────

  interface CfGatewayConfig {
    accountId: string;
    gatewayId: string;
    apiToken: string;
  }

  async function resolveCfConfig(): Promise<CfGatewayConfig> {
    const db = opts.getDb();
    const rows = await db.select().from(adminConfig).catch(() => [] as { key: string; value: string }[]);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const runtime = opts.runtimeInfo?.() ?? {};
    return {
      accountId: String(map.get("cf_account_id") ?? runtime.cfAccountId ?? ""),
      gatewayId: String(map.get("cf_gateway_id") ?? runtime.cfGatewayId ?? ""),
      apiToken: String(map.get("cf_api_token") ?? runtime.cfApiToken ?? ""),
    };
  }

  async function resolveActiveAiConfig() {
    const db = opts.getDb();
    const rows = await db.select().from(adminConfig).catch(() => [] as { key: string; value: string }[]);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const runtime = opts.runtimeInfo?.() ?? {};
    const customModelName = map.get("custom_model_name") || "";
    const customBaseUrl = map.get("custom_base_url") || "";
    const customApiKey = map.get("custom_api_key") || "";
    const useCustom = Boolean(customModelName && customBaseUrl && customApiKey);
    return {
      geminiModel: map.get("gemini_model") || String(runtime.geminiModel ?? "") || "gemini-2.5-flash-lite",
      geminiKey: map.get("gemini_key") || String(runtime.geminiKey ?? ""),
      geminiKeySource: map.has("gemini_key") ? "dashboard" : (runtime.geminiKeyConfigured ? "env" : "none"),
      deepgramKey: map.get("deepgram_key") || String(runtime.deepgramKey ?? ""),
      deepgramKeySource: map.has("deepgram_key") ? "dashboard" : (runtime.deepgramKeyConfigured ? "env" : "none"),
      customModelName,
      customBaseUrl,
      customApiKey,
      useCustom,
    };
  }

  function cfApiBase(cfg: CfGatewayConfig) {
    // Strict regex guards prevent SSRF via malformed ids.
    if (!/^[a-zA-Z0-9]{1,64}$/.test(cfg.accountId)) throw new APIError("BAD_REQUEST", { message: "Invalid cf_account_id" });
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cfg.gatewayId)) throw new APIError("BAD_REQUEST", { message: "Invalid cf_gateway_id" });
    if (!cfg.apiToken) throw new APIError("FAILED_DEPENDENCY", { message: "cf_api_token is not configured" });
    return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai-gateway/gateways/${cfg.gatewayId}`;
  }

  async function fetchAiGateway(cfg: CfGatewayConfig, pathSuffix: string, query?: URLSearchParams): Promise<{ ok: boolean; status: number; body: unknown }> {
    const base = cfApiBase(cfg);
    const qs = query && query.toString() ? `?${query.toString()}` : "";
    try {
      const resp = await fetch(`${base}${pathSuffix}${qs}`, {
        headers: { Authorization: `Bearer ${cfg.apiToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      let body: unknown = null;
      try { body = await resp.json(); } catch { body = null; }
      return { ok: resp.ok, status: resp.status, body };
    } catch (err) {
      return {
        ok: false,
        status: 504,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // ── Provider probes ──────────────────────────────────────────────

  async function probeDeepgram(apiKey: string): Promise<HealthCheckResult> {
    const cached = getCachedHealth("deepgram");
    if (cached) return cached;
    const t0 = Date.now();
    try {
      if (!apiKey) throw new Error("No API key configured");
      const resp = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${apiKey}`, accept: "application/json" },
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
      const result: HealthCheckResult = { ok: true, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString() };
      setCachedHealth("deepgram", result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        ok: false, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
      setCachedHealth("deepgram", result);
      return result;
    }
  }

  async function probeGemini(cf: CfGatewayConfig, modelName: string, apiKey: string): Promise<HealthCheckResult> {
    const cached = getCachedHealth("gemini");
    if (cached) return cached;
    const t0 = Date.now();
    try {
      if (!apiKey) throw new Error("No API key configured");
      if (!cf.accountId || !cf.gatewayId) throw new Error("AI Gateway not configured");
      // Use header-based auth so the API key never appears in URLs/logs.
      const url = `https://gateway.ai.cloudflare.com/v1/${cf.accountId}/${cf.gatewayId}/google-ai-studio/v1beta/models/${modelName}:generateContent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
      await resp.json().catch(() => null);
      const result: HealthCheckResult = { ok: true, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString() };
      setCachedHealth("gemini", result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        ok: false, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
      setCachedHealth("gemini", result);
      return result;
    }
  }

  async function probeCustomModel(modelName: string, baseUrl: string, apiKey: string): Promise<HealthCheckResult> {
    const cached = getCachedHealth("customModel");
    if (cached) return cached;
    const t0 = Date.now();
    try {
      if (!modelName || !baseUrl || !apiKey) {
        const result: HealthCheckResult = {
          ok: false, latencyMs: 0, lastProbe: new Date().toISOString(),
          configured: false, error: "Not configured",
        };
        setCachedHealth("customModel", result);
        return result;
      }
      // Reject internal / private / loopback custom URLs before we issue the
      // probe (SSRF defence in depth — the admin endpoint layer also gates
      // which URLs can be stored).
      const ssrf = validateOutboundUrl(baseUrl);
      if (!ssrf.ok) {
        const result: HealthCheckResult = {
          ok: false, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
          configured: true, error: `Blocked URL: ${ssrf.reason}`,
        };
        setCachedHealth("customModel", result);
        return result;
      }
      const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelName, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
      await resp.json().catch(() => null);
      const result: HealthCheckResult = { ok: true, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(), configured: true };
      setCachedHealth("customModel", result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        ok: false, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
        configured: true, error: e instanceof Error ? e.message : String(e),
      };
      setCachedHealth("customModel", result);
      return result;
    }
  }

  async function probeAiGateway(cf: CfGatewayConfig): Promise<HealthCheckResult> {
    const cached = getCachedHealth("aiGateway");
    if (cached) return cached;
    const t0 = Date.now();
    const accountConfigured = Boolean(cf.accountId);
    const gatewayConfigured = Boolean(cf.gatewayId);
    try {
      if (!accountConfigured || !gatewayConfigured) throw new Error("Account / Gateway id not configured");
      if (!cf.apiToken) throw new Error("cf_api_token not configured");
      const { ok, status, body } = await fetchAiGateway(cf, "");
      if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`);
      const result: HealthCheckResult = {
        ok: true, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
        accountConfigured, gatewayConfigured,
      };
      setCachedHealth("aiGateway", result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        ok: false, latencyMs: Date.now() - t0, lastProbe: new Date().toISOString(),
        accountConfigured, gatewayConfigured,
        error: e instanceof Error ? e.message : String(e),
      };
      setCachedHealth("aiGateway", result);
      return result;
    }
  }

  // ── Plugin definition ────────────────────────────────────────────

  return {
    id: "self-hosted-admin",

    schema: {
      user: {
        fields: {
          isBanned: { type: "boolean", required: false, defaultValue: false },
          banReason: { type: "string", required: false },
          lastActiveAt: { type: "date", required: false },
        },
      },
      auditEvent: {
        fields: {
          eventType: { type: "string" },
          userId: { type: "string", required: false, references: { model: "user", field: "id", onDelete: "set null" } },
          userEmail: { type: "string", required: false },
          ipAddress: { type: "string", required: false },
          userAgent: { type: "string", required: false },
          metadata: { type: "string", required: false },
        },
      },
      securityEvent: {
        fields: {
          eventType: { type: "string" },
          ipAddress: { type: "string", required: false },
          userEmail: { type: "string", required: false },
          action: { type: "string" },
          metadata: { type: "string", required: false },
        },
      },
      rateLimitEntry: {
        modelName: "rate_limit",
        fields: {
          key: { type: "string" },
          count: { type: "number" },
          windowStart: { type: "date" },
          expiresAt: { type: "date" },
        },
      },
    },

    // ── Hooks ─────────────────────────────────────────────────────

    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { email?: string } | undefined;
            const email = body?.email;
            const ip = getClientIp(ctx.headers);

            if (email && blockDisposable && isDisposableEmail(email)) {
              await recordSecurity({ eventType: "disposable_email", ipAddress: ip, userEmail: email, action: "block", metadata: { email } });
              throw new APIError("BAD_REQUEST", { message: "Disposable email addresses are not allowed." });
            }

            if (ip) {
              const rl = await checkRateLimit(`signup:${ip}`, maxSignups);
              if (!rl.allowed) {
                await recordSecurity({ eventType: "velocity_exceeded", ipAddress: ip, userEmail: email ?? null, action: "block", metadata: { type: "signup", count: rl.count } });
                throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-up attempts. Try again later." });
              }
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const ip = getClientIp(ctx.headers);
            const loginEmail = (ctx.body as { email?: string } | undefined)?.email;

            if (ip) {
              const rl = await checkRateLimit(`login:${ip}`, maxLogins);
              if (!rl.allowed) {
                await recordSecurity({ eventType: "credential_stuffing", ipAddress: ip, userEmail: loginEmail ?? null, action: "block", metadata: { type: "login", count: rl.count } });
                throw new APIError("TOO_MANY_REQUESTS", { message: "Too many login attempts. Please wait before trying again." });
              }
            }

            if (loginEmail) {
              const db = opts.getDb();
              const [targetUser] = await db
                .select({ isBanned: user.isBanned, banReason: user.banReason })
                .from(user)
                .where(eq(user.email, loginEmail));
              if (targetUser?.isBanned) {
                await recordAudit({ eventType: "security_blocked", userEmail: loginEmail, ipAddress: ip, metadata: { reason: "banned", banReason: targetUser.banReason } });
                throw new APIError("FORBIDDEN", { message: "This account has been suspended." });
              }
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const s = ctx.context.newSession;
            if (s) {
              await recordAudit({ eventType: "user_signed_up", userId: s.user.id, userEmail: s.user.email, ipAddress: getClientIp(ctx.headers), userAgent: getUserAgentStr(ctx.headers) });
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const s = ctx.context.newSession;
            if (s) {
              await recordAudit({ eventType: "user_signed_in", userId: s.user.id, userEmail: s.user.email, ipAddress: getClientIp(ctx.headers), userAgent: getUserAgentStr(ctx.headers) });
              try {
                const db = opts.getDb();
                await db.update(user).set({ lastActiveAt: new Date() }).where(eq(user.id, s.user.id));
              } catch { /* non-critical */ }
            } else if (ctx.context.returned instanceof APIError) {
              await recordAudit({ eventType: "security_blocked", userEmail: (ctx.body as { email?: string } | undefined)?.email ?? null, ipAddress: getClientIp(ctx.headers), userAgent: getUserAgentStr(ctx.headers), metadata: { reason: "failed_login" } });
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            await recordAudit({ eventType: "user_signed_out", ipAddress: getClientIp(ctx.headers), userAgent: getUserAgentStr(ctx.headers) });
          }),
        },
      ],
    },

    // ── Endpoints ─────────────────────────────────────────────────

    endpoints: {
      adminAppConfig: createAuthEndpoint("/self-hosted-admin/app-config", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        return ctx.json(adminCfg);
      }),

      adminMe: createAuthEndpoint("/self-hosted-admin/me", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        const u = ctx.context.session.user;
        if (!isAdmin(u.email)) throw new APIError("FORBIDDEN", { message: "Not an admin" });
        return ctx.json({ admin: true, email: u.email, name: u.name });
      }),

      adminOverview: createAuthEndpoint("/self-hosted-admin/overview", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 86_400_000);
        const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

        const [
          [{ totalUsers }],
          [{ newUsers24h }],
          [{ newUsersWeek }],
          [{ pendingApproval }],
          [{ bannedUsers }],
          [{ activeSessions }],
          [{ totalAuditEvents }],
          [{ securityBlocks24h }],
          configRows,
        ] = await Promise.all([
          db.select({ totalUsers: count() }).from(user),
          db.select({ newUsers24h: count() }).from(user).where(gte(user.createdAt, dayAgo)),
          db.select({ newUsersWeek: count() }).from(user).where(gte(user.createdAt, weekAgo)),
          db.select({ pendingApproval: count() }).from(user).where(eq(user.isApproved, false)),
          db.select({ bannedUsers: count() }).from(user).where(eq(user.isBanned, true)),
          db.select({ activeSessions: count() }).from(session).where(gte(session.expiresAt, now)),
          db.select({ totalAuditEvents: count() }).from(auditEvent),
          db.select({ securityBlocks24h: count() }).from(securityEvent).where(gte(securityEvent.createdAt, dayAgo)),
          db.select().from(adminConfig),
        ]);

        const cfgMap = new Map(configRows.map((r) => [r.key, r.value]));
        const envRuntime = opts.runtimeInfo?.() as Record<string, unknown> ?? {};

        const customModelName = cfgMap.get("custom_model_name") || "";
        const customBaseUrl = cfgMap.get("custom_base_url") || "";
        const customApiKey = cfgMap.get("custom_api_key") || "";
        const useCustomModel = Boolean(customModelName && customBaseUrl && customApiKey);

        const runtime = {
          ...envRuntime,
          geminiModel: cfgMap.get("gemini_model") || envRuntime.geminiModel || "gemini-flash-lite-latest",
          geminiKeyConfigured: Boolean(cfgMap.get("gemini_key") || envRuntime.geminiKeyConfigured),
          deepgramKeyConfigured: Boolean(cfgMap.get("deepgram_key") || envRuntime.deepgramKeyConfigured),
          geminiKeySource: cfgMap.has("gemini_key") ? "dashboard" : (envRuntime.geminiKeyConfigured ? "env" : "none"),
          deepgramKeySource: cfgMap.has("deepgram_key") ? "dashboard" : (envRuntime.deepgramKeyConfigured ? "env" : "none"),
          customModelName,
          customBaseUrl: customBaseUrl ? customBaseUrl.replace(/\/+$/, "") : "",
          customApiKeyConfigured: Boolean(customApiKey),
          useCustomModel,
        };

        return ctx.json({
          stats: { totalUsers, newUsers24h, newUsersWeek, pendingApproval, bannedUsers, activeSessions, totalAuditEvents, securityBlocks24h },
          runtime,
        });
      }),

      adminChartSignups: createAuthEndpoint("/self-hosted-admin/chart-signups", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const weeks = 8;
        const now = new Date();
        const weekMs = 7 * 86_400_000;
        const startTs = new Date(now.getTime() - weeks * weekMs);
        startTs.setHours(0, 0, 0, 0);
        const startEpoch = Math.floor(startTs.getTime() / 1000);
        const weekSecs = 7 * 24 * 60 * 60;

        const rawResult = await opts.d1
          .prepare(`SELECT ((createdAt - ?1) / ?2) AS bucket, COUNT(*) AS c FROM user WHERE createdAt >= ?1 GROUP BY bucket ORDER BY bucket`)
          .bind(startEpoch, weekSecs)
          .all<{ bucket: number; c: number }>();

        const bucketMap = new Map<number, number>();
        for (const row of rawResult.results) bucketMap.set(row.bucket, row.c);

        const points: { weekStart: string; count: number }[] = [];
        for (let i = 0; i < weeks; i++) {
          const ws = new Date(startTs.getTime() + i * weekMs);
          points.push({ weekStart: ws.toISOString().split("T")[0], count: bucketMap.get(i) ?? 0 });
        }
        return ctx.json({ chart: points });
      }),

      adminListUsers: createAuthEndpoint("/self-hosted-admin/list-users", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));
        const filter = url.searchParams.get("filter");

        const baseSelect = {
          id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified,
          isApproved: user.isApproved, isBanned: user.isBanned, banReason: user.banReason,
          lastActiveAt: user.lastActiveAt, createdAt: user.createdAt, updatedAt: user.updatedAt,
        };

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(user.email, `%${safeQ}%`), like(user.name, `%${safeQ}%`))!);
        }
        if (filter === "pending") conditions.push(eq(user.isApproved, false));
        if (filter === "banned") conditions.push(eq(user.isBanned, true));
        if (filter === "approved") conditions.push(eq(user.isApproved, true));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select(baseSelect).from(user).where(where).orderBy(desc(user.createdAt)).limit(limit).offset(offset)
            : db.select(baseSelect).from(user).orderBy(desc(user.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(user).where(where)
            : db.select({ total: count() }).from(user),
        ]);
        return ctx.json({ users: rows, total });
      }),

      adminUpdateUser: createAuthEndpoint("/self-hosted-admin/update-user", { method: "POST", use: [sessionMiddleware], body: updateUserSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId, isApproved, isBanned, banReason } = ctx.body;

        const [existing] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, userId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "User not found" });

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (isApproved !== undefined) {
          updates.isApproved = isApproved;
          await recordAudit({ eventType: isApproved ? "user_approved" : "user_approval_revoked", userId, userEmail: existing.email, metadata: { adminEmail } });
        }
        if (isBanned !== undefined) {
          updates.isBanned = isBanned;
          if (isBanned && banReason) updates.banReason = banReason;
          if (!isBanned) updates.banReason = null;
          await recordAudit({ eventType: isBanned ? "user_banned" : "user_unbanned", userId, userEmail: existing.email, metadata: { adminEmail, reason: isBanned ? banReason : undefined } });
        }

        await db.update(user).set(updates).where(eq(user.id, userId));
        return ctx.json({ ok: true });
      }),

      adminDeleteUser: createAuthEndpoint("/self-hosted-admin/delete-user", { method: "POST", use: [sessionMiddleware], body: deleteUserSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        if (userId === ctx.context.session.user.id) throw new APIError("BAD_REQUEST", { message: "Cannot delete your own account" });

        const [existing] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, userId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "User not found" });

        await recordAudit({ eventType: "user_deleted", userId, userEmail: existing.email, metadata: { adminEmail } });
        await db.delete(savedNote).where(eq(savedNote.userId, userId));
        await db.delete(interviewPreset).where(eq(interviewPreset.userId, userId));
        await db.delete(session).where(eq(session.userId, userId));
        await db.delete(account).where(eq(account.userId, userId));
        await db.delete(user).where(eq(user.id, userId));
        return ctx.json({ ok: true });
      }),

      adminListSessions: createAuthEndpoint("/self-hosted-admin/list-sessions", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));

        const baseSelect = { id: session.id, userId: session.userId, expiresAt: session.expiresAt, createdAt: session.createdAt, ipAddress: session.ipAddress, userAgent: session.userAgent, userEmail: user.email, userName: user.name };

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(user.email, `%${safeQ}%`), like(user.name, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseQuery = db.select(baseSelect).from(session).innerJoin(user, eq(session.userId, user.id));
        const countQuery = db.select({ total: count() }).from(session).innerJoin(user, eq(session.userId, user.id));

        const [rows, [{ total }]] = await Promise.all([
          where
            ? baseQuery.where(where).orderBy(desc(session.updatedAt)).limit(limit).offset(offset)
            : baseQuery.orderBy(desc(session.updatedAt)).limit(limit).offset(offset),
          where
            ? countQuery.where(where)
            : countQuery,
        ]);
        return ctx.json({ sessions: rows, total });
      }),

      adminRevokeSession: createAuthEndpoint("/self-hosted-admin/revoke-session", { method: "POST", use: [sessionMiddleware], body: revokeSessionSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { sessionId } = ctx.body;
        await recordAudit({ eventType: "session_revoked", metadata: { sessionId, adminEmail } });
        await db.delete(session).where(eq(session.id, sessionId));
        return ctx.json({ ok: true });
      }),

      adminRevokeAllSessions: createAuthEndpoint("/self-hosted-admin/revoke-all-sessions", { method: "POST", use: [sessionMiddleware], body: revokeAllSessionsSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        await recordAudit({ eventType: "sessions_revoked_all", userId, metadata: { adminEmail } });
        await db.delete(session).where(eq(session.userId, userId));
        return ctx.json({ ok: true });
      }),

      adminAuditLogs: createAuthEndpoint("/self-hosted-admin/audit-logs", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const eventType = url.searchParams.get("eventType");
        const userId = url.searchParams.get("userId");
        const q = sanitizeSearch(url.searchParams.get("q"));
        const conditions: ReturnType<typeof eq>[] = [];
        if (eventType) conditions.push(eq(auditEvent.eventType, eventType));
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(auditEvent.userId, userId));
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(auditEvent.userEmail, `%${safeQ}%`), like(auditEvent.ipAddress, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          where ? db.select().from(auditEvent).where(where).orderBy(desc(auditEvent.createdAt)).limit(limit).offset(offset) : db.select().from(auditEvent).orderBy(desc(auditEvent.createdAt)).limit(limit).offset(offset),
          where ? db.select({ total: count() }).from(auditEvent).where(where) : db.select({ total: count() }).from(auditEvent),
        ]);
        return ctx.json({ events: rows, total });
      }),

      adminSecurityEvents: createAuthEndpoint("/self-hosted-admin/security-events", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const eventType = url.searchParams.get("eventType");
        const q = sanitizeSearch(url.searchParams.get("q"));
        const conditions: ReturnType<typeof eq>[] = [];
        if (eventType) conditions.push(eq(securityEvent.eventType, eventType));
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(securityEvent.userEmail, `%${safeQ}%`), like(securityEvent.ipAddress, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          where ? db.select().from(securityEvent).where(where).orderBy(desc(securityEvent.createdAt)).limit(limit).offset(offset) : db.select().from(securityEvent).orderBy(desc(securityEvent.createdAt)).limit(limit).offset(offset),
          where ? db.select({ total: count() }).from(securityEvent).where(where) : db.select({ total: count() }).from(securityEvent),
        ]);
        return ctx.json({ events: rows, total });
      }),

      adminActivity: createAuthEndpoint("/self-hosted-admin/activity", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const rows = await db.select().from(auditEvent).orderBy(desc(auditEvent.createdAt)).limit(limit);
        return ctx.json({ events: rows });
      }),

      adminGetConfig: createAuthEndpoint("/self-hosted-admin/config", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const rows = await db.select().from(adminConfig);
        // Mask secret-like keys by default so a compromised admin session
        // (or admin-UI XSS) cannot exfiltrate full provider keys. Use
        // adminRevealConfig for one-off access to a specific secret.
        const config: Record<string, string> = {};
        const masked: string[] = [];
        for (const r of rows) {
          if (isSecretConfigKey(r.key)) {
            config[r.key] = maskSecret(r.value);
            masked.push(r.key);
          } else {
            config[r.key] = r.value;
          }
        }
        return ctx.json({ config, maskedKeys: masked });
      }),

      adminRevealConfig: createAuthEndpoint(
        "/self-hosted-admin/reveal-config",
        { method: "POST", use: [sessionMiddleware], body: revealConfigSchema },
        async (ctx) => {
          const adminEmail = ctx.context.session.user.email;
          if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
          const db = opts.getDb();
          const { key } = ctx.body;
          const [row] = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
          if (!row) throw new APIError("NOT_FOUND", { message: "Config key not found" });
          await recordAudit({
            eventType: "admin_action",
            userEmail: adminEmail,
            metadata: { action: "reveal_config", key },
          });
          return ctx.json({ key, value: row.value });
        },
      ),

      adminUpdateConfig: createAuthEndpoint("/self-hosted-admin/update-config", { method: "POST", use: [sessionMiddleware], body: updateConfigSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key, value } = ctx.body;

        // Gate host-like keys through the SSRF allowlist before persisting.
        if (key === "custom_base_url") {
          const check = validateOutboundUrl(value);
          if (!check.ok) {
            throw new APIError("BAD_REQUEST", { message: `custom_base_url rejected: ${check.reason}` });
          }
        }

        const now = new Date();
        const existing = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
        if (existing.length > 0) {
          await db.update(adminConfig).set({ value, updatedAt: now }).where(eq(adminConfig.key, key));
        } else {
          await db.insert(adminConfig).values({ key, value, updatedAt: now });
        }

        const isSecret = key.endsWith("_key") || key.endsWith("_token");
        const maskedValue = isSecret ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "update_config", key, value: maskedValue } });
        try { await opts.onConfigChange?.(); } catch (e) { console.warn("[SelfHostedAdmin] onConfigChange failed:", e); }
        return ctx.json({ ok: true });
      }),

      adminDeleteConfig: createAuthEndpoint("/self-hosted-admin/delete-config", { method: "POST", use: [sessionMiddleware], body: deleteConfigSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key } = ctx.body;
        await db.delete(adminConfig).where(eq(adminConfig.key, key));
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "delete_config", key } });
        try { await opts.onConfigChange?.(); } catch (e) { console.warn("[SelfHostedAdmin] onConfigChange failed:", e); }
        return ctx.json({ ok: true });
      }),

      adminTestModel: createAuthEndpoint("/self-hosted-admin/test-model", { method: "POST", use: [sessionMiddleware], body: testModelSchema }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const { modelName, baseUrl, apiKey } = ctx.body;

        // SSRF guard: never probe internal / private / loopback URLs.
        const ssrf = validateOutboundUrl(baseUrl);
        if (!ssrf.ok) {
          return ctx.json({ ok: false, error: `URL rejected: ${ssrf.reason}` });
        }

        const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";
        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelName, max_tokens: 32, messages: [{ role: "user", content: "Say hello in one word." }] }),
            signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            return ctx.json({ ok: false, status: resp.status, error: errText.slice(0, 500) });
          }
          const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
          const reply = data?.choices?.[0]?.message?.content ?? "";
          return ctx.json({ ok: true, reply: reply.slice(0, 200) });
        } catch (e) {
          return ctx.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }),

      // ── System Health ────────────────────────────────────────────

      adminHealth: createAuthEndpoint("/self-hosted-admin/health", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();

        const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

        const dbStart = Date.now();
        try {
          await db.select({ n: count() }).from(user);
          checks.database = { ok: true, latencyMs: Date.now() - dbStart };
        } catch (e) {
          checks.database = { ok: false, latencyMs: Date.now() - dbStart, error: e instanceof Error ? e.message : String(e) };
        }

        const configRows = await db.select().from(adminConfig).catch(() => [] as { key: string; value: string }[]);
        const cfgMap = new Map(configRows.map((r) => [r.key, r.value]));
        const envRuntime = opts.runtimeInfo?.() as Record<string, unknown> ?? {};

        checks.geminiKey = { ok: Boolean(cfgMap.get("gemini_key") || envRuntime.geminiKeyConfigured), latencyMs: 0 };
        checks.deepgramKey = { ok: Boolean(cfgMap.get("deepgram_key") || envRuntime.deepgramKeyConfigured), latencyMs: 0 };

        const allOk = Object.values(checks).every((c) => c.ok);

        return ctx.json({ status: allOk ? "healthy" : "degraded", timestamp: now.toISOString(), checks });
      }),

      // ── Bulk User Operations ─────────────────────────────────────

      adminBulkApprove: createAuthEndpoint("/self-hosted-admin/bulk-approve", { method: "POST", use: [sessionMiddleware], body: bulkApproveSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds, approve } = ctx.body;

        let affected = 0;
        for (const uid of userIds) {
          await db.update(user).set({ isApproved: approve, updatedAt: new Date() }).where(eq(user.id, uid));
          affected++;
        }

        await recordAudit({
          eventType: approve ? "user_approved" : "user_approval_revoked",
          userEmail: adminEmail,
          metadata: { action: "bulk_approve", userIds, approve, count: affected },
        });

        return ctx.json({ ok: true, affected });
      }),

      adminBulkBan: createAuthEndpoint("/self-hosted-admin/bulk-ban", { method: "POST", use: [sessionMiddleware], body: bulkBanSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds, ban, banReason } = ctx.body;

        for (const uid of userIds) {
          const updates: Record<string, unknown> = { isBanned: ban, updatedAt: new Date() };
          if (ban && banReason) updates.banReason = banReason;
          if (!ban) updates.banReason = null;
          await db.update(user).set(updates).where(eq(user.id, uid));
        }

        if (ban) {
          for (const uid of userIds) {
            await db.delete(session).where(eq(session.userId, uid));
          }
        }

        await recordAudit({
          eventType: ban ? "user_banned" : "user_unbanned",
          userEmail: adminEmail,
          metadata: { action: "bulk_ban", userIds, ban, banReason, count: userIds.length },
        });

        return ctx.json({ ok: true, affected: userIds.length });
      }),

      adminBulkDelete: createAuthEndpoint("/self-hosted-admin/bulk-delete", { method: "POST", use: [sessionMiddleware], body: bulkUserIdsSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds } = ctx.body;

        const selfId = ctx.context.session.user.id;
        if (userIds.includes(selfId)) throw new APIError("BAD_REQUEST", { message: "Cannot delete your own account" });

        for (const uid of userIds) {
          await db.delete(savedNote).where(eq(savedNote.userId, uid));
          await db.delete(interviewPreset).where(eq(interviewPreset.userId, uid));
          await db.delete(session).where(eq(session.userId, uid));
          await db.delete(account).where(eq(account.userId, uid));
          await db.delete(user).where(eq(user.id, uid));
        }

        await recordAudit({
          eventType: "user_deleted",
          userEmail: adminEmail,
          metadata: { action: "bulk_delete", userIds, count: userIds.length },
        });

        return ctx.json({ ok: true, affected: userIds.length });
      }),

      // ── Admin Notes Management ───────────────────────────────────

      adminListNotes: createAuthEndpoint("/self-hosted-admin/list-notes", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));
        const userId = url.searchParams.get("userId");

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(like(savedNote.content, `%${safeQ}%`));
        }
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(savedNote.userId, userId));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseSelect = {
          id: savedNote.id,
          userId: savedNote.userId,
          content: savedNote.content,
          tag: savedNote.tag,
          createdAt: savedNote.createdAt,
          userEmail: user.email,
          userName: user.name,
        };

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select(baseSelect).from(savedNote).leftJoin(user, eq(savedNote.userId, user.id)).where(where).orderBy(desc(savedNote.createdAt)).limit(limit).offset(offset)
            : db.select(baseSelect).from(savedNote).leftJoin(user, eq(savedNote.userId, user.id)).orderBy(desc(savedNote.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(savedNote).where(where)
            : db.select({ total: count() }).from(savedNote),
        ]);

        return ctx.json({ notes: rows, total });
      }),

      adminDeleteNote: createAuthEndpoint("/self-hosted-admin/delete-note", { method: "POST", use: [sessionMiddleware], body: adminDeleteNoteSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { noteId } = ctx.body;

        await db.delete(savedNote).where(eq(savedNote.id, noteId));
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "delete_note", noteId } });
        return ctx.json({ ok: true });
      }),

      // ── Admin Presets Management ─────────────────────────────────

      adminListPresets: createAuthEndpoint("/self-hosted-admin/list-presets", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const category = url.searchParams.get("category");
        const builtInOnly = url.searchParams.get("builtIn");

        const conditions: ReturnType<typeof eq>[] = [];
        if (category) conditions.push(eq(interviewPreset.category, category));
        if (builtInOnly === "true") conditions.push(eq(interviewPreset.isBuiltIn, true));
        if (builtInOnly === "false") conditions.push(eq(interviewPreset.isBuiltIn, false));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select().from(interviewPreset).where(where).orderBy(asc(interviewPreset.name)).limit(limit).offset(offset)
            : db.select().from(interviewPreset).orderBy(asc(interviewPreset.name)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(interviewPreset).where(where)
            : db.select({ total: count() }).from(interviewPreset),
        ]);

        return ctx.json({ presets: rows, total });
      }),

      adminCreatePreset: createAuthEndpoint("/self-hosted-admin/create-preset", { method: "POST", use: [sessionMiddleware], body: adminCreatePresetSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { name, category, context, description, icon, isBuiltIn } = ctx.body;

        const id = crypto.randomUUID();
        await db.insert(interviewPreset).values({
          id,
          name,
          category,
          context,
          description: description ?? null,
          icon: icon ?? null,
          isBuiltIn: isBuiltIn ?? true,
          userId: null,
          createdAt: new Date(),
        });

        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "create_preset", presetId: id, name } });
        return ctx.json({ ok: true, presetId: id });
      }),

      adminUpdatePreset: createAuthEndpoint("/self-hosted-admin/update-preset", { method: "POST", use: [sessionMiddleware], body: adminUpdatePresetSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { presetId, ...fields } = ctx.body;

        const [existing] = await db.select({ id: interviewPreset.id }).from(interviewPreset).where(eq(interviewPreset.id, presetId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "Preset not found" });

        const updates: Record<string, unknown> = {};
        if (fields.name !== undefined) updates.name = fields.name;
        if (fields.category !== undefined) updates.category = fields.category;
        if (fields.context !== undefined) updates.context = fields.context;
        if (fields.description !== undefined) updates.description = fields.description;
        if (fields.icon !== undefined) updates.icon = fields.icon;

        if (Object.keys(updates).length > 0) {
          await db.update(interviewPreset).set(updates).where(eq(interviewPreset.id, presetId));
        }

        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "update_preset", presetId } });
        return ctx.json({ ok: true });
      }),

      adminDeletePreset: createAuthEndpoint("/self-hosted-admin/delete-preset", { method: "POST", use: [sessionMiddleware], body: adminDeletePresetSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { presetId } = ctx.body;

        await db.delete(interviewPreset).where(eq(interviewPreset.id, presetId));
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "delete_preset", presetId } });
        return ctx.json({ ok: true });
      }),

      // ── Stats Export ─────────────────────────────────────────────

      adminExportStats: createAuthEndpoint("/self-hosted-admin/export-stats", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 86_400_000);
        const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
        const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

        const [
          [{ totalUsers }],
          [{ newUsers24h }],
          [{ newUsersWeek }],
          [{ newUsersMonth }],
          [{ pendingApproval }],
          [{ bannedUsers }],
          [{ activeSessions }],
          [{ totalNotes }],
          [{ totalPresets }],
          [{ totalAuditEvents }],
          [{ securityBlocks24h }],
          [{ securityBlocksWeek }],
        ] = await Promise.all([
          db.select({ totalUsers: count() }).from(user),
          db.select({ newUsers24h: count() }).from(user).where(gte(user.createdAt, dayAgo)),
          db.select({ newUsersWeek: count() }).from(user).where(gte(user.createdAt, weekAgo)),
          db.select({ newUsersMonth: count() }).from(user).where(gte(user.createdAt, monthAgo)),
          db.select({ pendingApproval: count() }).from(user).where(eq(user.isApproved, false)),
          db.select({ bannedUsers: count() }).from(user).where(eq(user.isBanned, true)),
          db.select({ activeSessions: count() }).from(session).where(gte(session.expiresAt, now)),
          db.select({ totalNotes: count() }).from(savedNote),
          db.select({ totalPresets: count() }).from(interviewPreset),
          db.select({ totalAuditEvents: count() }).from(auditEvent),
          db.select({ securityBlocks24h: count() }).from(securityEvent).where(gte(securityEvent.createdAt, dayAgo)),
          db.select({ securityBlocksWeek: count() }).from(securityEvent).where(gte(securityEvent.createdAt, weekAgo)),
        ]);

        const csvLines = [
          "metric,value",
          `total_users,${totalUsers}`,
          `new_users_24h,${newUsers24h}`,
          `new_users_week,${newUsersWeek}`,
          `new_users_month,${newUsersMonth}`,
          `pending_approval,${pendingApproval}`,
          `banned_users,${bannedUsers}`,
          `active_sessions,${activeSessions}`,
          `total_notes,${totalNotes}`,
          `total_presets,${totalPresets}`,
          `total_audit_events,${totalAuditEvents}`,
          `security_blocks_24h,${securityBlocks24h}`,
          `security_blocks_week,${securityBlocksWeek}`,
          `exported_at,${now.toISOString()}`,
        ];

        return ctx.json({
          stats: {
            totalUsers, newUsers24h, newUsersWeek, newUsersMonth,
            pendingApproval, bannedUsers, activeSessions,
            totalNotes, totalPresets, totalAuditEvents,
            securityBlocks24h, securityBlocksWeek,
          },
          csv: csvLines.join("\n"),
          exportedAt: now.toISOString(),
        });
      }),

      // ── Export Users CSV ─────────────────────────────────────────

      adminExportUsers: createAuthEndpoint("/self-hosted-admin/export-users", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();

        const rows = await db.select({
          id: user.id,
          name: user.name,
          email: user.email,
          isApproved: user.isApproved,
          isBanned: user.isBanned,
          createdAt: user.createdAt,
          lastActiveAt: user.lastActiveAt,
        }).from(user).orderBy(desc(user.createdAt));

        const csvHeader = "id,name,email,isApproved,isBanned,createdAt,lastActiveAt";
        const csvRows = rows.map((r) => {
          const safeName = (r.name || "").replace(/"/g, '""');
          return `${r.id},"${safeName}",${r.email},${r.isApproved ?? false},${r.isBanned ?? false},${r.createdAt?.toISOString() ?? ""},${r.lastActiveAt?.toISOString() ?? ""}`;
        });

        return ctx.json({ csv: [csvHeader, ...csvRows].join("\n"), total: rows.length });
      }),

      // ── User Detail (single user with related data) ─────────────

      adminGetUser: createAuthEndpoint("/self-hosted-admin/get-user", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const userId = url.searchParams.get("userId");
        if (!userId || !SAFE_ID_RE.test(userId)) throw new APIError("BAD_REQUEST", { message: "Invalid userId" });

        const [targetUser] = await db.select().from(user).where(eq(user.id, userId));
        if (!targetUser) throw new APIError("NOT_FOUND", { message: "User not found" });

        const [sessions, notes, presets, recentAudit] = await Promise.all([
          db.select({ id: session.id, expiresAt: session.expiresAt, createdAt: session.createdAt, ipAddress: session.ipAddress, userAgent: session.userAgent })
            .from(session).where(eq(session.userId, userId)).orderBy(desc(session.createdAt)).limit(10),
          db.select({ total: count() }).from(savedNote).where(eq(savedNote.userId, userId)),
          db.select({ total: count() }).from(interviewPreset).where(eq(interviewPreset.userId, userId)),
          db.select().from(auditEvent).where(eq(auditEvent.userId, userId)).orderBy(desc(auditEvent.createdAt)).limit(20),
        ]);

        return ctx.json({
          user: targetUser,
          sessions,
          notesCount: notes[0]?.total ?? 0,
          presetsCount: presets[0]?.total ?? 0,
          recentAuditEvents: recentAudit,
        });
      }),

      // ── AI Gateway: Logs list / detail / summary ─────────────────

      adminAiGatewayLogs: createAuthEndpoint("/self-hosted-admin/ai-gateway/logs", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");

        const cf = await resolveCfConfig();
        const url = new URL(ctx.request?.url ?? "http://localhost");

        const forwarded = new URLSearchParams();
        const forwardedFilters: Record<string, string> = {};
        for (const key of AI_GATEWAY_LOG_QUERY_KEYS) {
          const raw = url.searchParams.get(key);
          if (raw === null) continue;
          const trimmed = raw.trim();
          if (!trimmed) continue;
          if (trimmed.length > 200) continue;

          if (key === "per_page") {
            // Cloudflare AI Gateway logs API caps per_page at 50.
            const n = Math.min(50, Math.max(1, Number.parseInt(trimmed, 10) || 20));
            forwarded.set(key, String(n));
            forwardedFilters[key] = String(n);
          } else if (key === "page") {
            const n = Math.max(1, Number.parseInt(trimmed, 10) || 1);
            forwarded.set(key, String(n));
            forwardedFilters[key] = String(n);
          } else {
            forwarded.set(key, trimmed);
            forwardedFilters[key] = trimmed;
          }
        }
        if (!forwarded.has("per_page")) forwarded.set("per_page", "20");
        if (!forwarded.has("order_by")) forwarded.set("order_by", "created_at");
        if (!forwarded.has("order_by_direction")) forwarded.set("order_by_direction", "desc");

        const { ok, status, body } = await fetchAiGateway(cf, "/logs", forwarded);
        if (!ok) {
          return ctx.json({ ok: false, status, error: body }, { status: 502 });
        }

        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "fetch_ai_gateway_logs", filters: forwardedFilters } });
        return ctx.json((body ?? {}) as Record<string, unknown>);
      }),

      adminAiGatewayLogDetail: createAuthEndpoint("/self-hosted-admin/ai-gateway/log", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!SAFE_ID_RE.test(id)) throw new APIError("BAD_REQUEST", { message: "Invalid log id" });

        const cf = await resolveCfConfig();
        const { ok, status, body } = await fetchAiGateway(cf, `/logs/${encodeURIComponent(id)}`);
        if (!ok) {
          return ctx.json({ ok: false, status, error: body }, { status: 502 });
        }
        return ctx.json((body ?? {}) as Record<string, unknown>);
      }),

      adminAiGatewaySummary: createAuthEndpoint("/self-hosted-admin/ai-gateway/summary", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const windowKey = url.searchParams.get("window") ?? "24h";
        const windowMs = SUMMARY_WINDOW_MS[windowKey];
        if (!windowMs) throw new APIError("BAD_REQUEST", { message: "window must be one of 1h, 24h, 7d, 30d" });

        const cf = await resolveCfConfig();
        const now = new Date();
        const start = new Date(now.getTime() - windowMs);

        // CF caps per_page at 50; sample up to 300 rows for aggregation.
        type LogRow = {
          provider?: string; model?: string; success?: boolean; cached?: boolean;
          duration?: number; tokens_in?: number; tokens_out?: number; cost?: number;
        };
        const MAX_PAGES = 6;
        const PER_PAGE = 50;
        const rows: LogRow[] = [];
        let totalCount = 0;

        for (let page = 1; page <= MAX_PAGES; page++) {
          const qs = new URLSearchParams({
            page: String(page),
            per_page: String(PER_PAGE),
            start_date: start.toISOString(),
            end_date: now.toISOString(),
            order_by: "created_at",
            order_by_direction: "desc",
            meta_info: "true",
          });
          const { ok, status, body } = await fetchAiGateway(cf, "/logs", qs);
          if (!ok) {
            return ctx.json({ ok: false, status, error: body }, { status: 502 });
          }
          const parsed = body as { result?: LogRow[]; result_info?: { total_count?: number } };
          const result = Array.isArray(parsed?.result) ? parsed.result : [];
          rows.push(...result);
          if (page === 1) totalCount = parsed?.result_info?.total_count ?? result.length;
          if (result.length < PER_PAGE) break;
        }

        let success = 0, errors = 0, cached = 0;
        let durSum = 0, durN = 0;
        let tInSum = 0, tInN = 0;
        let tOutSum = 0, tOutN = 0;
        let costSum = 0;
        const byProvider: Record<string, { count: number; errors: number; cost: number }> = {};
        const byModel: Record<string, { count: number; errors: number; cost: number }> = {};

        for (const r of rows) {
          if (r.success) success++; else errors++;
          if (r.cached) cached++;
          if (typeof r.duration === "number") { durSum += r.duration; durN++; }
          if (typeof r.tokens_in === "number") { tInSum += r.tokens_in; tInN++; }
          if (typeof r.tokens_out === "number") { tOutSum += r.tokens_out; tOutN++; }
          if (typeof r.cost === "number") costSum += r.cost;

          if (r.provider) {
            const b = byProvider[r.provider] ??= { count: 0, errors: 0, cost: 0 };
            b.count++;
            if (!r.success) b.errors++;
            if (typeof r.cost === "number") b.cost += r.cost;
          }
          if (r.model) {
            const b = byModel[r.model] ??= { count: 0, errors: 0, cost: 0 };
            b.count++;
            if (!r.success) b.errors++;
            if (typeof r.cost === "number") b.cost += r.cost;
          }
        }

        const sampleSize = rows.length;
        const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

        return ctx.json({
          window: windowKey,
          startedAt: start.toISOString(),
          endedAt: now.toISOString(),
          totalRequests: totalCount,
          sampleSize,
          successRate: safeDiv(success, sampleSize),
          errorRate: safeDiv(errors, sampleSize),
          cachedPct: safeDiv(cached, sampleSize),
          avgDuration: safeDiv(durSum, durN),
          avgTokensIn: safeDiv(tInSum, tInN),
          avgTokensOut: safeDiv(tOutSum, tOutN),
          totalCost: costSum,
          byProvider,
          byModel,
        });
      }),

      // ── Provider health ──────────────────────────────────────────

      adminProvidersHealth: createAuthEndpoint("/self-hosted-admin/providers/health", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const deep = url.searchParams.get("deep") === "1" || url.searchParams.get("deep") === "true";

        const [ai, cf] = await Promise.all([resolveActiveAiConfig(), resolveCfConfig()]);

        if (!deep) {
          const cachedGemini = getCachedHealth("gemini");
          const cachedDg = getCachedHealth("deepgram");
          const cachedCustom = getCachedHealth("customModel");
          const cachedGw = getCachedHealth("aiGateway");

          return ctx.json({
            deep: false,
            gemini: cachedGemini ?? {
              ok: Boolean(ai.geminiKey),
              latencyMs: 0,
              lastProbe: "",
              source: ai.geminiKeySource,
              configured: Boolean(ai.geminiKey),
            },
            deepgram: cachedDg ?? {
              ok: Boolean(ai.deepgramKey),
              latencyMs: 0,
              lastProbe: "",
              source: ai.deepgramKeySource,
              configured: Boolean(ai.deepgramKey),
            },
            customModel: cachedCustom ?? {
              ok: false,
              latencyMs: 0,
              lastProbe: "",
              configured: ai.useCustom,
            },
            aiGateway: cachedGw ?? {
              ok: false,
              latencyMs: 0,
              lastProbe: "",
              accountConfigured: Boolean(cf.accountId),
              gatewayConfigured: Boolean(cf.gatewayId),
            },
            activeModel: ai.useCustom ? ai.customModelName : ai.geminiModel,
            useCustomModel: ai.useCustom,
          });
        }

        const [gemini, deepgram, customModel, aiGateway] = await Promise.all([
          probeGemini(cf, ai.geminiModel, ai.geminiKey),
          probeDeepgram(ai.deepgramKey),
          probeCustomModel(ai.customModelName, ai.customBaseUrl, ai.customApiKey),
          probeAiGateway(cf),
        ]);

        return ctx.json({
          deep: true,
          gemini: { ...gemini, source: ai.geminiKeySource },
          deepgram: { ...deepgram, source: ai.deepgramKeySource },
          customModel,
          aiGateway,
          activeModel: ai.useCustom ? ai.customModelName : ai.geminiModel,
          useCustomModel: ai.useCustom,
        });
      }),

      // ── Cleanup expired rate limits / sessions ───────────────────

      adminCleanup: createAuthEndpoint("/self-hosted-admin/cleanup", { method: "POST", use: [sessionMiddleware] }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();

        await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
        await db.delete(session).where(lt(session.expiresAt, now));

        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "cleanup", timestamp: now.toISOString() } });
        return ctx.json({ ok: true, cleanedAt: now.toISOString() });
      }),
    },
  } satisfies BetterAuthPlugin;
};
