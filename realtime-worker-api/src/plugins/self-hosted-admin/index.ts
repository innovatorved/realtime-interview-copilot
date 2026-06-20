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
 *         d1: env.DB,
 *         adminEmails: ["admin@example.com"],
 *       }),
 *     ],
 *   })
 */

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
} from "better-auth/api";
import { eq } from "drizzle-orm";
import adminCfg from "../../config.json";
import { user } from "../../db/schema";
import { getClientIp, getUserAgentStr, isDisposableEmail } from "./helpers";
import {
  createRecordAudit,
  createRecordSecurity,
} from "./internal/audit";
import { createCheckRateLimit } from "./internal/rate-limit";
import { createAdminSet } from "./internal/admin-set";
import { createAiGateway } from "./internal/ai-gateway";
import { getCachedHealth } from "./internal/health-cache";
import {
  createProbeAiGateway,
  probeCustomModel,
  probeDeepgram,
  probeGemini,
} from "./internal/probes";
import { aiGatewayEndpoints } from "./endpoints/ai-gateway-routes";
import { announcementEndpoints } from "./endpoints/announcements";
import { auditEndpoints } from "./endpoints/audit";
import { cleanupEndpoints } from "./endpoints/cleanup";
import { quotaEndpoints } from "./endpoints/quota";
import { ensureQuotaRow } from "../../services/quota.service";
import { configEndpoints } from "./endpoints/config";
import { dashboardEndpoints } from "./endpoints/dashboard";
import { exportsEndpoints } from "./endpoints/exports";
import { importantEventsEndpoints } from "./endpoints/important-events";
import { liveSessionEndpoints } from "./endpoints/live-sessions";
import { modelParamsEndpoints } from "./endpoints/model-params";
import { notesEndpoints } from "./endpoints/notes";
import { sessionEndpoints } from "./endpoints/sessions";
import { supportEndpoints } from "./endpoints/support";
import { usageEndpoints } from "./endpoints/usage";
import { userEndpoints } from "./endpoints/users";
import type { AdminDeps, SelfHostedAdminOptions } from "./types";

export type {
  AuditEventType,
  SecurityAction,
  SecurityEventType,
  SelfHostedAdminOptions,
} from "./types";

