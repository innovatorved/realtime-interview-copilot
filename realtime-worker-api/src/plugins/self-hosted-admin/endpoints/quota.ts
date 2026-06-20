/** Admin quota management endpoints. */

import { and, count, desc, eq, like, or } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { quotaBalance, user } from "../../../db/schema";
import {
  ensureQuotaRow,
  getQuotaForUser,
  getQuotaTierCatalog,
  toQuotaSummary,
} from "../../../services/quota.service";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import {
  quotaListQuerySchema,
  quotaResetCycleSchema,
  quotaUpsertSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function quotaEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;

  return {
    adminGetQuota: createAuthEndpoint(
      "/self-hosted-admin/quota",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const userId = url.searchParams.get("userId");
        if (!userId || !SAFE_ID_RE.test(userId)) {
          throw new APIError("BAD_REQUEST", { message: "Invalid userId" });
        }

        await ensureQuotaRow(db, userId);
        const row = await getQuotaForUser(db, userId);
        return ctx.json({
          userId,
          row,
          summary: toQuotaSummary(row, {} as import("../../../env").Env),
        });
      },
    ),

    adminUpsertQuota: createAuthEndpoint(
      "/self-hosted-admin/quota",
      { method: "POST", use: [sessionMiddleware], body: quotaUpsertSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const body = ctx.body;
        const { userId, ...fields } = body;

        const [existingUser] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, userId));
        if (!existingUser) throw new APIError("NOT_FOUND", { message: "User not found" });

        await ensureQuotaRow(db, userId);
        const now = new Date();
        const [existing] = await db
          .select()
          .from(quotaBalance)
          .where(eq(quotaBalance.userId, userId));

        const next = {
          userId,
          planTier: existing?.planTier ?? "legacy_unlimited",
          monthlyAllowanceSeconds: existing?.monthlyAllowanceSeconds ?? null,
          monthlyAllowanceCompletions: existing?.monthlyAllowanceCompletions ?? null,
          consumedSeconds: existing?.consumedSeconds ?? 0,
          consumedCompletions: existing?.consumedCompletions ?? 0,
          cycleResetAt: existing?.cycleResetAt ?? new Date(now.getTime() + 30 * 86_400_000),
          overageAllowed: existing?.overageAllowed ?? true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        if (fields.planTier !== undefined) next.planTier = fields.planTier;
        if (fields.monthlyAllowanceSeconds !== undefined)
          next.monthlyAllowanceSeconds = fields.monthlyAllowanceSeconds;
        if (fields.monthlyAllowanceCompletions !== undefined)
          next.monthlyAllowanceCompletions = fields.monthlyAllowanceCompletions;
        if (fields.overageAllowed !== undefined)
          next.overageAllowed = fields.overageAllowed;
        if (fields.consumedSeconds !== undefined)
          next.consumedSeconds = fields.consumedSeconds;
        if (fields.consumedCompletions !== undefined)
          next.consumedCompletions = fields.consumedCompletions;

        if (existing) {
          await db
            .update(quotaBalance)
            .set({
              planTier: next.planTier,
              monthlyAllowanceSeconds: next.monthlyAllowanceSeconds,
              monthlyAllowanceCompletions: next.monthlyAllowanceCompletions,
              consumedSeconds: next.consumedSeconds,
              consumedCompletions: next.consumedCompletions,
              overageAllowed: next.overageAllowed,
              updatedAt: now,
            })
            .where(eq(quotaBalance.userId, userId));
        } else {
          await db.insert(quotaBalance).values(next);
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "upsert_user_quota", userId, changed: Object.keys(fields) },
        });

        const row = await getQuotaForUser(db, userId);
        return ctx.json({ ok: true, row, summary: toQuotaSummary(row, {} as import("../../../env").Env) });
      },
    ),

    adminResetQuotaCycle: createAuthEndpoint(
      "/self-hosted-admin/quota-reset-cycle",
      { method: "POST", use: [sessionMiddleware], body: quotaResetCycleSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        const now = new Date();
        const cycleResetAt = new Date(now.getTime() + 30 * 86_400_000);

        await ensureQuotaRow(db, userId);
        await db
          .update(quotaBalance)
          .set({
            consumedSeconds: 0,
            consumedCompletions: 0,
            cycleResetAt,
            updatedAt: now,
          })
          .where(eq(quotaBalance.userId, userId));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "reset_user_quota_cycle", userId },
        });

        return ctx.json({ ok: true, cycleResetAt: cycleResetAt.toISOString() });
      },
    ),

    adminGetQuotaTiers: createAuthEndpoint(
      "/self-hosted-admin/quota-tiers",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        return ctx.json(getQuotaTierCatalog());
      },
    ),

    adminListQuota: createAuthEndpoint(
      "/self-hosted-admin/quota-list",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const parsed = quotaListQuerySchema.safeParse({
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          tier: url.searchParams.get("tier") ?? undefined,
        });
        if (!parsed.success) {
          throw new APIError("BAD_REQUEST", { message: "Invalid query" });
        }
        const limit = parseLimit(String(parsed.data.limit ?? 50));
        const offset = parseOffset(String(parsed.data.offset ?? 0));
        const q = sanitizeSearch(parsed.data.q ?? null);
        const tierFilter = parsed.data.tier?.trim();

        const conditions = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(
            or(like(user.email, `%${safeQ}%`), like(user.name, `%${safeQ}%`))!,
          );
        }
        if (tierFilter) {
          conditions.push(eq(quotaBalance.planTier, tierFilter));
        }
        const where =
          conditions.length > 0 ? and(...conditions) : undefined;

        const baseQuery = db
          .select({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            planTier: quotaBalance.planTier,
            monthlyAllowanceSeconds: quotaBalance.monthlyAllowanceSeconds,
            monthlyAllowanceCompletions: quotaBalance.monthlyAllowanceCompletions,
            consumedSeconds: quotaBalance.consumedSeconds,
            consumedCompletions: quotaBalance.consumedCompletions,
            cycleResetAt: quotaBalance.cycleResetAt,
            overageAllowed: quotaBalance.overageAllowed,
          })
          .from(user)
          .innerJoin(quotaBalance, eq(user.id, quotaBalance.userId));

        const [rows, countRow] = await Promise.all([
          where
            ? baseQuery.where(where).orderBy(desc(user.createdAt)).limit(limit).offset(offset)
            : baseQuery.orderBy(desc(user.createdAt)).limit(limit).offset(offset),
          where
            ? db
                .select({ total: count() })
                .from(user)
                .innerJoin(quotaBalance, eq(user.id, quotaBalance.userId))
                .where(where)
            : db
                .select({ total: count() })
                .from(user)
                .innerJoin(quotaBalance, eq(user.id, quotaBalance.userId)),
        ]);

        return ctx.json({
          rows: rows.map((row) => ({
            userId: row.userId,
            userName: row.userName,
            userEmail: row.userEmail,
            planTier: row.planTier,
            monthlyAllowanceSeconds: row.monthlyAllowanceSeconds,
            monthlyAllowanceCompletions: row.monthlyAllowanceCompletions,
            consumedSeconds: row.consumedSeconds,
            consumedCompletions: row.consumedCompletions,
            cycleResetAt: row.cycleResetAt.toISOString(),
            overageAllowed: row.overageAllowed,
          })),
          total: countRow[0]?.total ?? 0,
        });
      },
    ),
  };
}
