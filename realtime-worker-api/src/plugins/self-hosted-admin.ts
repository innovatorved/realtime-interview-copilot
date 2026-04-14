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
} from "../db/schema";
import type * as schemaTypes from "../db/schema";
import { count, desc, eq, gte, like, or, and, lt } from "drizzle-orm";
import { z } from "zod";
import adminCfg from "../config.json";

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

  async function checkRateLimit(key: string, maxAttempts: number) {
    const db = opts.getDb();
    const now = new Date();
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
    await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
    const [existing] = await db
      .select()
      .from(rateLimitEntry)
      .where(and(eq(rateLimitEntry.key, key), gte(rateLimitEntry.windowStart, windowStart)));
    if (existing) {
      const newCount = existing.count + 1;
      await db.update(rateLimitEntry).set({ count: newCount }).where(eq(rateLimitEntry.id, existing.id));
      return { allowed: newCount <= maxAttempts, count: newCount };
    }
    await db.insert(rateLimitEntry).values({
      id: crypto.randomUUID(),
      key,
      count: 1,
      windowStart: now,
      expiresAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
    });
    return { allowed: true, count: 1 };
  }

  function isAdmin(email: string) {
    return adminSet.size > 0 && adminSet.has(email.toLowerCase());
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

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select(baseSelect).from(session).innerJoin(user, eq(session.userId, user.id)).where(where).orderBy(desc(session.updatedAt)).limit(limit).offset(offset)
            : db.select(baseSelect).from(session).innerJoin(user, eq(session.userId, user.id)).orderBy(desc(session.updatedAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(session).innerJoin(user, eq(session.userId, user.id)).where(where)
            : db.select({ total: count() }).from(session),
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
        const config: Record<string, string> = {};
        for (const r of rows) config[r.key] = r.value;
        return ctx.json({ config });
      }),

      adminUpdateConfig: createAuthEndpoint("/self-hosted-admin/update-config", { method: "POST", use: [sessionMiddleware], body: updateConfigSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key, value } = ctx.body;

        const now = new Date();
        const existing = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
        if (existing.length > 0) {
          await db.update(adminConfig).set({ value, updatedAt: now }).where(eq(adminConfig.key, key));
        } else {
          await db.insert(adminConfig).values({ key, value, updatedAt: now });
        }

        const maskedValue = key.endsWith("_key") ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "update_config", key, value: maskedValue } });
        return ctx.json({ ok: true });
      }),

      adminDeleteConfig: createAuthEndpoint("/self-hosted-admin/delete-config", { method: "POST", use: [sessionMiddleware], body: deleteConfigSchema }, async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!isAdmin(adminEmail)) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key } = ctx.body;
        await db.delete(adminConfig).where(eq(adminConfig.key, key));
        await recordAudit({ eventType: "admin_action", userEmail: adminEmail, metadata: { action: "delete_config", key } });
        return ctx.json({ ok: true });
      }),

      adminTestModel: createAuthEndpoint("/self-hosted-admin/test-model", { method: "POST", use: [sessionMiddleware], body: testModelSchema }, async (ctx) => {
        if (!isAdmin(ctx.context.session.user.email)) throw new APIError("FORBIDDEN");
        const { modelName, baseUrl, apiKey } = ctx.body;

        const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";
        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelName, max_tokens: 32, messages: [{ role: "user", content: "Say hello in one word." }] }),
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
    },
  } satisfies BetterAuthPlugin;
};