export const selfHostedAdmin = (opts: SelfHostedAdminOptions) => {
  const maxLogins =
    opts.sentinel?.maxLoginAttemptsPerHour ??
    adminCfg.sentinel.rateLimits.maxLoginAttemptsPerHour;
  const maxSignups =
    opts.sentinel?.maxSignupsPerHour ??
    adminCfg.sentinel.rateLimits.maxSignupsPerHour;
  const blockDisposable = opts.sentinel?.blockDisposableEmails !== false;
  const envAdmins = new Set(opts.adminEmails.map((e) => e.toLowerCase()));

  const recordAudit = createRecordAudit(opts.getDb);
  const recordSecurity = createRecordSecurity(opts.getDb);
  const checkRateLimit = createCheckRateLimit(opts.getDb, opts.d1);
  const { isAdmin, invalidateAdminSetCache } = createAdminSet(envAdmins, opts.getDb);
  const { resolveCfConfig, resolveActiveAiConfig, fetchAiGateway } =
    createAiGateway(opts.getDb, opts.runtimeInfo);
  const probeAiGateway = createProbeAiGateway(fetchAiGateway);

  const deps: AdminDeps = {
    opts,
    envAdmins,
    isAdmin,
    invalidateAdminSetCache,
    recordAudit,
    resolveCfConfig,
    resolveActiveAiConfig,
    fetchAiGateway,
    probeDeepgram,
    probeGemini,
    probeCustomModel,
    probeAiGateway,
    getCachedHealth,
  };

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
          userId: {
            type: "string",
            required: false,
            references: { model: "user", field: "id", onDelete: "set null" },
          },
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

    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { email?: string } | undefined;
            const email = body?.email;
            const ip = getClientIp(ctx.headers);

            if (email && blockDisposable && isDisposableEmail(email)) {
              await recordSecurity({
                eventType: "disposable_email",
                ipAddress: ip,
                userEmail: email,
                action: "block",
                metadata: { email },
              });
              throw new APIError("BAD_REQUEST", {
                message: "Disposable email addresses are not allowed.",
              });
            }

            if (ip) {
              const rl = await checkRateLimit(`signup:${ip}`, maxSignups);
              if (!rl.allowed) {
                await recordSecurity({
                  eventType: "velocity_exceeded",
                  ipAddress: ip,
                  userEmail: email ?? null,
                  action: "block",
                  metadata: { type: "signup", count: rl.count },
                });
                throw new APIError("TOO_MANY_REQUESTS", {
                  message: "Too many sign-up attempts. Try again later.",
                });
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
                await recordSecurity({
                  eventType: "credential_stuffing",
                  ipAddress: ip,
                  userEmail: loginEmail ?? null,
                  action: "block",
                  metadata: { type: "login", count: rl.count },
                });
                throw new APIError("TOO_MANY_REQUESTS", {
                  message:
                    "Too many login attempts. Please wait before trying again.",
                });
              }
            }

            if (loginEmail) {
              const db = opts.getDb();
              const [targetUser] = await db
                .select({ isBanned: user.isBanned, banReason: user.banReason })
                .from(user)
                .where(eq(user.email, loginEmail));
              if (targetUser?.isBanned) {
                await recordAudit({
                  eventType: "security_blocked",
                  userEmail: loginEmail,
                  ipAddress: ip,
                  metadata: {
                    reason: "banned",
                    banReason: targetUser.banReason,
                  },
                });
                throw new APIError("FORBIDDEN", {
                  message: "This account has been suspended.",
                });
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
              await recordAudit({
                eventType: "user_signed_up",
                userId: s.user.id,
                userEmail: s.user.email,
                ipAddress: getClientIp(ctx.headers),
                userAgent: getUserAgentStr(ctx.headers),
              });
              try {
                await ensureQuotaRow(opts.getDb(), s.user.id);
              } catch (e) {
                console.warn("[SelfHostedAdmin] ensureQuotaRow on signup failed:", e);
              }
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const s = ctx.context.newSession;
            if (s) {
              await recordAudit({
                eventType: "user_signed_in",
                userId: s.user.id,
                userEmail: s.user.email,
                ipAddress: getClientIp(ctx.headers),
                userAgent: getUserAgentStr(ctx.headers),
              });
              try {
                const db = opts.getDb();
                await db
                  .update(user)
                  .set({ lastActiveAt: new Date() })
                  .where(eq(user.id, s.user.id));
              } catch {
                /* non-critical */
              }
            } else if (ctx.context.returned instanceof APIError) {
              await recordAudit({
                eventType: "security_blocked",
                userEmail:
                  (ctx.body as { email?: string } | undefined)?.email ?? null,
                ipAddress: getClientIp(ctx.headers),
                userAgent: getUserAgentStr(ctx.headers),
                metadata: { reason: "failed_login" },
              });
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            await recordAudit({
              eventType: "user_signed_out",
              ipAddress: getClientIp(ctx.headers),
              userAgent: getUserAgentStr(ctx.headers),
            });
          }),
        },
      ],
    },

    endpoints: {
      ...dashboardEndpoints(deps),
      ...userEndpoints(deps),
      ...sessionEndpoints(deps),
      ...auditEndpoints(deps),
      ...configEndpoints(deps),
      ...notesEndpoints(deps),
      ...exportsEndpoints(deps),
      ...usageEndpoints(deps),
      ...aiGatewayEndpoints(deps),
      ...modelParamsEndpoints(deps),
      ...liveSessionEndpoints(deps),
      ...importantEventsEndpoints(deps),
      ...supportEndpoints(deps),
      ...announcementEndpoints(deps),
      ...cleanupEndpoints(deps),
      ...quotaEndpoints(deps),
    },
  } satisfies BetterAuthPlugin;
};
